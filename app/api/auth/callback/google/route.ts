import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCodeForTokens, getAccounts, getLocations, getGoogleAuthUrl } from '@/lib/google';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const action = searchParams.get('action');
  const plan = searchParams.get('plan') || 'monthly';

  // Step 1: No code yet — redirect to Google consent
  if (!code) {
    const state = JSON.stringify({ action, plan });
    return NextResponse.redirect(getGoogleAuthUrl(state));
  }

  try {
    // Step 2: Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Get user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoRes.json();

    // Step 3: Check if user exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', userInfo.email)
      .single();

    let parsedState: any = {};
    try {
      const stateParam = searchParams.get('state');
      if (stateParam) parsedState = JSON.parse(stateParam);
    } catch {}

    if (parsedState.action === 'reconnect' && existingUser) {
      // Reconnect flow — update token
      await supabaseAdmin
        .from('users')
        .update({
          google_refresh_token: tokens.refresh_token,
          token_status: 'valid',
          token_invalid_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingUser.id);

      return NextResponse.redirect(new URL('/settings', process.env.NEXT_PUBLIC_APP_URL!));
    }

    if (existingUser && existingUser.subscription_status === 'active') {
      // Existing active user — go to dashboard
      // Set session cookie (simplified — use Supabase Auth in production)
      const response = NextResponse.redirect(new URL('/dashboard', process.env.NEXT_PUBLIC_APP_URL!));
      response.cookies.set('chocka_user_id', existingUser.id, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }

    // Step 4: New user — create and go to onboarding
    const referralCode = generateReferralCode();

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        email: userInfo.email,
        name: userInfo.name || '',
        google_refresh_token: tokens.refresh_token,
        referral_code: referralCode,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Fetch their GBP accounts and locations
    try {
      const accounts = await getAccounts(tokens.access_token);
      if (accounts.accounts?.length > 0) {
        const account = accounts.accounts[0];
        const locations = await getLocations(tokens.access_token, account.name);

        if (locations.locations?.length > 0) {
          const loc = locations.locations[0];
          await supabaseAdmin.from('profiles').insert({
            user_id: newUser.id,
            google_account_id: account.name,
            google_location_name: loc.name,
            business_name: loc.title || '',
            category: loc.categories?.primaryCategory?.displayName || '',
            address: formatAddress(loc.storefrontAddress),
            latitude: loc.latlng?.latitude,
            longitude: loc.latlng?.longitude,
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch GBP data:', err);
      // Continue anyway — they can reconnect later
    }

    const response = NextResponse.redirect(new URL(`/onboarding?plan=${plan}`, process.env.NEXT_PUBLIC_APP_URL!));
    response.cookies.set('chocka_user_id', newUser.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;

  } catch (err) {
    console.error('Auth callback error:', err);
    return NextResponse.redirect(new URL('/login?error=auth_failed', process.env.NEXT_PUBLIC_APP_URL!));
  }
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function formatAddress(address: any): string {
  if (!address) return '';
  const parts = [
    address.addressLines?.join(', '),
    address.locality,
    address.postalCode,
  ].filter(Boolean);
  return parts.join(', ');
}
