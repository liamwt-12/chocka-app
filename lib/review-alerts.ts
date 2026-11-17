/**
 * Tell the shop about every new review, whether or not replies are switched on.
 *
 * WHY. Until now the review job only looked at shops with replies switched on,
 * so a shop that connected and switched nothing on never heard about a new
 * review at all: not a five-star one it would have been pleased to see, and
 * not a two-star one it needed to know about today. And a shop with replies on
 * was emailed about a low review but never about a good one.
 *
 * OFF unless REVIEW_ALERT_EMAILS=on. With it off the job behaves exactly as
 * it did: only shops with replies on are looked at, and no new email is sent.
 *
 * WITH IT ON
 *   - every connected shop is looked at (a held listing is still left out, as
 *     everywhere: lib/shop-status.ts)
 *   - a 4 or 5 star review: the shop is emailed. If replies are on, the email
 *     says what we replied. If they are off, nothing is replied and the email
 *     says so
 *   - a 1 to 3 star review at a shop with replies off: the fixed holding reply
 *     is drafted and the shop gets the same "approve it or handle it yourself"
 *     email as a shop with replies on. Nothing is posted unless it approves
 *   - what switching replies off, or pressing Pause, means is unchanged:
 *     nothing is ever posted for that shop without its say-so
 *
 * ONE DIFFERENCE IT MAKES LATER, on the careful side. With the switch off, a
 * shop with replies off is not looked at, so if it turns replies on, reviews
 * from the last 14 days are found then and answered. With the switch on, those
 * reviews were already recorded when they arrived (and the shop told), so
 * they are not answered later. The switch never causes a reply that would not
 * otherwise have been posted.
 *
 * ONLY REVIEWS SINCE THE SHOP JOINED. For a shop with replies off we have never
 * recorded its reviews, so the first look finds all of them. Only a review
 * left after the shop connected is news; anything older is recorded quietly.
 * (The existing rules already cap this further: nothing older than 14 days,
 * at most ten in a run: lib/review-intake.ts.)
 *
 * Pure: decides, does not send.
 */
import { aiReplyAllowed } from './safe-automation';

export function reviewAlertEmailsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.REVIEW_ALERT_EMAILS || '').trim().toLowerCase() === 'on';
}

/** What is done on Google for the review. */
export type ReplyAction =
  | 'ai_publish'        // 4 or 5 stars, replies on: an AI reply, checked, posted
  | 'holding_publish'   // 1 to 3 stars, hands-off: the fixed reply, posted
  | 'holding_draft'     // 1 to 3 stars: the fixed reply drafted, waiting for the shop
  | 'none';             // nothing is written or drafted

/** What the shop is sent. */
export type AlertKind =
  | 'good'              // "you have a new 4 or 5 star review" (new, behind the switch)
  | 'low_needs_input'   // the existing approve / handle-it-yourself email
  | 'low_replied'       // hands-off: "we have posted the holding reply"
  | 'none';

export interface ReviewFacts {
  rating: number;
  /** The shop has replies switched on. */
  repliesOn: boolean;
  /** The shop has pressed Pause. */
  paused: boolean;
  /** Hands-off is in force for this shop (lib/automation-mode.ts). */
  handsOff: boolean;
  /** REVIEW_ALERT_EMAILS is on. */
  alertsOn: boolean;
  /** The review was left after the shop connected. */
  sinceJoining: boolean;
  /** The review was left after the shop gave its hands-off permission. Only matters in hands-off. */
  sincePermission?: boolean;
}

export function planForReview(f: ReviewFacts): { reply: ReplyAction; alert: AlertKind } {
  const replying = f.repliesOn && !f.paused;
  if (aiReplyAllowed(f.rating)) {
    if (replying) return { reply: 'ai_publish', alert: f.alertsOn ? 'good' : 'none' };
    return { reply: 'none', alert: f.alertsOn && f.sinceJoining ? 'good' : 'none' };
  }
  // 1 to 3 stars, or a rating we could not read: never AI wording.
  // Posted unattended only in hands-off, only for a rating that really is 1 to
  // 3 (an unreadable rating might be a five: it is drafted, never posted), and
  // only for a review left after the shop gave its permission.
  const lowForCertain = f.rating >= 1 && f.rating <= 3;
  if (replying) return f.handsOff && lowForCertain && f.sincePermission === true ? { reply: 'holding_publish', alert: 'low_replied' } : { reply: 'holding_draft', alert: 'low_needs_input' };
  if (f.alertsOn && f.sinceJoining) return { reply: 'holding_draft', alert: 'low_needs_input' };
  return { reply: 'none', alert: 'none' };
}

/** Which shops the job looks at. With the switch off: exactly as before. */
export function shopsToCheck<U extends { auto_reply_enabled?: boolean | null; automation_paused_at?: string | null; profiles?: any[] | null }>(users: U[], alertsOn: boolean): U[] {
  // A paused shop with replies on is still looked at, so that a review that
  // arrives during the pause is recorded then (and not replied to), instead of
  // being found, and answered, in a burst when the shop presses Resume.
  return users.filter((u) => !!u.profiles?.[0] && (alertsOn || !!u.auto_reply_enabled));
}

/** Was this review left after the shop connected? An undatable review is treated as old. */
export function leftSinceJoining(reviewCreateTime: string | null | undefined, joinedAt: string | null | undefined): boolean {
  const r = reviewCreateTime ? Date.parse(reviewCreateTime) : NaN;
  const j = joinedAt ? Date.parse(joinedAt) : NaN;
  return Number.isFinite(r) && Number.isFinite(j) && r >= j;
}
