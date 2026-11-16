/**
 * Applying changes to a shop's listing, one small step at a time, and checking
 * each one.
 *
 * WHAT WAS WRONG. One request used to make every change: description, services,
 * categories, hours, then up to twenty review replies written by the model one
 * after another. With a busy listing that ran past the time a request is
 * allowed, was cut off partway, and the shop was shown "Sorted" either way,
 * because the screen never looked at the answer. Nothing was checked against
 * Google afterwards, and the score shown at the end was a prediction.
 *
 * WHAT THIS DOES INSTEAD.
 *   - Each change is its own short request (one field, one reply). None can run
 *     long, any of them can be repeated safely, and if the shop closes the page
 *     the rest are simply not done: the next look at the listing shows what is
 *     still missing. Google is the record of progress, so there is no "plan"
 *     table to get out of step with it.
 *   - Every change is the exact text the shop was shown and ticked. The server
 *     does not write anything of its own invention: no default hours, no reply
 *     the shop has not seen.
 *   - After a write, the field is read back from Google and compared. A step is
 *     reported as done only if Google now holds what was sent. Otherwise the
 *     shop is told what did not go through, in plain words.
 *   - The last step re-scores the listing from Google and that measured number
 *     is what the shop sees. There is no predicted score.
 *
 * Every write still goes through lib/change-log.ts, so each has its before-value
 * recorded first and can be undone.
 */
import * as google from './google';
import { loggedUpdateLocation, loggedReplyToReview, type WriteContext } from './change-log';
import { validateContent } from './ai';
import { containsPhoneNumber, replyBreaksRules, aiReplyAllowed, PUBLISHABLE } from './safe-automation';
import { validateHoursDraft, toGooglePeriods, samePeriods, describeHours } from './opening-hours';
import { ONBOARDING_REPLY_CAP, REVIEWS_CONFLICT_TARGET } from './review-intake';
import { queueOnboardingHoldingReplies } from './onboarding-reviews';
import { ukTomorrowAt } from './post-schedule';
import { scoreProfile, type AuditResult } from './audit';

export const STEPS = ['description', 'services', 'categories', 'hours', 'reply', 'lowStar', 'firstPost'] as const;
export type FixStep = (typeof STEPS)[number];

export interface StepResult {
  step: FixStep;
  /** True only when Google was read back and holds what was sent (or, for things we store ourselves, the row is saved). */
  ok: boolean;
  /** One plain sentence for the shop: what is now on the listing, or what did not go through. */
  message: string;
  /** Something the shop or support can act on, when it failed. */
  nextStep?: string;
  /** For support: the raw reason, trimmed. Never shown to the shop as the headline. */
  detail?: string;
  /** Worth pressing "try again" (Google was busy), as opposed to a refusal that will repeat. */
  retryable?: boolean;
}

/** Google's description limit. Text over this is refused by Google outright. */
export const DESCRIPTION_MAX = 750;
export const SERVICES_MAX = 20;
export const CATEGORIES_MAX = 4;

export interface FixContext {
  db: { from(table: string): any };
  accessToken: string;
  userId: string;
  profile: { id: string; google_location_name: string; google_account_id?: string | null; business_name?: string | null; category?: string | null; tenant_id?: string | null };
  /** Injected in tests. */
  g?: typeof google;
}

const logCtx = (c: FixContext): WriteContext => ({ db: c.db as any, source: 'onboarding', userId: c.userId, profileId: c.profile.id });

/** Turn whatever Google or the network said into words a shop owner can use. Pure. */
export function plainProblem(err: unknown): { message: string; nextStep: string; retryable: boolean; detail: string } {
  const raw = String((err as any)?.message ?? err ?? '');
  const status = Number((err as any)?.status) || Number(/\((\d{3})\)/.exec(raw)?.[1]) || Number(/"code":\s*(\d{3})/.exec(raw)?.[1]) || 0;
  const gs = String((err as any)?.googleStatus || /"status":\s*"([A-Z_]+)"/.exec(raw)?.[1] || '');
  const detail = raw.replace(/\s+/g, ' ').slice(0, 300);
  if (status === 429 || gs === 'RESOURCE_EXHAUSTED') return { message: 'Google was too busy to take this change.', nextStep: 'Nothing is wrong with your listing. Press "Try again" in a minute.', retryable: true, detail };
  if (status >= 500 || /fetch failed|network|ECONN|ETIMEDOUT/i.test(raw)) return { message: 'Google did not answer.', nextStep: 'Press "Try again" in a minute.', retryable: true, detail };
  if (status === 403 || gs === 'PERMISSION_DENIED') return { message: 'Google would not let us change this listing.', nextStep: 'This usually means the listing is not verified yet, or the Google account you signed in with can view it but not edit it. Ask whoever set the listing up to make you an owner or manager.', retryable: false, detail };
  if (status === 404 || gs === 'NOT_FOUND') return { message: 'Google could not find this any more.', nextStep: 'It may have been removed or changed on Google. Have a look at your listing on Google.', retryable: false, detail };
  if (status === 401 || /invalid_grant/.test(raw)) return { message: 'We have lost the connection to your Google account.', nextStep: 'Sign in with Google again from Settings.', retryable: false, detail };
  if (/change_log/.test(raw)) return { message: 'We could not keep a record of this change, so we did not make it.', nextStep: 'Press "Try again". If it keeps happening, tell us.', retryable: true, detail };
  return { message: 'Google did not accept this change.', nextStep: 'You can make this change yourself in Google, or tell us and we will look at why.', retryable: false, detail };
}

function failed(step: FixStep, err: unknown, lead?: string): StepResult {
  const p = plainProblem(err);
  return { step, ok: false, message: lead ? `${lead} ${p.message}` : p.message, nextStep: p.nextStep, retryable: p.retryable, detail: p.detail };
}

const refused = (step: FixStep, message: string, nextStep?: string): StepResult => ({ step, ok: false, message, nextStep, retryable: false });

// ── Description ────────────────────────────────────────────────────────────

/** Is this description fit to publish? Shop-edited text is held to the same rules as generated text, apart from length. */
export function descriptionProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < 30) return 'The description is too short to be useful. A few sentences is plenty.';
  if (t.length > DESCRIPTION_MAX) return `Google allows ${DESCRIPTION_MAX} characters for a description and this is ${t.length}. Please shorten it a little.`;
  if (/https?:\/\/|www\./i.test(t)) return 'Google does not allow web addresses in a description.';
  if (containsPhoneNumber(t)) return 'Google does not allow phone numbers in a description. Your number is shown separately on the listing.';
  return null;
}

export async function applyDescription(c: FixContext, text: unknown): Promise<StepResult> {
  const g = c.g ?? google;
  const t = typeof text === 'string' ? text.trim() : '';
  const problem = descriptionProblem(t);
  if (problem) return refused('description', problem, 'Change the wording and try again.');
  try {
    await loggedUpdateLocation(logCtx(c), c.accessToken, c.profile.google_location_name, 'profile', { profile: { description: t } });
    const now = await g.getLocationFields(c.accessToken, c.profile.google_location_name, ['profile']);
    if ((now?.profile?.description || '').trim() !== t) return { step: 'description', ok: false, message: 'We sent your description, but Google is not showing it yet.', nextStep: 'Google sometimes holds a change for review. Check your listing in a day or so; if it is not there, try again.', retryable: true };
    return { step: 'description', ok: true, message: 'Your description is on your listing.' };
  } catch (e) { return failed('description', e); }
}

// ── Services ───────────────────────────────────────────────────────────────

export function cleanNames(input: unknown, max: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const x of input) {
    const n = typeof x === 'string' ? x.trim().replace(/\s+/g, ' ') : '';
    if (n.length < 2 || n.length > 80) continue;
    if (!out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

const serviceName = (s: any): string => s?.freeFormServiceItem?.label?.displayName || s?.structuredServiceItem?.description || '';

export async function applyServices(c: FixContext, names: unknown): Promise<StepResult> {
  const g = c.g ?? google;
  const wanted = cleanNames(names, SERVICES_MAX);
  if (!wanted.length) return refused('services', 'There were no services to add.');
  try {
    // Services are attached to the listing's own main category, by Google's id
    // for it, and are ADDED to whatever is already there. Nothing the shop
    // listed itself is replaced.
    const now = await g.getLocationFields(c.accessToken, c.profile.google_location_name, ['categories', 'serviceItems']);
    const categoryId: string | undefined = now?.categories?.primaryCategory?.name;
    if (!categoryId) return refused('services', 'We could not tell which category your listing is in, so we could not add services to it.', 'Set a main category on your listing in Google, then try again.');
    const existing: any[] = Array.isArray(now?.serviceItems) ? now.serviceItems : [];
    const have = new Set(existing.map((s) => serviceName(s).toLowerCase()).filter(Boolean));
    const toAdd = wanted.filter((n) => !have.has(n.toLowerCase()));
    if (toAdd.length) {
      const serviceItems = [...existing, ...toAdd.map((name) => ({ freeFormServiceItem: { category: categoryId, label: { displayName: name, languageCode: 'en' } } }))];
      await loggedUpdateLocation(logCtx(c), c.accessToken, c.profile.google_location_name, 'serviceItems', { serviceItems });
    }
    const after = await g.getLocationFields(c.accessToken, c.profile.google_location_name, ['serviceItems']);
    const got = new Set(((after?.serviceItems || []) as any[]).map((s) => serviceName(s).toLowerCase()));
    const missing = wanted.filter((n) => !got.has(n.toLowerCase()));
    if (missing.length) return { step: 'services', ok: false, message: `Google is showing ${wanted.length - missing.length} of the ${wanted.length} services. Not showing: ${missing.join(', ')}.`, nextStep: 'You can add the missing ones yourself in Google, under Edit services.', retryable: true };
    return { step: 'services', ok: true, message: `${wanted.length} service${wanted.length === 1 ? ' is' : 's are'} on your listing.` };
  } catch (e) { return failed('services', e); }
}

// ── Categories ─────────────────────────────────────────────────────────────

export async function applyCategories(c: FixContext, names: unknown): Promise<StepResult> {
  const g = c.g ?? google;
  const wanted = cleanNames(names, CATEGORIES_MAX);
  if (!wanted.length) return refused('categories', 'There were no categories to add.');
  try {
    const now = await g.getLocationFields(c.accessToken, c.profile.google_location_name, ['categories']);
    const primary = now?.categories?.primaryCategory;
    if (!primary?.name) return refused('categories', 'We could not read your listing\'s main category, so we left the categories alone.', 'Set a main category on your listing in Google, then try again.');
    const existing: any[] = Array.isArray(now?.categories?.additionalCategories) ? now.categories.additionalCategories : [];
    // Google only accepts categories from its own list, by its own id. Each
    // name is looked up; one Google does not have is left out and said so,
    // rather than sent and refused along with the rest.
    const resolved: Array<{ name: string; displayName: string }> = [];
    const unknown: string[] = [];
    for (const n of wanted) {
      if (n.toLowerCase() === String(primary.displayName || '').toLowerCase() || existing.some((e) => String(e.displayName || '').toLowerCase() === n.toLowerCase())) continue;
      const hit = await g.findCategoryByName(c.accessToken, n);
      if (hit) resolved.push(hit); else unknown.push(n);
    }
    if (resolved.length) {
      // The main category is sent back exactly as Google gave it, so it cannot change.
      const additionalCategories = [...existing.map((e) => ({ name: e.name })), ...resolved.map((r) => ({ name: r.name }))].slice(0, 9);
      await loggedUpdateLocation(logCtx(c), c.accessToken, c.profile.google_location_name, 'categories', { categories: { primaryCategory: { name: primary.name }, additionalCategories } });
    }
    const after = await g.getLocationFields(c.accessToken, c.profile.google_location_name, ['categories']);
    if (after?.categories?.primaryCategory?.name !== primary.name) return { step: 'categories', ok: false, message: 'Your main category looks different after this change. Please check your listing on Google.', nextStep: 'Tell us straight away so we can put it back.', retryable: false };
    const got = new Set(((after?.categories?.additionalCategories || []) as any[]).map((x) => x.name));
    const notShown = resolved.filter((r) => !got.has(r.name)).map((r) => r.displayName);
    const left = [...unknown, ...notShown];
    const added = wanted.length - left.length;
    if (left.length) return { step: 'categories', ok: false, message: `${added ? `${added} added. ` : ''}Google does not have, or did not take: ${left.join(', ')}.`, nextStep: 'Nothing else was changed. You can pick a different category yourself in Google.', retryable: notShown.length > 0 };
    return { step: 'categories', ok: true, message: `${wanted.length} extra categor${wanted.length === 1 ? 'y is' : 'ies are'} on your listing.` };
  } catch (e) { return failed('categories', e); }
}

// ── Opening hours ──────────────────────────────────────────────────────────

export async function applyHours(c: FixContext, draft: unknown): Promise<StepResult> {
  const g = c.g ?? google;
  const v = validateHoursDraft(draft);
  if (!v.ok) return refused('hours', v.error, 'Correct the times and try again.');
  try {
    const periods = toGooglePeriods(v.value);
    await loggedUpdateLocation(logCtx(c), c.accessToken, c.profile.google_location_name, 'regularHours', { regularHours: { periods } });
    const after = await g.getLocationFields(c.accessToken, c.profile.google_location_name, ['regularHours']);
    if (!samePeriods(after?.regularHours?.periods, periods)) return { step: 'hours', ok: false, message: 'We sent your opening hours, but Google is not showing them as you set them.', nextStep: 'Check the hours on your listing in Google. If they are wrong, try again or change them there.', retryable: true };
    return { step: 'hours', ok: true, message: `Your opening hours are on your listing: ${describeHours(v.value).filter((l) => !l.endsWith('closed')).join('; ')}.` };
  } catch (e) { return failed('hours', e); }
}

// ── One review reply ───────────────────────────────────────────────────────

export function replyProblem(text: string): string | null {
  const check = validateContent(text, 'reply');
  if (!check.valid) return check.reason === 'length out of range' ? 'The reply is too short or too long.' : `The reply cannot be posted as written (${check.reason}).`;
  return replyBreaksRules(text);
}

/**
 * Post one reply the shop has seen, to one review. Safe to repeat: a review
 * that already has a reply is left exactly as it is.
 */
export async function applyReply(c: FixContext, reviewId: unknown, text: unknown): Promise<StepResult> {
  const g = c.g ?? google;
  const id = typeof reviewId === 'string' ? reviewId : '';
  const t = typeof text === 'string' ? text.trim() : '';
  if (!id) return refused('reply', 'We could not tell which review this reply was for.');
  const problem = replyProblem(t);
  if (problem) return refused('reply', problem, 'Change the wording, or leave this one for now.');
  try {
    const data = await g.getReviews(c.accessToken, c.profile.google_location_name, c.profile.google_account_id || undefined);
    const rev = (data.reviews || []).find((r: any) => (r.reviewId || r.name) === id);
    if (!rev) return refused('reply', 'That review is no longer on your listing.', 'Nothing was posted.');
    const rating = g.parseStarRating(rev.starRating);
    // Never an unattended reply to a 1 to 3 star review, whatever was sent here.
    if (!aiReplyAllowed(rating)) return refused('reply', 'Replies to lower-rated reviews are never posted from here.', 'They wait on your dashboard for you to approve one at a time.');
    if (rev.reviewReply?.comment) {
      return rev.reviewReply.comment.trim() === t
        ? { step: 'reply', ok: true, message: `Your reply to ${rev.reviewer?.displayName || 'this customer'} is on your listing.` }
        : refused('reply', 'This review already has a reply, so we left it alone.');
    }
    await loggedReplyToReview(logCtx(c), c.accessToken, rev.name, t, null);
    const name = rev.reviewer?.displayName || 'Customer';
    // Record it, so the daily check knows this review has been dealt with. The
    // reply is already live, so a failure here does not fail the step, but it is
    // said: unrecorded, the review would look new again tomorrow.
    const { error } = await c.db.from('reviews').upsert(
      { profile_id: c.profile.id, google_review_id: rev.reviewId || rev.name, reviewer_name: name, rating, comment: rev.comment || '', review_date: rev.createTime, reply_content: t },
      { onConflict: REVIEWS_CONFLICT_TARGET },
    );
    if (error) console.error(`[listing-fixes] replied to review ${id} but could not record it: ${error.message}`);
    return { step: 'reply', ok: true, message: `Your reply to ${name} is on your listing.` };
  } catch (e) { return failed('reply', e); }
}

/** The good reviews with no reply yet, newest first, up to the cap. What the shop is shown drafts for. Pure. */
export function reviewsNeedingReply(reviews: any[], parse: (s: string) => number, cap: number = ONBOARDING_REPLY_CAP): { list: any[]; total: number } {
  const all = (reviews || []).filter((r) => !r.reviewReply && aiReplyAllowed(parse(r.starRating)));
  return { list: all.slice(0, cap), total: all.length };
}

// ── Low-star reviews: queue the fixed holding reply for approval ───────────

export async function queueLowStar(c: FixContext): Promise<StepResult> {
  const g = c.g ?? google;
  try {
    const data = await g.getReviews(c.accessToken, c.profile.google_location_name, c.profile.google_account_id || undefined);
    const q = await queueOnboardingHoldingReplies(c.db, c.profile.id, data.reviews || [], (r: any) => g.parseStarRating(r.starRating));
    if (q.failed) return { step: 'lowStar', ok: false, message: `${q.queued} careful repl${q.queued === 1 ? 'y is' : 'ies are'} waiting for you; ${q.failed} could not be saved.`, nextStep: 'Press "Try again".', retryable: true };
    return { step: 'lowStar', ok: true, message: q.queued ? `${q.queued} careful repl${q.queued === 1 ? 'y is' : 'ies are'} waiting on your dashboard for you to approve. Nothing has been posted.` : 'No recent lower-rated reviews needed a reply.' };
  } catch (e) { return failed('lowStar', e); }
}

// ── First post ─────────────────────────────────────────────────────────────

/**
 * Schedule the post the shop has just read and ticked. Because the shop has
 * seen and agreed this exact wording, it does not wait for a second approval.
 * Safe to repeat: the same wording is not scheduled twice.
 */
export async function scheduleFirstPost(c: FixContext, text: unknown, now: Date = new Date()): Promise<StepResult> {
  const t = typeof text === 'string' ? text.trim() : '';
  const check = validateContent(t, 'post');
  if (!check.valid) return refused('firstPost', check.reason === 'length out of range' ? 'The post is too short or too long.' : `The post cannot go up as written (${check.reason}).`, 'Change the wording and try again.');
  try {
    const { data: same } = await c.db.from('scheduled_posts').select('id, status').eq('profile_id', c.profile.id).eq('content', t).limit(1);
    const when = ukTomorrowAt(10, now);
    if (!same?.length) {
      const { error } = await c.db.from('scheduled_posts').insert({ profile_id: c.profile.id, content: t, scheduled_for: when.toISOString(), status: PUBLISHABLE, approved_at: now.toISOString() });
      if (error) throw new Error(error.message);
    }
    return { step: 'firstPost', ok: true, message: 'Your first post is booked for tomorrow morning. It is not on Google yet; you can cancel it from your dashboard before then.' };
  } catch (e) {
    return { step: 'firstPost', ok: false, message: 'We could not save your first post.', nextStep: 'Press "Try again".', retryable: true, detail: String((e as any)?.message).slice(0, 200) };
  }
}

// ── Finish: measure, do not predict ────────────────────────────────────────

export interface Measured { audit: AuditResult; location: any }

/** Read the whole listing from Google and score it. Throws if the listing cannot be read: no honest number then. */
export async function measureListing(c: Pick<FixContext, 'accessToken' | 'profile' | 'g'>): Promise<Measured> {
  const g = c.g ?? google;
  const loc = c.profile.google_location_name, acct = c.profile.google_account_id || undefined;
  const location = await g.getLocationFull(c.accessToken, loc);
  const [googleUpdated, attributes, media, reviews, posts] = await Promise.all([
    g.getGoogleUpdated(c.accessToken, loc).catch(() => null),
    g.getAttributes(c.accessToken, loc).catch(() => ({ attributes: [] })),
    g.getMedia(c.accessToken, loc, acct).catch(() => ({ mediaItems: [] })),
    g.getReviews(c.accessToken, loc, acct).catch(() => ({ reviews: [] })),
    g.getLocalPosts(c.accessToken, loc, acct).catch(() => ({ localPosts: [] })),
  ]);
  return { audit: scoreProfile({ location, attributes, media, reviews, posts, googleUpdated }), location };
}
