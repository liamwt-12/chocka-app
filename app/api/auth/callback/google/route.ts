import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCodeForTokens, getManageableListings, getGoogleAuthUrl, type Listing } from '@/lib/google';
import { getTenantBySlug } from '@/lib/tenant';
import { PRIMARY_TENANT_SLUG } from '@/lib/tenant-registry';
import { encryptSecret, isEncrypted, userTokenAad } from '@/lib/secrets';
import { parseInviteRef } from '@/lib/invite-token';
import { detectOwnership, type ConnectionStatus, type OwnershipResult } from '@/lib/ownership';
import { releaseStaleClaim } from '@/lib/connection-reset';
import { helpPath, type HelpReason } from '@/lib/connect-help';
import { setSessionCookie } from '@/lib/session';

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

  // Step 0: Google sent the shop back WITHOUT a code. That is a refusal (the
  // shop pressed Cancel) or an error on Google's side. This used to fall into
  // the branch below and bounce the shop straight back to Google's screen,
  // with the invite dropped from the state, so that pressing Continue there
  // ended in "invite-only". Now the shop is told what happened and offered a
  // way back in that still carries its invite.
  const googleRefusal = searchParams.get('error');
  if (!code && googleRefusal) {
    const invite = inviteFromState(searchParams.get('state'));
    const why: HelpReason = googleRefusal === 'access_denied' ? 'cancelled' : 'google_error';
    console.warn(`[auth] Google returned error=${googleRefusal}; tenant=${tenant.slug}; invite=${invite ? 'present' : 'absent'}`);
    await noteConnectIssue(invite, why, why === 'cancelled' ? 'pressed Cancel on Google\'s permission screen' : `Google returned an error at sign-in (${googleRefusal.slice(0, 40)})`);
    return NextResponse.redirect(new URL(helpPath(why, invite), baseUrl));
  }

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
      const invite = inviteFromState(searchParams.get('state'));
      await noteConnectIssue(invite, 'unticked', 'signed in, but left the Business Profile box unticked on Google\'s screen');
      await revokeQuietly(tokens.refresh_token || tokens.access_token);
      // An invited shop goes to the help page, which explains the box and sends
      // it back through its own invite. Anyone else gets the sign-in page as before.
      return NextResponse.redirect(new URL(invite ? helpPath('unticked', invite) : '/login?error=scope_missing', baseUrl));
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
        // Defaults to connect_failed, not no_profile: if anything below throws
        // before assigning, "we could not ask" is the honest reading.
        let result: BindResult = 'connect_failed';
        try {
          // The returning-user path is the one place the tenant id is NOT already
          // in hand — it was decided when this account was created, so it is read
          // back off the row (select('*') above) rather than re-derived here.
          result = await bindManageableListing(
            existingUser.id,
            tokens.access_token,
            existingUser.tenant_id ?? null,
            await expectedShopForInvite(parsedState.invite),
          );
        } catch (err) {
          console.error(
            `[auth] enumeration threw for returning user ${existingUser.id} — routing to retry, NOT /no-profile:`,
            err,
          );
        }
        dest = result === 'onboarding' ? (existingUser.onboarding_step === 'complete' ? '/dashboard' : '/onboarding')
             : result === 'select' ? '/onboarding?select=1'
             : result === 'connect_failed' ? '/onboarding?connect=failed'
             : parsedState.invite ? helpPath('no_listing', parsedState.invite)
             : '/no-profile';
      }

      // A returning retailer can still be arriving from an invite — they may have
      // signed up previously, or accepted, abandoned, and come back later. Runs
      // after everything above has succeeded, so it cannot affect the sign-in.
      await linkInviteToUser(parsedState.invite, existingUser.id, tenant.slug);

      const response = NextResponse.redirect(new URL(dest, baseUrl));
      setSessionCookie(response, existingUser.id);
      return response;
    }

    // Step 3b: On the Stellar host, refuse to CREATE an account without a usable
    // invite.
    //
    // Placed here deliberately — after the existingUser branch has returned, and
    // before any row is written. It gates account *creation* only. A retailer who
    // was properly invited and comes back later through /login is an existing user
    // and never reaches this line; gating sign-in as well would lock out the very
    // people the invite flow onboarded.
    //
    // The gap this closes: linkInviteToUser is the only code anywhere that sets
    // retailers.user_id, and it runs only when a signed invite ref arrives in the
    // OAuth state. Without one, /login produced a real Stellar account with its
    // retailer row left unclaimed and the 2026-06-21 baseline unattached — an
    // orphan that nothing reconciles, because post-hoc linking is not built.
    //
    // Chocka is untouched: the condition is tenant-scoped, and Chocka has no
    // invite concept at all.
    if (tenant.slug === 'stellar') {
      // If this shop is held by an earlier sign-in that never reached a listing
      // (the wrong Google account), clear that first, so the right account is
      // not turned away as "already claimed". Only ever removes an account with
      // no listing bound: lib/connection-reset.ts.
      const expectedForRelease = await expectedShopForInvite(parsedState.invite);
      if (expectedForRelease) {
        try { await releaseStaleClaim(supabaseAdmin, expectedForRelease.retailerId); }
        catch (err) { console.error('[auth] could not check for a stale claim:', err); }
      }
      const admitted = await inviteAdmitsSignup(parsedState.invite);
      if (!admitted.ok) {
        console.error(
          `[auth] Stellar signup refused — no usable invite (${admitted.reason}); ` +
            `email=${userInfo.email ? 'present' : 'absent'}; state invite=${parsedState.invite ? 'present' : 'absent'}`,
        );

        // We hold a live Google credential for someone we have just declined to
        // sign up. It is never stored, so hand it back rather than leaving the
        // grant sitting in their Google account for an app that gave them nothing.
        // Best-effort: a failure here must not change what the retailer sees.
        if (tokens.refresh_token) {
          try {
            await fetch('https://oauth2.googleapis.com/revoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: tokens.refresh_token }),
            });
          } catch (err) {
            console.error('[auth] could not revoke the declined signup credential:', err);
          }
        }

        return NextResponse.redirect(new URL('/login?error=invite_required', baseUrl));
      }
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

    // LOOK FOR THE LISTING BEFORE CREATING ANYTHING (invited shops).
    //
    // The account used to be created first. So a shop that signed in with a
    // Google account managing no listing, or on a moment when Google would not
    // answer, was left holding a half-made account that had used up its invite.
    // Now an invited shop only gets an account once a listing has been found.
    // Until then nothing is stored, the permission is handed back, and the
    // shop's link still works with a different Google account.
    let found: { listings: Listing[]; expected: ExpectedShop | null; outcome: OwnershipResult } | null = null;
    if (parsedState.invite) {
      const expected = await expectedShopForInvite(parsedState.invite);
      let listings: Listing[];
      try {
        listings = await getManageableListings(tokens.access_token);
      } catch (err) {
        console.error('[auth] enumeration threw for an invited shop before any account was created; sending to help:', err);
        await noteConnectIssue(parsedState.invite, 'google_error', 'Google did not answer when we looked for the listing');
        await revokeQuietly(tokens.refresh_token);
        return NextResponse.redirect(new URL(helpPath('google_error', parsedState.invite), baseUrl));
      }
      const outcome = detectOwnership(listings, expected?.placeId ?? null);
      console.log(`[auth] ownership: ${outcome.status}: ${outcome.detail}`);
      if (outcome.status === 'no_access') {
        if (expected) { await recordConnectionStatus(expected.retailerId, 'no_access', outcome.detail); await recordConnectIssue(expected.retailerId, 'no_listing'); }
        await revokeQuietly(tokens.refresh_token);
        return NextResponse.redirect(new URL(helpPath('no_listing', parsedState.invite), baseUrl));
      }
      found = { listings, expected, outcome };
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
    let result: BindResult = 'connect_failed';
    try {
      // Read back off the inserted row rather than reusing `tenantRow?.id`, so
      // the profile is tagged with what the database actually stored for its
      // owner. The two cannot disagree today, but only one of them is the
      // column the invariant is about.
      result = found
        ? await bindOutcome(newUser.id, newUser.tenant_id ?? null, found.expected, found.outcome, found.listings.length)
        : await bindManageableListing(newUser.id, tokens.access_token, newUser.tenant_id ?? null, null);
    } catch (err) {
      // The account row and the credential are already saved at this point, so
      // this is recoverable: the retailer retries the connect and lands in the
      // existing-user branch above. Sending them to /no-profile instead would
      // have stranded a brand-new account on a page telling them to create a
      // Business Profile they already have.
      console.error(
        `[auth] enumeration threw for new user ${newUser.id} — routing to retry, NOT /no-profile:`,
        err,
      );
    }

    const dest = result === 'onboarding' ? `/onboarding?plan=${plan}`
               : result === 'select' ? `/onboarding?select=1&plan=${plan}`
               : result === 'connect_failed' ? `/onboarding?connect=failed&plan=${plan}`
               : '/no-profile';

    // The invited-retailer case this whole flow exists for. Last thing before the
    // response, after the user row and the credential are safely in place.
    await linkInviteToUser(parsedState.invite, newUser.id, tenant.slug);

    const response = NextResponse.redirect(new URL(dest, baseUrl));
    setSessionCookie(response, newUser.id);
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
/**
 * Would this invite ref actually result in a linked retailer?
 *
 * The gate in Step 3b uses this to decide whether creating an account is
 * worthwhile. It deliberately mirrors linkInviteToUser's preconditions rather
 * than inventing its own bar, because the two failing differently is the one way
 * this can do harm: stricter here turns away a retailer whose invite would have
 * worked, looser here admits the orphan the gate exists to prevent.
 *
 * If you change a preconditon in linkInviteToUser, change it here too. The
 * checks are listed in the same order there for exactly that reason.
 *
 * Note what is NOT checked: expires_at. Expiry is enforced at accept time, and
 * re-testing it here would reject a retailer whose invite lapsed during the
 * seconds they spent on Google's consent screen — mid-flow, having already
 * granted access. linkInviteToUser does not check it either.
 */
async function inviteAdmitsSignup(inviteRef: unknown): Promise<{ ok: boolean; reason: string }> {
  if (typeof inviteRef !== 'string' || inviteRef.length === 0) return { ok: false, reason: 'no invite ref in state' };

  const inviteId = parseInviteRef(inviteRef);
  if (!inviteId) return { ok: false, reason: 'invite ref failed to verify' };

  const { data: invite, error } = await supabaseAdmin
    .from('retailer_invites')
    .select('id,retailer_id,accepted_at,user_id,status')
    .eq('id', inviteId)
    .maybeSingle();

  // A lookup failure is not proof the invite is bad. Refuse anyway — the
  // alternative is creating an account we cannot link, which is the thing being
  // prevented — but say so distinctly in the log, because a burst of these means
  // the database is unwell, not that retailers are arriving by the wrong door.
  if (error) return { ok: false, reason: `invite lookup failed: ${error.message}` };
  if (!invite) return { ok: false, reason: 'no invite row' };
  if (!invite.accepted_at) return { ok: false, reason: 'invite never went through the accept route' };
  if (invite.user_id) return { ok: false, reason: 'invite already claimed' };
  if (invite.status !== 'pending') return { ok: false, reason: `invite status is ${invite.status}` };

  // The retailer is the scarce side — linkInviteToUser claims it with
  // `.is('user_id', null)`, so an already-claimed row yields zero rows and the
  // link silently fails. Checking it here is what stops a signup against a
  // retailer someone else already holds, which is precisely how a real Tarkett
  // row came to be unclaimable on 2026-07-30.
  const { data: retailer, error: retailerError } = await supabaseAdmin
    .from('retailers')
    .select('id,user_id')
    .eq('id', invite.retailer_id)
    .maybeSingle();

  if (retailerError) return { ok: false, reason: `retailer lookup failed: ${retailerError.message}` };
  if (!retailer) return { ok: false, reason: 'invite points at no retailer' };
  if (retailer.user_id) return { ok: false, reason: 'retailer already claimed by another user' };

  return { ok: true, reason: 'ok' };
}

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
      // place_id comes back so the mismatch check below can compare identities
      // rather than name tokens. 8 of the 180 retailers have none, so it stays
      // a best-effort signal, not a gate.
      .select('id,name,town,place_id');

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
    // Connected: whatever stopped an earlier attempt is no longer the story.
    await recordConnectIssue(invite.retailer_id, null);
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
  retailer: { id: string; name: string; town: string | null; place_id?: string | null },
): Promise<void> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('business_name,address,google_place_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profile) return;

  // The real check, when both sides know their Places id. This compares
  // IDENTITIES — the same Google listing or not — instead of guessing from name
  // tokens and a town string. It is only possible now that google_place_id is
  // captured at bind time; before that the column was set for 1 of 6 profiles,
  // so this branch would almost never have been reachable.
  //
  // A definite answer either way, so it returns rather than falling through to
  // the weaker test: agreeing place ids should not then be second-guessed by a
  // name comparison, and disagreeing ones need no corroboration.
  if (retailer.place_id && profile.google_place_id) {
    if (retailer.place_id !== profile.google_place_id) {
      console.error(
        `[invite] PROFILE MISMATCH (place_id): retailer ${retailer.id} "${retailer.name}" ` +
          `expects ${retailer.place_id} but the connected profile is ${profile.google_place_id} — ` +
          `this is a different Google listing, not a naming difference`,
      );
    } else {
      console.log(`[invite] profile matches retailer ${retailer.id} by place_id`);
    }
    return;
  }

  if (!profile.business_name) return;

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

// 'connect_failed' is NOT an outcome bindManageableListing returns — it is what
// the call sites record when it THROWS. The distinction is the whole point of
// this type having a fourth member: 'no_profile' must mean "Google answered, and
// this account manages nothing", never "we could not ask". They send the retailer
// to opposite places — one to a page about creating a Business Profile, the other
// to a retry — and conflating them told a retailer with a perfectly good listing
// to go and make one.
type BindResult = 'onboarding' | 'select' | 'no_profile' | 'connect_failed';

// Enumerate the listings this user can manage and bind the single profile when
// there's exactly one. Returns where the caller should route:
//   'onboarding' — exactly one listing, profile bound, go straight to the audit
//   'select'     — several listings, nothing bound yet, send to the picker
//   'no_profile' — nothing manageable, show the no-profile screen
//
// `tenantId` comes from the OWNING USER ROW, never from the request Host. A
// profile belongs to exactly one user, so its tenant is whatever that user's
// tenant is — deriving it from the Host would let a retailer who opened the
// other brand's host once bind a profile tagged to a brand their own row does
// not belong to, which is the same drift the users.tenant_id comment above
// refuses to introduce. Passing null leaves the column unset, exactly as
// before: a user row with no tenant cannot lend one to its profile.
async function bindManageableListing(
  userId: string,
  accessToken: string,
  tenantId: string | null,
  expected: ExpectedShop | null = null,
): Promise<BindResult> {
  const listings = await getManageableListings(accessToken);
  // Ownership detection (lib/ownership.ts): with an invite, prefer the listing
  // whose place ID matches the shop the invite was for.
  const outcome = detectOwnership(listings, expected?.placeId ?? null);
  console.log(`[auth] ownership: ${outcome.status}: ${outcome.detail}`);
  return bindOutcome(userId, tenantId, expected, outcome, listings.length);
}

/** Act on a decision already made about which listing (if any) to bind. */
async function bindOutcome(
  userId: string,
  tenantId: string | null,
  expected: ExpectedShop | null,
  outcome: OwnershipResult,
  listingCount: number,
): Promise<BindResult> {
  // Recorded so /admin/pilot and the shop's own screens can say what to do next.
  if (expected) await recordConnectionStatus(expected.retailerId, outcome.status, outcome.detail);
  console.log(`[auth] manageable listings found: ${listingCount}`);
  if (outcome.status === 'no_access') return 'no_profile';
  if (outcome.needsPicker || !outcome.bind) return 'select';

  const only = outcome.bind;
  await supabaseAdmin.from('profiles').insert({
    user_id: userId,

    // Spread rather than written as `tenant_id: tenantId ?? null`, so a user row
    // that carries no tenant produces the byte-identical insert this path has
    // always produced instead of an explicit null.
    ...(tenantId ? { tenant_id: tenantId } : {}),

    google_account_id: only.accountName,
    google_location_name: only.locationName,
    business_name: only.title,
    category: only.category,
    address: only.address,
    latitude: only.latitude,
    longitude: only.longitude,

    // Captured at bind time because it arrives free on the enumeration above.
    // Until now this was set only by a conditional fallback inside the
    // dashboard's no-reviews branch, so 1 of 6 production profiles had one.
    // It is what lets warnOnProfileMismatch compare identities rather than
    // name tokens, and it is the strongest key any future post-hoc linking
    // could use. Null when Google returned no mapsUri — a bonus, not a promise.
    google_place_id: only.placeId ?? null,
  });
  return 'onboarding';
}

// ── Ownership detection helpers ─────────────────────────────────────────────

interface ExpectedShop { retailerId: string; placeId: string | null }

/**
 * The shop an invite was minted for, and its baseline place ID. Null for an
 * ordinary sign-in, or if the invite cannot be read (never fails the sign-in).
 */
async function expectedShopForInvite(inviteRef: unknown): Promise<ExpectedShop | null> {
  try {
    if (typeof inviteRef !== 'string' || !inviteRef) return null;
    const inviteId = parseInviteRef(inviteRef);
    if (!inviteId) return null;
    const { data } = await supabaseAdmin
      .from('retailer_invites')
      .select('retailer_id, retailers ( place_id )')
      .eq('id', inviteId)
      .maybeSingle();
    if (!data?.retailer_id) return null;
    const r: any = Array.isArray((data as any).retailers) ? (data as any).retailers[0] : (data as any).retailers;
    return { retailerId: data.retailer_id, placeId: r?.place_id ?? null };
  } catch (err) {
    console.error('[auth] could not read the invite for ownership detection:', err);
    return null;
  }
}

/** Best effort: a failure to record the status never affects the sign-in. */
async function recordConnectionStatus(retailerId: string, status: ConnectionStatus, detail: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('retailers')
    .update({ connection_status: status, connection_detail: detail.slice(0, 500), connection_checked_at: new Date().toISOString() })
    .eq('id', retailerId);
  if (error) console.error(`[auth] could not record connection status for retailer ${retailerId}: ${error.message}`);
}

// ── Dead-end helpers ────────────────────────────────────────────────────────

/** The signed invite reference carried in the OAuth state, if there is one. */
function inviteFromState(state: string | null): string | null {
  try {
    const parsed = state ? JSON.parse(state) : null;
    return typeof parsed?.invite === 'string' && parsed.invite ? parsed.invite : null;
  } catch { return null; }
}

/**
 * Note on the shop's record why a sign-in did not complete, so whoever is
 * helping can see it. The shop stays "invited": it has not connected. Best
 * effort, never affects what the shop sees.
 */
async function noteConnectIssue(inviteRef: string | null, code: HelpReason, detail: string): Promise<void> {
  const expected = await expectedShopForInvite(inviteRef);
  if (!expected) return;
  // Do not overwrite the record of a shop that is already connected (someone
  // re-opening an old link and pressing Cancel changes nothing about that).
  const { data: r } = await supabaseAdmin.from('retailers').select('user_id').eq('id', expected.retailerId).maybeSingle();
  if (r?.user_id) return;
  await recordConnectionStatus(expected.retailerId, 'invited', detail);
  await recordConnectIssue(expected.retailerId, code);
}

/**
 * The reason as a code the needs-help list can act on (lib/shop-status.ts).
 * `null` clears it, which is what happens when the shop connects. Best effort.
 */
async function recordConnectIssue(retailerId: string, code: HelpReason | null): Promise<void> {
  const allowed = code === null || ['cancelled', 'unticked', 'no_listing', 'wrong_account', 'google_error'].includes(code);
  if (!allowed) return;
  const { error } = await supabaseAdmin.from('retailers')
    .update({ connect_issue: code, connect_issue_at: code ? new Date().toISOString() : null })
    .eq('id', retailerId);
  if (error) console.error(`[auth] could not record why retailer ${retailerId} did not connect: ${error.message}`);
}

/** Hand a Google permission back when we are not going to keep it. Best effort. */
async function revokeQuietly(token: string | null | undefined): Promise<void> {
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch (err) {
    console.error('[auth] could not hand back an unused Google permission:', err);
  }
}
