/**
 * Safe-by-default automation rules (docs/build-plan-2026-11.md, item 7).
 *
 * 1. LOW-STAR REVIEWS GET A FIXED HOLDING REPLY. A 1 to 3 star review is where
 *    an AI reply can do real harm: admitting fault, offering a refund, arguing.
 *    So no AI text is ever drafted for one. The reply waiting for the shop's
 *    approval is the fixed wording below, which expresses regret without
 *    admitting anything and moves the conversation offline. It is published
 *    only when the shop approves it (attended), never on a timer.
 *
 * 2. A NEW SHOP APPROVES ITS FIRST THREE POSTS. Until three posts have been
 *    published, each new post is created as `awaiting_approval`, which the
 *    publisher never picks up. It only becomes publishable when the shop taps
 *    Approve. From the fourth post on, the existing behaviour applies: a Friday
 *    preview, and it publishes unless cancelled.
 *
 * 3. THE 24-HOUR PREVIEW EMAIL for posts awaiting approval is OFF by default.
 *    It sends only when EARLY_POST_PREVIEW_EMAILS=on. While it is off, posts
 *    awaiting approval simply wait: nothing is published, nothing is sent.
 */

export const APPROVAL_REQUIRED_POSTS = 3;
export const AWAITING_APPROVAL = 'awaiting_approval';
/** The status the publisher acts on: "publishes at scheduled_for unless cancelled". */
export const PUBLISHABLE = 'pending_approval';
export const PREVIEW_HOURS_BEFORE = 24;

/** First name only, used only if it is plainly a name (letters, apostrophe, hyphen); otherwise none. */
function firstNameOf(reviewerName: string | null | undefined): string {
  const first = String(reviewerName || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'-]{0,29}$/.test(first) ? first : '';
}

/**
 * The holding reply for a 1 to 3 star review. Regret, not admission: no fault,
 * no refund, no promise, no argument. Deliberately identical for everyone, so
 * it is written and checked once.
 */
export function holdingReply(reviewerName: string | null | undefined): string {
  const name = firstNameOf(reviewerName);
  return `${name ? `Thank you for your feedback, ${name}.` : 'Thank you for your feedback.'} ` +
    "We're sorry to hear your experience wasn't what you hoped for. " +
    "We'd like to understand more, so please contact us directly and we'll look into it.";
}

/** Lowest star rating an AI reply may ever be written for. Below it: the holding reply, or nothing. */
export const AI_REPLY_MIN_RATING = 4;

/**
 * May an AI reply be written for a review with this rating? Only 4 and 5 stars.
 * An unknown or unparseable rating (0, NaN) is treated as low: when in doubt,
 * no AI reply.
 */
export function aiReplyAllowed(rating: number): boolean {
  return Number.isFinite(rating) && rating >= AI_REPLY_MIN_RATING;
}

/** Does the next post for this shop need explicit approval? */
export function requiresPostApproval(publishedPostCount: number): boolean {
  return publishedPostCount < APPROVAL_REQUIRED_POSTS;
}

/** How many more approvals before posts switch to "publishes unless cancelled". */
export function approvalsRemaining(publishedPostCount: number): number {
  return Math.max(0, APPROVAL_REQUIRED_POSTS - publishedPostCount);
}

/** Off unless Liam turns it on. */
export function earlyPreviewEmailsEnabled(): boolean {
  return (process.env.EARLY_POST_PREVIEW_EMAILS || '').trim().toLowerCase() === 'on';
}

/** Posts awaiting approval, due within 24 hours, not yet previewed. Pure. */
export function postsDueForPreview<T extends { status: string; scheduled_for: string; preview_sent_at?: string | null }>(posts: T[], now: Date): T[] {
  const horizon = now.getTime() + PREVIEW_HOURS_BEFORE * 3_600_000;
  return posts.filter((p) => p.status === AWAITING_APPROVAL && !p.preview_sent_at && Date.parse(p.scheduled_for) <= horizon);
}

/**
 * Words a review reply must never contain: admissions of fault, refunds,
 * compensation, discounts, legal or insurance talk. Applied to every reply,
 * including AI replies to 4 and 5 star reviews.
 */
export const FORBIDDEN_REPLY_PATTERNS: RegExp[] = [
  /\brefund/i, /\bcompensat/i, /money\s*back/i, /free\s+of\s+charge/i, /\bdiscount/i, /\bvoucher/i,
  /\bour\s+fault\b/i, /\bour\s+mistake\b/i, /\bwe\s+got\s+it\s+wrong\b/i, /\bwe\s+failed\b/i, /\bwe\s+messed\s+up\b/i,
  /\bliab(le|ility)\b/i, /\blegal\b/i, /\bsolicitor/i, /\binsurance\b/i, /\bombudsman\b/i,
];

/**
 * Does this text contain something that reads as a phone number? A leading
 * +44 or 0, then at least nine more digits, however they are spaced or
 * punctuated: 07700 900123, 0113-496-0000, +44 (0)7700 900123, 0800 123 4567.
 * The earlier check only knew 01, 02 and 07 with spaces, so a hyphenated number
 * in a shop's sign-off went straight through to a published post.
 */
export function containsPhoneNumber(text: string): boolean {
  const candidates = text.match(/(?:\+\s?44|(?<![\d.])0)[\d\s().\-]{8,24}/g) || [];
  return candidates.some((c) => c.replace(/\D/g, '').length >= 10);
}

export function replyBreaksRules(text: string): string | null {
  const hit = FORBIDDEN_REPLY_PATTERNS.find((re) => re.test(text));
  return hit ? `contains forbidden reply wording (${hit.source})` : null;
}
