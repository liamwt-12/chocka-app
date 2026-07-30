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
import { hashInviteToken, checkInviteRedeemable, signInviteRef } from '@/lib/invite-token';

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
    token = typeof raw === 'string' && raw.length > 0 ? raw : null;
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
    .select('id,status,accepted_at,expires_at,token_hash,retailer_id')
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

  // Claim it. `.is('accepted_at', null)` is the single-use gate, enforced by the
  // database rather than by the check above: two concurrent submissions both pass
  // checkInviteRedeemable, and this is what makes exactly one of them win. The
  // loser gets zero rows back and is sent to the landing page, which will now say
  // the invite has already been used.
  //
  // status moves to 'accepted' as well, which releases the partial unique index on
  // (retailer_id) where status='pending' — so a retailer who accepts but abandons
  // before connecting Google can be re-invited without first revoking anything.
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('retailer_invites')
    .update({ accepted_at: now, status: 'accepted', updated_at: now })
    .eq('id', invite!.id)
    .is('accepted_at', null)
    .select('id');

  if (claimError) {
    console.error('Invite claim failed:', claimError.message);
    return NextResponse.json({ error: 'Could not process this invite' }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    console.log(`Invite ${invite!.id} was already claimed concurrently`);
    return backToInvite();
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
