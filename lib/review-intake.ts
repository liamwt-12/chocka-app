/**
 * Which reviews review-alerts should act on in this run.
 *
 * WHY THIS EXISTS. getReviews now returns every page of a listing's reviews,
 * not just the first. review-alerts sends an SMS and (for 4-5 stars) publishes
 * an AI reply for every review it has not seen before. Before this, a retailer's
 * first run could already fire up to one page (50) of those at once; with every
 * page it could be hundreds, years old, all on one morning. It would also run
 * the function out of time partway through.
 *
 * So unseen reviews are split three ways:
 *   - toHandle:  recent (within BACKLOG_DAYS) and within the per-run cap.
 *                Replied to and alerted, as before.
 *   - backlog:   older than BACKLOG_DAYS. Recorded so stats are complete and
 *                they are never picked up again, but not replied to or alerted.
 *                Replying to old reviews is the onboarding step's job, where
 *                the retailer asks for it.
 *   - deferred:  recent but over the cap. Left alone; the next run takes them.
 *   - answered:  already has a reply on Google when we first see it: the shop
 *                answered it itself, or we did at onboarding. Recorded, and
 *                NEVER replied to. Before this, a recent review the owner had
 *                answered by hand was treated as new, and our reply replaced
 *                theirs.
 */

/**
 * The columns the reviews table is unique on. An upsert must name exactly
 * these: naming google_review_id alone matches no unique index, so the
 * database refuses the whole statement, and every caller that did not check
 * the error recorded nothing at all.
 */
export const REVIEWS_CONFLICT_TARGET = 'tenant_id,google_review_id';
export const BACKLOG_DAYS = 14;
export const MAX_NEW_REVIEWS_PER_RUN = 10;

export interface IntakeReview {
  name: string;
  reviewId?: string;
  createTime?: string;
  /** Present when the review already has an owner's reply on Google. */
  reviewReply?: unknown;
  [k: string]: unknown;
}

export function reviewKey(r: IntakeReview): string {
  return r.reviewId || r.name;
}

export function splitNewReviews<T extends IntakeReview>(
  reviews: T[],
  seen: Set<string>,
  now: number = Date.now(),
  opts: { backlogDays?: number; maxPerRun?: number } = {},
): { toHandle: T[]; backlog: T[]; deferred: T[]; answered: T[] } {
  const backlogDays = opts.backlogDays ?? BACKLOG_DAYS;
  const maxPerRun = opts.maxPerRun ?? MAX_NEW_REVIEWS_PER_RUN;
  const cutoff = now - backlogDays * 86_400_000;

  const unseen = reviews.filter((r) => !seen.has(reviewKey(r)));
  const recent: T[] = [];
  const backlog: T[] = [];
  const answered: T[] = [];
  for (const r of unseen) {
    // Someone has already replied. Whatever its age, it is not ours to answer.
    if (r.reviewReply) { answered.push(r); continue; }
    const t = r.createTime ? Date.parse(r.createTime) : NaN;
    // No usable date: treat as backlog, so an undatable review can never
    // trigger an alert about something that may be years old.
    if (Number.isFinite(t) && t >= cutoff) recent.push(r);
    else backlog.push(r);
  }
  // Oldest recent first, so a deferred review is never starved by newer ones.
  recent.sort((a, b) => Date.parse(a.createTime!) - Date.parse(b.createTime!));
  return { toHandle: recent.slice(0, maxPerRun), backlog, deferred: recent.slice(maxPerRun), answered };
}

/**
 * Most review replies the onboarding "fix my profile" step writes in one go.
 * It runs inside a single web request that generates each reply with the AI
 * and posts it, one after another; with every page of reviews now visible, an
 * uncapped run on a well-reviewed listing would outlast the request timeout and
 * stop partway, with no record of where. Newest first (Google's order). The
 * onboarding preview shows the same capped number, so the screen never
 * promises more replies than the request will write.
 */
export const ONBOARDING_REPLY_CAP = 20;
