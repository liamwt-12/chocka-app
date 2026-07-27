import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCodeForTokens, getManageableListings, getGoogleAuthUrl } from '@/lib/google';
import { getTenantBySlug } from '@/lib/tenant';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const action = searchParams.get('action');
  const plan = searchParams.get('plan') || 'monthly';

  // Which brand is this retailer signing in through? Set by middleware from the
  // Host. Both brands share one deploy, so every origin below has to be derived
  // per request rather than read from a process-wide env var.
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));

  // Chocka deliberately keeps reading GOOGLE_REDIRECT_URI so its live flow is
  // unchanged; the env var already holds its URI. Only Stellar derives one,
  // because a single env var cannot hold both. Google requires this exact value
  // again at token-exchange time, so it is computed once and reused below.
  const redirectUri =
    tenant.slug === 'stellar' ? `${tenant.appUrl}/api/auth/callback/google` : undefined;

  // Where the retailer lands afterwards. Stellar uses its own origin; Chocka
  // keeps the previous expression exactly, including the request-origin
  // fallback that local dev relies on when NEXT_PUBLIC_APP_URL is unset.
  const baseUrl =
    tenant.slug === 'stellar' ? tenant.appUrl : process.env.NEXT_PUBLIC_APP_URL || request.url;

  // Step 1: No code yet — redirect to Google consent
  if (!code) {
    const state = JSON.stringify({ action, plan });
    return NextResponse.redirect(getGoogleAuthUrl(state, redirectUri));
  }

  try {
    // Step 2: Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Verify the user actually granted the GBP scope — Google's granular consent
    // lets users uncheck individual scopes, and there's no point continuing without it.
    if (!tokens.scope || !tokens.scope.includes('business.manage')) {
      console.log('OAuth granted scopes missing business.manage — redirecting to scope error');
      return NextResponse.redirect(new URL('/login?error=scope_missing', baseUrl));
    }

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

      return NextResponse.redirect(new URL('/settings', baseUrl));
    }

    if (existingUser) {
      // Existing user — update token
      const freshRefreshToken = tokens.refresh_token || existingUser.google_refresh_token;
      await supabaseAdmin
        .from('users')
        .update({
          google_refresh_token: freshRefreshToken,
          token_status: 'valid',
          token_invalid_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingUser.id);

      // If a profile is already bound, keep it. Otherwise enumerate what this
      // user can manage and either auto-bind (one) or send them to the picker.
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('user_id', existingUser.id)
        .single();

      let dest: string;
      if (existingProfile) {
        dest = existingUser.onboarding_step === 'complete' ? '/dashboard' : '/onboarding';
      } else {
        let result: BindResult = 'no_profile';
        try {
          result = await bindManageableListing(existingUser.id, tokens.access_token);
        } catch (err) {
          console.error('Failed to enumerate GBP listings for returning user:', err);
        }
        dest = result === 'onboarding' ? (existingUser.onboarding_step === 'complete' ? '/dashboard' : '/onboarding')
             : result === 'select' ? '/onboarding?select=1'
             : '/no-profile';
      }

      const response = NextResponse.redirect(new URL(dest, baseUrl));
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

    // Enumerate the listings this user can manage and decide where to send them:
    // one → auto-bind and start onboarding; several → picker; none → no-profile.
    let result: BindResult = 'no_profile';
    try {
      result = await bindManageableListing(newUser.id, tokens.access_token);
    } catch (err) {
      console.error('Failed to enumerate GBP listings for new user:', err);
    }

    const dest = result === 'onboarding' ? `/onboarding?plan=${plan}`
               : result === 'select' ? `/onboarding?select=1&plan=${plan}`
               : '/no-profile';

    const response = NextResponse.redirect(new URL(dest, baseUrl));
    response.cookies.set('chocka_user_id', newUser.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;

  } catch (err) {
    console.error('Auth callback error:', err);
    return NextResponse.redirect(new URL('/login?error=auth_failed', baseUrl));
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

type BindResult = 'onboarding' | 'select' | 'no_profile';

// Enumerate the listings this user can manage and bind the single profile when
// there's exactly one. Returns where the caller should route:
//   'onboarding' — exactly one listing, profile bound, go straight to the audit
//   'select'     — several listings, nothing bound yet, send to the picker
//   'no_profile' — nothing manageable, show the no-profile screen
async function bindManageableListing(userId: string, accessToken: string): Promise<BindResult> {
  const listings = await getManageableListings(accessToken);
  if (listings.length === 0) return 'no_profile';
  if (listings.length > 1) return 'select';

  const only = listings[0];
  await supabaseAdmin.from('profiles').insert({
    user_id: userId,
    google_account_id: only.accountName,
    google_location_name: only.locationName,
    business_name: only.title,
    category: only.category,
    address: only.address,
    latitude: only.latitude,
    longitude: only.longitude,
  });
  return 'onboarding';
}
