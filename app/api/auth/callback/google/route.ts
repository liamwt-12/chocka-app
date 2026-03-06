import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCodeForTokens, getAccounts, getLocations, getGoogleAuthUrl } from '@/lib/google';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const action = searchParams.get('action');
  const plan = searchParams.get('plan') || 'monthly';

  if (!code) {
    const state = JSON.stringify({ action, plan });
    return NextResponse.redirect(getGoogleAuthUrl(state));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });
    const userInfo = await userInfoRes.json();

    const { data: existingUser } = await supabaseAdmin
      .from('users').select('*').eq('email', userInfo.email).single();

    let parsedState: any = {};
    try {
      const stateParam = searchParams.get('state');
      if (stateParam) parsedState = JSON.parse(stateParam);
    } catch {}

    if (parsedState.action === 'reconnect' && existingUser) {
      await supabaseAdmin.from('users').update({
        google_refresh_token: tokens.refresh_token,
        token_status: 'valid',
        token_invalid_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', existingUser.id);
      const response = NextResponse.redirect(new URL('/settings', request.url));
      response.cookies.set('chocka_user_id', existingUser.id, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 2592000 });
      return response;
    }

    if (existingUser && existingUser.subscription_status === 'active') {
      const response = NextResponse.redirect(new URL('/dashboard', request.url));
      response.cookies.set('chocka_user_id', existingUser.id, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 2592000 });
      return response;
    }

    const referralCode = generateReferralCode();
    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users').insert({ email: userInfo.email, name: userInfo.name || '', google_refresh_token: tokens.refresh_token, referral_code: referralCode }).select().single();
    if (insertError) throw insertError;

    try {
      const accounts = await getAccounts(tokens.access_token);
      if (accounts.accounts?.length > 0) {
        const account = accounts.accounts[0];
        const locations = await getLocations(tokens.access_token, account.name);
        if (locations.locations?.length > 0) {
          const loc = locations.locations[0];
          await supabaseAdmin.from('profiles').insert({
            user_id: newUser.id, google_account_id: account.name, google_location_name: loc.name,
            business_name: loc.title || '', category: loc.categories?.primaryCategory?.displayName || '',
            address: formatAddress(loc.storefrontAddress), latitude: loc.latlng?.latitude, longitude: loc.latlng?.longitude,
          });
        }
      }
    } catch (err) { console.error('Failed to fetch GBP data:', err); }

    const response = NextResponse.redirect(new URL('/onboarding?plan=' + plan, request.url));
    response.cookies.set('chocka_user_id', newUser.id, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 2592000 });
    return response;
  } catch (err) {
    console.error('Auth callback error:', err);
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function formatAddress(address: any): string {
  if (!address) return '';
  return [address.addressLines?.join(', '), address.locality, address.postalCode].filter(Boolean).join(', ');
}
