/**
 * Low-star reviews found at onboarding.
 *
 * When a shop joins, its listing may already have 1 to 3 star reviews nobody
 * has answered. Until now onboarding left them with no reply at all. Now the
 * fixed holding reply (lib/safe-automation.ts) is QUEUED for each recent one,
 * for the shop to approve.
 *
 * THE RULES, all inherited rather than new:
 *
 *  1. NOTHING IS PUBLISHED HERE. A row is stored with status 'pending'. It goes
 *     on Google only when the shop presses approve, through the existing
 *     confirm-then-POST route (/api/reviews/auto-reply).
 *  2. NO AI. The text is the fixed holding reply: regret, no admission, no
 *     refund, no promise. It is still passed through the forbidden-wording
 *     check before it is stored, so a future edit to the wording cannot slip
 *     past.
 *  3. THE 14-DAY RULE. A review older than BACKLOG_DAYS, or with no usable
 *     date, gets nothing: no reply is drafted for it at all. Answering a
 *     months-old complaint out of the blue does more harm than silence.
 *  4. A CAP. At most ONBOARDING_HOLDING_CAP are queued, newest first. The cap
 *     on AI replies at onboarding (ONBOARDING_REPLY_CAP) is separate and
 *     unchanged.
 *  5. NOTHING IS SENT. No email, no text. The shop sees what is waiting on its
 *     dashboard.
 *  6. NEVER TWICE. A review that already has any reply row of ours (pending,
 *     published or rejected) is left as it is.
 *
 * A pure planner plus one helper with the database client passed in.
 */
import { BACKLOG_DAYS, reviewKey, type IntakeReview } from './review-intake';
import { holdingReply, replyBreaksRules, AI_REPLY_MIN_RATING } from './safe-automation';

/** Most holding replies queued in one onboarding. Same number review-alerts handles per run. */
export const ONBOARDING_HOLDING_CAP = 10;

export interface OnboardingReview extends IntakeReview {
  starRating?: string;
  comment?: string;
  reviewer?: { displayName?: string };
  reviewReply?: unknown;
}

export interface HoldingPlan<T> {
  /** Recent, low-star, unanswered, within the cap: a holding reply is queued. */
  toQueue: T[];
  /** Low-star and unanswered but older than the 14-day rule (or undated): left alone. */
  tooOld: number;
  /** Recent enough, but over the cap: left alone this time. */
  overCap: number;
}

/**
 * Which reviews get a queued holding reply. Pure. `ratingOf` turns Google's
 * star text into a number (parseStarRating), passed in so this file does not
 * import the Google client.
 */
export function planOnboardingHoldingReplies<T extends OnboardingReview>(
  reviews: T[],
  ratingOf: (r: T) => number,
  now: number = Date.now(),
): HoldingPlan<T> {
  const cutoff = now - BACKLOG_DAYS * 86_400_000;
  const lowStar = reviews.filter((r) => {
    const rating = ratingOf(r);
    // 1, 2 or 3 only. An unknown rating (0, NaN) gets nothing from anyone.
    return !r.reviewReply && Number.isFinite(rating) && rating >= 1 && rating < AI_REPLY_MIN_RATING;
  });
  const recent: T[] = [];
  let tooOld = 0;
  for (const r of lowStar) {
    const t = r.createTime ? Date.parse(r.createTime) : NaN;
    if (Number.isFinite(t) && t >= cutoff && t <= now + 86_400_000) recent.push(r);
    else tooOld++;
  }
  recent.sort((a, b) => Date.parse(b.createTime!) - Date.parse(a.createTime!)); // newest first
  return { toQueue: recent.slice(0, ONBOARDING_HOLDING_CAP), tooOld, overCap: Math.max(0, recent.length - ONBOARDING_HOLDING_CAP) };
}

export interface QueueDb { from(table: string): any }

export interface QueueResult { queued: number; alreadyHandled: number; tooOld: number; overCap: number; failed: number }

/**
 * Store a pending holding reply for each planned review. Publishes nothing and
 * sends nothing. One review failing does not stop the others.
 */
export async function queueOnboardingHoldingReplies<T extends OnboardingReview>(
  db: QueueDb,
  profileId: string,
  reviews: T[],
  ratingOf: (r: T) => number,
  now: number = Date.now(),
): Promise<QueueResult> {
  const plan = planOnboardingHoldingReplies(reviews, ratingOf, now);
  const result: QueueResult = { queued: 0, alreadyHandled: 0, tooOld: plan.tooOld, overCap: plan.overCap, failed: 0 };

  for (const review of plan.toQueue) {
    try {
      const googleReviewId = reviewKey(review);
      const reviewerName = review.reviewer?.displayName || 'A customer';
      const text = holdingReply(reviewerName);
      // The wording is fixed and passes today. Checked anyway, every time.
      if (replyBreaksRules(text)) { result.failed++; continue; }

      const { data: existing } = await db.from('reviews').select('id').eq('profile_id', profileId).eq('google_review_id', googleReviewId).limit(1);
      let reviewRowId: string | undefined = existing?.[0]?.id;

      if (reviewRowId) {
        const { data: replies } = await db.from('review_replies').select('id').eq('review_id', reviewRowId).limit(1);
        if (replies?.length) { result.alreadyHandled++; continue; }
      } else {
        const { data: inserted, error } = await db
          .from('reviews')
          .insert({
            profile_id: profileId,
            google_review_id: googleReviewId,
            reviewer_name: reviewerName,
            rating: ratingOf(review),
            comment: review.comment || '',
            review_date: review.createTime,
          })
          .select('id')
          .single();
        if (error || !inserted?.id) { result.failed++; continue; }
        reviewRowId = inserted.id;
      }

      // 'pending' is the status the approval route looks for. Never 'published'.
      const { error: replyError } = await db.from('review_replies').insert({ review_id: reviewRowId, reply_content: text, status: 'pending' });
      if (replyError) { result.failed++; continue; }
      result.queued++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

export interface PendingReplyRow {
  id: string;
  reply_content: string;
  reviews: { id: string; reviewer_name: string | null; rating: number | null; comment: string | null; review_date: string | null } | null;
}

/**
 * Pending replies shaped for the dashboard, each with its approve and "I'll
 * handle it" addresses. `hashFor` is generateReviewHash (lib/cron.ts). The
 * addresses are the same signed ones the alert email carries: opening one
 * shows a confirmation page, and only the button on that page does anything.
 */
export function pendingRepliesForDashboard(rows: PendingReplyRow[], hashFor: (reviewId: string) => string) {
  return rows
    .filter((r) => r.reviews?.id)
    .map((r) => {
      const review = r.reviews!;
      const q = `review_id=${encodeURIComponent(review.id)}&hash=${hashFor(review.id)}`;
      return {
        reviewerName: review.reviewer_name || 'A customer',
        rating: review.rating ?? 0,
        comment: (review.comment || '').slice(0, 400),
        date: review.review_date,
        reply: r.reply_content,
        approveUrl: `/api/reviews/auto-reply?action=approve&${q}`,
        rejectUrl: `/api/reviews/auto-reply?action=reject&${q}`,
      };
    });
}
