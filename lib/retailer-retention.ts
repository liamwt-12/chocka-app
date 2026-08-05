// ── Retention rules for retailer records ────────────────────────────────────
//
// `retailers` had no retention policy at all: nothing ever deleted a record, and
// `retailers.user_id` is `on delete set null`, so records survive account
// deletion by design. Indefinite retention of personal data with no stated
// period weighs directly against the legitimate-interests basis the /privacy
// notice relies on — see LEGITIMATE_INTERESTS_ASSESSMENT.md §3.
//
// The decision is pure and lives here rather than inline in the cron route, for
// the obvious reason: this is the code that DELETES REAL RECORDS, and it should
// be exhaustively testable without a database.

/**
 * How long a delisted retailer is kept before deletion.
 *
 * Six months. Long enough that a seasonal drop from Tarkett's locator, or a
 * retailer briefly changing supplier, does not destroy their baseline and score
 * history; short enough to be a real limit rather than a gesture.
 */
export const RETENTION_GRACE_DAYS = 183;

export interface RetentionCandidate {
  id: string;
  name?: string | null;
  /** Set when a retailer has claimed this record by connecting their account. */
  user_id?: string | null;
  /** When a refresh last completed WITHOUT finding this retailer. */
  delisted_at?: string | null;
}

export type RetentionDecision =
  | { action: 'keep'; reason: string }
  | { action: 'delete'; ageDays: number; reason: string };

/**
 * Should this retailer record be deleted?
 *
 * The clock runs from `delisted_at` — the moment a refresh completed and did NOT
 * find them — never from `last_seen_at`. That distinction is the whole safety
 * property: if refreshes stop running, nothing gets delisted, so nothing ages
 * towards deletion. A gap in the schedule cannot quietly consume the dataset.
 */
export function retentionDecision(
  r: RetentionCandidate | null | undefined,
  now: Date,
  graceDays: number = RETENTION_GRACE_DAYS,
): RetentionDecision {
  if (!r) return { action: 'keep', reason: 'no row' };

  // FIRST, and never reorderable: a retailer who has connected their account is
  // a live user of the service. Their record is no longer just a copy of
  // Tarkett's list, it is the thing their dashboard and score history hang off.
  // Deleting it because they dropped off a supplier's store locator would take a
  // working account down with it.
  if (r.user_id) {
    return { action: 'keep', reason: 'claimed by a connected account' };
  }

  if (!r.delisted_at) {
    return { action: 'keep', reason: 'not delisted' };
  }

  const delisted = new Date(r.delisted_at);
  if (isNaN(delisted.getTime())) {
    // Unparseable timestamp: keep. The failure mode of guessing wrong here is
    // deleting a real business's record, so an unreadable date is never taken as
    // licence to act.
    return { action: 'keep', reason: `unparseable delisted_at (${r.delisted_at})` };
  }

  const ageDays = Math.floor((now.getTime() - delisted.getTime()) / 86400000);

  // A future timestamp means clock skew or a bad write. Same reasoning: keep.
  if (ageDays < 0) {
    return { action: 'keep', reason: `delisted_at is in the future (${r.delisted_at})` };
  }

  if (ageDays < graceDays) {
    return { action: 'keep', reason: `delisted ${ageDays}d ago, grace is ${graceDays}d` };
  }

  return {
    action: 'delete',
    ageDays,
    reason: `delisted ${ageDays}d ago, past the ${graceDays}d grace period`,
  };
}

/** Split a set of candidates into what to delete and what to keep. */
export function partitionForRetention(
  rows: RetentionCandidate[],
  now: Date,
  graceDays: number = RETENTION_GRACE_DAYS,
): { deletable: Array<RetentionCandidate & { decision: RetentionDecision }>; kept: number } {
  const deletable: Array<RetentionCandidate & { decision: RetentionDecision }> = [];
  let kept = 0;
  for (const r of rows) {
    const decision = retentionDecision(r, now, graceDays);
    if (decision.action === 'delete') deletable.push({ ...r, decision });
    else kept++;
  }
  return { deletable, kept };
}
