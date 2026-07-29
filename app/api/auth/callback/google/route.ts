import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCodeForTokens, getManageableListings, getGoogleAuthUrl } from '@/lib/google';
import { getTenantBySlug } from '@/lib/tenant';
import { PRIMARY_TENANT_SLUG } from '@/lib/tenant-registry';
import { encryptSecret, isEncrypted, userTokenAad } from '@/lib/secrets';

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
      //
      // getGoogleAuthUrl() always sends access_type=offline + prompt=consent, so
      // Google returns a refresh token on every pass through this flow. If one
      // is ever absent, something upstream has changed: fail loudly rather than
      // writing null over a working credential while still setting
      // token_status='valid' — that combination is exactly the "row says
      // connected, column says nothing" state that hid four days of live tokens
      // during the 2026-07-28 offboarding.
      if (!tokens.refresh_token) {
        throw new Error('Reconnect: Google returned no refresh_token — refusing to clear the stored credential');
      }
      await supabaseAdmin
        .from('users')
        .update({
          google_refresh_token: encryptSecret(tokens.refresh_token, userTokenAad(existingUser.id)),
          token_status: 'valid',
          token_invalid_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingUser.id);

      return NextResponse.redirect(new URL('/settings', baseUrl));
    }

    if (existingUser) {
      // Existing user — update token.
      //
      // The fallback is the subtle case. Once the backfill has run,
      // existingUser.google_refresh_token is already an envelope, and sealing it
      // a second time would produce a double-wrapped value that no later read
      // can decrypt — a silent, permanent loss of the credential. Gate on
      // isEncrypted(): a fresh token from Google is always plaintext and gets
      // sealed; an existing envelope passes through untouched; and a legacy
      // plaintext row is normalised in place, so any reconnect heals that row
      // ahead of the backfill rather than waiting for it.
      const aad = userTokenAad(existingUser.id);
      const incoming = tokens.refresh_token || existingUser.google_refresh_token;
      const freshRefreshToken =
        incoming && !isEncrypted(incoming) ? encryptSecret(incoming, aad) : incoming;
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

    if (!tokens.refresh_token) {
      // Same reasoning as the reconnect path: prompt=consent guarantees one, so
      // its absence means something upstream changed. Creating the account with
      // a null credential would leave a user who appears signed up but cannot
      // reach their own Business Profile.
      throw new Error('New user: Google returned no refresh_token — refusing to create a credential-less account');
    }

    // The AAD binds a ciphertext to the row it belongs to, so the id has to
    // exist before the token can be sealed. Generating it here rather than
    // letting Postgres default it avoids the alternative — insert first, then
    // update with the token once the id comes back — which opens a window where
    // a user row exists with no credential, and strands the user half-connected
    // if that second call fails.
    const newUserId = randomUUID();

    // Tag the account with the brand it signed up through.
    //
    // SET ONLY ON CREATION. The three paths above deliberately do not touch
    // tenant_id: if signing in re-tagged an existing account, a retailer who
    // opened the other brand's host once would be silently moved between brands,
    // and every future email and text would follow. Signup is the only moment
    // the Host legitimately decides this.
    const { data: tenantRow } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', tenant.slug)
      .single();

    if (!tenantRow && tenant.slug !== PRIMARY_TENANT_SLUG) {
      // A non-primary account created without a tenant_id is resolved to the
      // primary by getTenantForRow(), so a Stellar retailer would receive Chocka
      // branding for the life of the account with nothing in the data marking it
      // wrong. Refusing is the recoverable option: seed the row, retailer
      // retries. Chocka is exempt because a null already resolves to Chocka —
      // its live flow is unchanged either way.
      throw new Error(
        `No tenants row for slug "${tenant.slug}" — refusing to create an account that would be silently mis-branded`,
      );
    }

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        id: newUserId,
        email: userInfo.email,
        name: userInfo.name || '',
        google_refresh_token: encryptSecret(tokens.refresh_token, userTokenAad(newUserId)),
        referral_code: referralCode,
        tenant_id: tenantRow?.id ?? null,
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
