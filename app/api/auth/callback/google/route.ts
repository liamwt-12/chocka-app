import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCodeForTokens, getManageableListings, getGoogleAuthUrl } from '@/lib/google';
import { getTenantBySlug } from '@/lib/tenant';
import { PRIMARY_TENANT_SLUG } from '@/lib/tenant-registry';
import { encryptSecret, isEncrypted, userTokenAad } from '@/lib/secrets';
import { parseInviteRef } from '@/lib/invite-token';

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
    // A retailer arriving from /api/invite/accept carries ?invite=<id>.<hmac>.
    // Folded into state so it survives the trip to Google and back — see
    // lib/invite-token for why state rather than a pre-auth cookie.
    //
    // Spread conditionally, so with no invite present the state string stays
    // byte-identical to what every existing sign-in has always produced. This
    // path is shared by all current users; the invite flow must add a field, not
    // change the shape.
    const inviteRef = searchParams.get('invite');
    const state = JSON.stringify({ action, plan, ...(inviteRef ? { invite: inviteRef } : {}) });
    return NextResponse.redirect(getGoogleAuthUrl(state, redirectUri));
  }

  try {
    // Step 2: Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Verify the user actually granted the GBP scope — Google's granular consent
    // lets users uncheck individual scopes, and there's no point continuing without it.
    if (!tokens.scope || !tokens.scope.includes('business.manage')) {
      // Log what Google ACTUALLY returned, not just that it was wrong.
      //
      // A real retailer hit this twice on 2026-07-30 and the previous one-line log
      // could not distinguish "she left the Business Profile checkbox unticked" from
      // "the scope was withheld for some other reason" — the two need completely
      // different responses, and there was nothing recorded to tell them apart.
      //
      // Safe to log: a scope list is a set of permission URLs, not a credential.
      // The access and refresh tokens are deliberately NOT logged, here or anywhere.
      const granted = (tokens.scope || '').split(' ').filter(Boolean);
      const field =
        tokens.scope === undefined || tokens.scope === null ? 'ABSENT' : tokens.scope === '' ? 'EMPTY' : 'present';
      console.error(
        `[auth] business.manage NOT granted — sending to scope_missing. ` +
          `scope field ${field}; ${granted.length} scope(s) granted: ${JSON.stringify(granted)}; ` +
          `tenant=${tenant.slug}; state=${searchParams.get('state') ? 'present' : 'absent'}`,
      );
      return NextResponse.redirect(new URL('/login?error=scope_missing', baseUrl));
    }

    // The positive counterpart. Cheap, and it means a live log stream shows the
    // gate being passed rather than only ever showing failures — otherwise silence
    // is ambiguous between "not reached" and "passed quietly".
    console.log(`[auth] business.manage granted; tenant=${tenant.slug}`);

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

      // A returning retailer can still be arriving from an invite — they may have
      // signed up previously, or accepted, abandoned, and come back later. Runs
      // after everything above has succeeded, so it cannot affect the sign-in.
      await linkInviteToUser(parsedState.invite, existingUser.id, tenant.slug);

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

        // Automation is OPT-IN on a free tenant, and only on a free tenant.
        //
        // Both columns default to `true` in the database, which was the right
        // default when the only way to hold an account was to pay for one —
        // paying for a service called "autopilot" is itself the opt-in. A Stellar
        // retailer pays nothing and is invited by their flooring supplier, so
        // that reasoning does not carry across: defaulting them to true would
        // mean writing posts and public review replies on a real business's
        // Google listing before they had agreed to any of it.
        //
        // That directly contradicts what Stellar promises them — "you stay the
        // owner", "undo anything, instantly", "no money, no spam, no lock-in" —
        // and the damage is public and hard to retract. The onboarding flow asks
        // explicitly and turns these on.
        //
        // Spread conditionally so Chocka's insert stays byte-identical and keeps
        // taking the database defaults.
        ...(tenant.priceMonthlyGbp === 0
          ? { auto_post_enabled: false, auto_reply_enabled: false }
          : {}),
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

    // The invited-retailer case this whole flow exists for. Last thing before the
    // response, after the user row and the credential are safely in place.
    await linkInviteToUser(parsedState.invite, newUser.id, tenant.slug);

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

/**
 * Link a retailer to the user who just connected, when they arrived from an invite.
 *
 * NEVER THROWS. Every failure logs and returns. This runs after a sign-in has
 * already succeeded, and an invite that fails to link is a recoverable nuisance —
 * an account that fails to be created is not. If this returns without linking, the
 * invite is left with accepted_at set and user_id null, which is exactly the state
 * those two separate columns exist to express: accepted, not yet claimed. It can be
 * reconciled later without the retailer redoing anything.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: write users.tenant_id. The new-user path above
 * sets that from the Host and comments emphatically that the other paths must not
 * touch it, because re-tagging on sign-in would silently move a retailer between
 * brands and take every future email with it. An invite always arrives on its
 * tenant's own host, so the Host-derived value is already right; writing it again
 * from the invite would add a second rule for the same field. A disagreement is
 * logged loudly and otherwise ignored.
 */
async function linkInviteToUser(
  inviteRef: unknown,
  userId: string,
  hostTenantSlug: string,
): Promise<void> {
  try {
    if (typeof inviteRef !== 'string' || inviteRef.length === 0) return; // ordinary sign-in

    const inviteId = parseInviteRef(inviteRef);
    if (!inviteId) {
      // Signature did not verify. Either tampering, or a secret rotation that
      // invalidated refs already in flight.
      console.error('Invite link: state carried an invite ref that failed to verify');
      return;
    }

    const { data: invite, error } = await supabaseAdmin
      .from('retailer_invites')
      .select('id,retailer_id,accepted_at,user_id,status,tenants ( slug ),retailers ( name, town )')
      .eq('id', inviteId)
      .maybeSingle();

    if (error) {
      console.error(`Invite link: lookup failed for ${inviteId}: ${error.message}`);
      return;
    }
    if (!invite) {
      console.error(`Invite link: no invite row for ${inviteId}`);
      return;
    }

    // Surface 2 sets accepted_at before sending the retailer to Google, so an
    // unaccepted invite here means the accept route was bypassed.
    if (!invite.accepted_at) {
      console.error(`Invite link: invite ${inviteId} reached the callback without being accepted`);
      return;
    }

    if (invite.user_id) {
      if (invite.user_id === userId) {
        // Replayed callback, or the retailer refreshed. Already done.
        console.log(`Invite link: invite ${inviteId} already linked to this user`);
      } else {
        console.error(`Invite link: invite ${inviteId} is already claimed by another user`);
      }
      return;
    }

    const inviteTenantSlug = (invite as any).tenants?.slug;
    if (inviteTenantSlug && inviteTenantSlug !== hostTenantSlug) {
      // Not fatal, and deliberately not corrected — see the note above about
      // tenant_id having exactly one source of truth.
      console.error(
        `Invite link: invite ${inviteId} belongs to tenant "${inviteTenantSlug}" but was completed on "${hostTenantSlug}"`,
      );
    }

    // Claim the retailer FIRST. It is the scarce side — retailers.user_id carries a
    // partial unique index where user_id is not null — so if anything is going to
    // fail it fails here, before the invite has been marked as claimed. Doing it the
    // other way round could leave an invite pointing at a user who owns no retailer.
    //
    // `.is('user_id', null)` means a retailer already claimed yields zero rows
    // rather than being reassigned.
    const { data: claimedRetailer, error: retailerError } = await supabaseAdmin
      .from('retailers')
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', invite.retailer_id)
      .is('user_id', null)
      .select('id,name,town');

    if (retailerError) {
      // The likeliest cause is the unique index: this user is already linked to a
      // different retailer.
      console.error(
        `Invite link: could not claim retailer ${invite.retailer_id} for user ${userId}: ${retailerError.message}`,
      );
      return;
    }
    if (!claimedRetailer || claimedRetailer.length === 0) {
      console.error(`Invite link: retailer ${invite.retailer_id} is already claimed by another user`);
      return;
    }

    // user_id AND status together: this is the moment the invite is genuinely used.
    // The accept route no longer moves status — it only stamps accepted_at — because
    // marking an invite spent at button-press burned real invites when Google was
    // abandoned mid-flow. See lib/invite-token.
    const { error: inviteError } = await supabaseAdmin
      .from('retailer_invites')
      .update({ user_id: userId, status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', inviteId)
      .is('user_id', null);

    if (inviteError) {
      // Retailer is linked but the invite is not. Harmless for the retailer, who is
      // connected either way, but it breaks the funnel record — hence the shout.
      console.error(
        `Invite link: retailer ${invite.retailer_id} was claimed but invite ${inviteId} could not be updated: ${inviteError.message}`,
      );
      return;
    }

    console.log(`Invite link: retailer ${invite.retailer_id} linked to user ${userId} via invite ${inviteId}`);
    await warnOnProfileMismatch(userId, claimedRetailer[0]);
  } catch (err) {
    console.error('Invite link: unexpected failure, sign-in unaffected:', err);
  }
}

/**
 * Log when the Google profile a retailer connected does not look like the retailer
 * they were invited as — e.g. they accepted Elvet's invite and connected their own
 * unrelated business.
 *
 * LOG ONLY, NEVER BLOCK. A retailer is not going to be turned away from their own
 * onboarding on the strength of a string comparison. It is also genuinely weak:
 * bindManageableListing does not store a place_id (only google_location_name,
 * business_name, address and lat/lng), and `retailers` carries no coordinates, so
 * name and town are all there is to compare. Storing profiles.google_place_id at
 * bind time would make a real check possible; that touches the path every signup
 * takes and is tracked separately rather than folded in here.
 *
 * Nothing to compare is not a mismatch: `select` and `no_profile` outcomes bind no
 * profile at all, and those cases return quietly.
 */
async function warnOnProfileMismatch(
  userId: string,
  retailer: { id: string; name: string; town: string | null },
): Promise<void> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('business_name,address')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profile?.business_name) return;

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Arrays rather than Sets: this repo targets es5, where spreading a Set needs
  // downlevelIteration. Duplicates are irrelevant to a "share any token" test.
  // Tokens of 3+ chars only, so "of", "and" and initials cannot carry a match.
  const tokens = (s: string) => norm(s).split(' ').filter((t) => t.length > 2);

  const invited = tokens(retailer.name);
  const connected = tokens(profile.business_name);
  const nameLooksRight = invited.some((t) => connected.indexOf(t) !== -1);

  const townLooksRight =
    !retailer.town || norm(profile.address || '').includes(norm(retailer.town));

  if (!nameLooksRight || !townLooksRight) {
    console.error(
      `Invite link: possible mismatch on retailer ${retailer.id} — invited as ` +
        `"${retailer.name}" (${retailer.town ?? 'no town'}) but connected profile is ` +
        `"${profile.business_name}" (${profile.address ?? 'no address'}). Linked anyway; review.`,
    );
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
  // Says which of the three outcomes was taken and why. Without it, /no-profile and
  // /onboarding are indistinguishable in the logs from a failure earlier in the
  // flow, which is exactly the ambiguity that made the 2026-07-30 scope failure
  // take three attempts to characterise.
  console.log(`[auth] manageable listings found: ${listings.length}`);
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
