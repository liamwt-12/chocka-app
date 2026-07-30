// Invite acceptance — surface 2 of the invite flow.
//
// POST only, and that is the point. /invite/[token] renders without mutating
// because a GET is not a decision; this route is the decision. It marks the invite
// accepted, then hands the retailer to Google with the invite id riding in the
// OAuth `state` parameter.
//
// It does NOT create a users row. app/api/auth/callback/google deliberately
// refuses to create a user without a refresh token, and there is no credential yet
// at this point — Google has not been asked. The invite carries the identity across
// that gap: accepted_at set with user_id still null is exactly the state of someone
// who accepted and has not finished connecting.
//
// It also does not build the Google URL itself. The callback's no-code branch owns
// that, because the redirect_uri differs per tenant and Google requires the same
// value again at token-exchange time (see lib/google.ts). Duplicating that here
// would be a second place to get it wrong.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import {
  hashInviteToken,
  checkInviteRedeemable,
  signInviteRef,
  normaliseInviteToken,
} from '@/lib/invite-token';

export async function POST(request: NextRequest) {
  // Same tenant resolution as the OAuth callback: read the header middleware set
  // from the Host, rather than a process-wide env var that can only hold one brand.
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const baseUrl =
    tenant.slug === 'stellar' ? tenant.appUrl : process.env.NEXT_PUBLIC_APP_URL || request.url;

  let token: string | null = null;
  try {
    const form = await request.formData();
    const raw = form.get('token');
    // Normalised for the same reason as the landing page: whitespace in a token was
    // inserted in transit, and a retailer whose link got line-wrapped should not be
    // told their invite is invalid. See normaliseInviteToken.
    const cleaned = normaliseInviteToken(typeof raw === 'string' ? raw : null);
    token = cleaned.length > 0 ? cleaned : null;
  } catch {
    // Not form-encoded. Only our own page posts here, so this is a hand-made
    // request rather than a retailer to be helped.
    return NextResponse.json({ error: 'Expected a form submission' }, { status: 400 });
  }

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  // Bounce failures back to the landing page, which already renders a specific,
  // human explanation for each reason. 303 so the browser turns this POST into a
  // GET — without it the redirect would re-POST and the retailer could not reload
  // the result.
  const backToInvite = () =>
    NextResponse.redirect(new URL(`/invite/${encodeURIComponent(token!)}`, baseUrl), 303);

  const { data: invite, error } = await supabaseAdmin
    .from('retailer_invites')
    .select('id,status,accepted_at,user_id,expires_at,token_hash,retailer_id')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle();

  if (error) {
    // A query failure is not "invalid invite" — surfacing it as one would fail
    // silently for every retailer at once.
    console.error('Invite accept lookup failed:', error.message);
    return NextResponse.json({ error: 'Could not process this invite' }, { status: 500 });
  }

  const check = checkInviteRedeemable(invite, token);
  if (!check.redeemable) {
    console.log(`Invite accept refused (${check.reason})`);
    return backToInvite();
  }

  // Record the FIRST click, and nothing more.
  //
  // This used to be the single-use gate — `accepted_at` was set here and
  // checkInviteRedeemable rejected on it, so one click spent the token whether or
  // not Google ever completed. A retailer who stalled at Google's passkey prompt
  // came back to "already been used" without ever having signed in. Every ordinary
  // interruption did the same. See lib/invite-token for the full note.
  //
  // Now `accepted_at` is a funnel timestamp: when did this retailer first try. It
  // is written only when still null, so retries do not overwrite the original, and
  // the row count is deliberately ignored — a second attempt updating zero rows is
  // the normal case, not a failure.
  //
  // status stays 'pending' until the callback links a user. Leaving it pending also
  // keeps the partial unique index on (retailer_id) where status='pending' held, so
  // a half-finished invite cannot be shadowed by a second one minted alongside it.
  //
  // Single-use now lives in the callback, which claims retailers.user_id and
  // retailer_invites.user_id with conditional updates. That is where it belongs:
  // an invite is used when a retailer is linked, not when a button is pressed.
  const now = new Date().toISOString();
  const { error: stampError } = await supabaseAdmin
    .from('retailer_invites')
    .update({ accepted_at: now, updated_at: now })
    .eq('id', invite!.id)
    .is('accepted_at', null);

  if (stampError) {
    // Not fatal to the retailer's journey — the timestamp is for us, not them — but
    // it should not pass silently.
    console.error(`Invite ${invite!.id}: could not stamp accepted_at: ${stampError.message}`);
  }

  // Hand off to the OAuth initiator. `invite` is a signed reference to the row,
  // never the token — see lib/invite-token. The callback folds it into the
  // existing `state` envelope alongside action and plan.
  const next = new URL('/api/auth/callback/google', baseUrl);
  next.searchParams.set('invite', signInviteRef(invite!.id));
  return NextResponse.redirect(next, 303);
}

/**
 * Anything other than POST is refused explicitly rather than left to Next's
 * default, so a link scanner or a curious retailer following the URL cannot reach
 * the mutation and gets told why.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Use the button on your invite page' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
