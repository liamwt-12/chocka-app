// Retailer invite landing page — surface 1 of the invite flow.
//
// A Tarkett retailer arrives here from an emailed magic link:
//
//     https://app.stellarlocal.co.uk/invite/<token>
//
// THIS PAGE NEVER MUTATES. It looks the invite up, decides what to show, and
// renders. Nothing is marked accepted here, because a GET is not a decision: mail
// clients, link scanners and chat previews all fetch URLs unbidden, and any of
// them would otherwise burn a single-use token before the retailer ever clicked.
// Acceptance is the POST behind the button, handled by /api/invite/accept.
//
// It is a server component because the token must be hashed and looked up
// server-side — the plaintext token must never reach a client bundle, and the
// service-role client must never be importable from one.
import { getRequestTenant } from '@/lib/tenant-request';
import { supabaseAdmin } from '@/lib/supabase';
import { hashInviteToken, checkInviteRedeemable } from '@/lib/invite-token';
import { resolveRetailerScore } from '@/lib/retailer-score';
import Button from '@/components/Button';

interface InviteRow {
  id: string;
  status: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  token_hash: string | null;
  retailers: {
    name: string;
    town: string | null;
    score: number | null;
    band: string | null;
    scored_at: string | null;
    match_confidence: string | null;
  } | null;
}

/**
 * Look the invite up by the hash of the presented token.
 *
 * maybeSingle() rather than single(): a token that matches nothing is the normal
 * case for a mistyped or already-cleaned-up link, not an exception.
 *
 * A thrown error here is deliberately NOT caught. hashInviteToken throws only when
 * CANCEL_HASH_SECRET is absent, which is a deployment fault — swallowing it would
 * show every retailer "this link is not valid" while the service looked healthy.
 * Better a visible 500 that gets fixed than 180 silently wrong rejections.
 */
async function loadInvite(token: string): Promise<InviteRow | null> {
  const { data, error } = await supabaseAdmin
    .from('retailer_invites')
    .select(
      'id,status,accepted_at,expires_at,token_hash,' +
        'retailers ( name, town, score, band, scored_at, match_confidence )',
    )
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle();

  if (error) {
    // A query failure is not the same as "no such invite" and must not be
    // reported to the retailer as an invalid link.
    console.error('Invite lookup failed:', error.message);
    throw new Error(`Invite lookup failed: ${error.message}`);
  }
  return (data as InviteRow | null) ?? null;
}

function Shell({ children }: { children: React.ReactNode }) {
  const tenant = getRequestTenant();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-extrabold text-brand mb-6" style={{ fontFamily: 'var(--hd)' }}>
          {tenant.brandName}
        </h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Dead ends.
 *
 * Expired and already-accepted are told apart from an unrecognised token on
 * purpose. That does reveal that a given token was once real — which is harmless
 * here, because a token is 32 bytes of CSPRNG output and nobody reaches this page
 * with a valid-but-expired one by guessing. The alternative, collapsing all three
 * into "invalid", would leave a retailer whose link simply lapsed with no idea
 * that asking for another would work.
 */
function DeadEnd({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <Shell>
      <div className="bg-white/60 rounded-2xl p-8 mb-6 border border-black/5">
        <h2 className="text-xl font-bold text-charcoal mb-3">{title}</h2>
        <p className="text-sm text-gray-500">{body}</p>
      </div>
      {action}
    </Shell>
  );
}

export default async function InvitePage({ params }: { params: { token: string } }) {
  const tenant = getRequestTenant();
  const invite = await loadInvite(params.token);
  const check = checkInviteRedeemable(invite, params.token);

  if (!check.redeemable) {
    if (check.reason === 'expired') {
      return (
        <DeadEnd
          title="This invite has expired"
          body={`Invites are valid for 30 days. Reply to the email that brought you here and we will send a fresh link.`}
        />
      );
    }
    if (check.reason === 'already-accepted') {
      return (
        <DeadEnd
          title="This invite has already been used"
          body="If you have already connected your Google Business Profile, sign in instead."
          action={
            <Button href="/login" size="lg" className="w-full">
              Sign in
            </Button>
          }
        />
      );
    }
    // 'not-pending' (revoked) and 'bad-token' both land here. They are not told
    // apart: a revoked invite is a deliberate withdrawal, and explaining that to
    // whoever holds the link is not this page's job.
    return (
      <DeadEnd
        title="This link is not valid"
        body="It may have been withdrawn, or the address may be incomplete. Check the link in your email, or reply to it and we will help."
      />
    );
  }

  // Redeemable. `invite` and `invite.retailers` are non-null here — checkInviteRedeemable
  // returns bad-token for a null invite — but the join is typed as nullable, so guard
  // rather than assert.
  const retailer = invite?.retailers;
  if (!retailer) {
    console.error(`Invite ${invite?.id} is redeemable but has no retailer row`);
    return (
      <DeadEnd
        title="This link is not valid"
        body="Something is wrong with this invite on our side. Reply to the email that brought you here and we will sort it out."
      />
    );
  }

  const resolved = resolveRetailerScore({
    score: retailer.score,
    band: retailer.band,
    scored_at: retailer.scored_at,
    match_confidence: retailer.match_confidence,
  });

  // Whether to put a number in front of the retailer at all.
  //
  // needsVerification is true when the score rests on a scrape match nobody
  // confirmed — exactly one of two match tests passed, and which one was never
  // recorded. The 2026-07-30 verification found 7 such rows scoring a DIFFERENT
  // business: Floor Store U.K's 91 belongs to a neighbour on the same industrial
  // estate. Showing a retailer someone else's score as their own is worse than
  // showing no score, so these get the invitation without the number.
  // See scripts/source-data/MATCH_VERIFICATION.md.
  const showScore = resolved.score !== null && !resolved.needsVerification;

  return (
    <Shell>
      <div className="bg-brand-light rounded-2xl p-8 mb-6">
        <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Invitation for</p>
        <h2 className="text-xl font-bold text-charcoal mb-1">{retailer.name}</h2>
        {retailer.town ? <p className="text-sm text-gray-500 mb-4">{retailer.town}</p> : null}

        {showScore ? (
          <>
            <div className="text-5xl font-extrabold text-brand mb-1" style={{ fontFamily: 'var(--hd)' }}>
              {resolved.score}
            </div>
            <p className="text-sm text-gray-500">
              Your Google presence scored {resolved.score} out of 100
              {resolved.band ? ` — ${resolved.band}` : ''}. Connect your profile to see what is
              costing you the rest.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">
            Connect your Google Business Profile and {tenant.brandName} will show you exactly how
            your listing looks to customers searching for you.
          </p>
        )}
      </div>

      {/*
        POST, not a link. The mutation belongs to the click, so that fetching this
        page — by a mail scanner, a chat preview, or a retailer reloading it — can
        never spend the token. The route lands in surface 2.
      */}
      <form action="/api/invite/accept" method="post">
        <input type="hidden" name="token" value={params.token} />
        <Button type="submit" size="lg" className="w-full">
          Connect my Google profile
        </Button>
      </form>

      <p className="text-xs text-gray-400 mt-4">
        Invited by {tenant.brandName} · free while in pilot
      </p>
    </Shell>
  );
}
