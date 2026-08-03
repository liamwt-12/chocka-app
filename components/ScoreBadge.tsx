import { BADGE_LABEL, BADGE_DESCRIPTION, type ScoreBadge as Badge } from '@/lib/retailer-score';

/**
 * The badge that says WHERE a score came from.
 *
 * This exists because there are two scores in this product and they are not the
 * same measurement. `audited` is `publicAudit.scorePlace` — three public signals,
 * scraped before launch, no OAuth. `connected` is the full audit of a profile the
 * retailer connected themselves, which sees far more. A number is meaningless
 * without knowing which one it is, so the badge is not decoration: it is the
 * label that makes the number honest.
 *
 * Copy comes from BADGE_LABEL / BADGE_DESCRIPTION in lib/retailer-score so it
 * cannot drift between the invite page and the dashboard.
 *
 * The two are deliberately styled to look DIFFERENT rather than like two states
 * of one thing — same reason they are never drawn as one series.
 */
export function ScoreBadge({ badge, withDescription = false }: { badge: Badge; withDescription?: boolean }) {
  const isLive = badge === 'connected';
  return (
    <div>
      <span
        className={
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ' +
          (isLive
            ? 'bg-green-100 text-green-800 ring-1 ring-green-200'
            : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200')
        }
      >
        <span
          aria-hidden="true"
          className={'h-1.5 w-1.5 rounded-full ' + (isLive ? 'bg-green-600' : 'bg-gray-400')}
        />
        {BADGE_LABEL[badge]}
      </span>
      {withDescription && (
        <p className="mt-2 text-xs leading-relaxed text-gray-500">{BADGE_DESCRIPTION[badge]}</p>
      )}
    </div>
  );
}

/**
 * "Previously audited at N" — the ONLY sanctioned way to show a batch score
 * beside a live one.
 *
 * `resolveRetailerScore` returns `supersededBatchScore` and deliberately returns
 * no delta or trend field; a test asserts those stay absent. This component is
 * the rendering half of that decision: a separate, differently-labelled
 * statement, never an arrow, never a change, never a second point on the same
 * line. Two measurements of different things cannot be subtracted.
 */
export function SupersededScore({ score, scoredAt }: { score: number; scoredAt?: string | null }) {
  const when = scoredAt
    ? new Date(scoredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <p className="text-xs text-gray-500">
        Separately, our pre-launch scan of public Google data scored this business{' '}
        <span className="font-semibold text-gray-700">{score}</span>
        {when ? ` on ${when}` : ''}.
      </p>
      <p className="mt-1 text-xs text-gray-400">
        That scan saw less than the full audit above, so the two are not comparable and the difference
        between them is not a change in your profile.
      </p>
    </div>
  );
}

/**
 * Shown instead of a number when the score rests on a match nobody could
 * confirm. `needsVerification` is true for anything that is not an explicit
 * `high` — trust is opt-in, because the 2026-07-30 verification found rows
 * scoring an entirely different business, and one row carried a hard 0 for a
 * business that actually scores 98.
 */
export function UnverifiedScoreNotice({ businessName }: { businessName?: string | null }) {
  return (
    <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <p className="text-sm font-semibold text-amber-900">We haven&apos;t confirmed your score yet</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        Our pre-launch scan couldn&apos;t confirm which Google listing
        {businessName ? ` belongs to ${businessName}` : ' belongs to this business'}, so we&apos;re not
        showing a number we can&apos;t stand behind. Connecting your profile gives you a real one.
      </p>
    </div>
  );
}
