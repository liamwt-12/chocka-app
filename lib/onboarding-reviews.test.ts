import { describe, it, expect } from 'vitest';
import { planOnboardingHoldingReplies, queueOnboardingHoldingReplies, pendingRepliesForDashboard, ONBOARDING_HOLDING_CAP, type OnboardingReview } from './onboarding-reviews';
import { BACKLOG_DAYS, ONBOARDING_REPLY_CAP } from './review-intake';
import { holdingReply, replyBreaksRules } from './safe-automation';

const NOW = Date.parse('2026-11-16T09:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const ratingOf = (r: OnboardingReview) => STARS[r.starRating || ''] ?? 0;
const rev = (id: string, starRating: string, ageDays: number | null, over: Partial<OnboardingReview> = {}): OnboardingReview => ({
  name: `accounts/1/locations/2/reviews/${id}`, reviewId: id, starRating,
  createTime: ageDays === null ? undefined : daysAgo(ageDays),
  comment: 'Fitter was late.', reviewer: { displayName: 'Sam Jones' }, ...over,
});

describe('planOnboardingHoldingReplies', () => {
  it('queues recent, unanswered 1 to 3 star reviews, newest first', () => {
    const plan = planOnboardingHoldingReplies([rev('a', 'TWO', 10), rev('b', 'ONE', 2), rev('c', 'THREE', 5)], ratingOf, NOW);
    expect(plan.toQueue.map((r) => r.reviewId)).toEqual(['b', 'c', 'a']);
    expect([plan.tooOld, plan.overCap]).toEqual([0, 0]);
  });
  it('never touches 4 and 5 star reviews, or a review with no readable rating', () => {
    const plan = planOnboardingHoldingReplies([rev('a', 'FOUR', 1), rev('b', 'FIVE', 1), rev('c', 'STAR_RATING_UNSPECIFIED', 1), rev('d', '', 1)], ratingOf, NOW);
    expect(plan.toQueue).toEqual([]);
  });
  it('never touches a review that already has a reply on Google', () => {
    expect(planOnboardingHoldingReplies([rev('a', 'ONE', 1, { reviewReply: { comment: 'Sorry to hear that' } })], ratingOf, NOW).toQueue).toEqual([]);
  });
  it('the 14-day rule: older reviews, undated reviews and impossible dates get nothing', () => {
    const plan = planOnboardingHoldingReplies([rev('edge', 'ONE', BACKLOG_DAYS - 0.01), rev('old', 'ONE', BACKLOG_DAYS + 0.01), rev('ancient', 'TWO', 400), rev('undated', 'ONE', null), rev('future', 'ONE', -30)], ratingOf, NOW);
    expect(plan.toQueue.map((r) => r.reviewId)).toEqual(['edge']);
    expect(plan.tooOld).toBe(4);
  });
  it('is capped, keeping the newest', () => {
    const many = Array.from({ length: ONBOARDING_HOLDING_CAP + 3 }, (_, i) => rev(`r${i}`, 'ONE', i * 0.5));
    const plan = planOnboardingHoldingReplies(many, ratingOf, NOW);
    expect(plan.toQueue).toHaveLength(ONBOARDING_HOLDING_CAP);
    expect(plan.toQueue[0].reviewId).toBe('r0');
    expect(plan.overCap).toBe(3);
  });
  it('leaves the existing cap on AI replies at onboarding alone', () => {
    expect(ONBOARDING_REPLY_CAP).toBe(20);
    expect(ONBOARDING_HOLDING_CAP).toBe(10);
  });
});

/** A fake of the two tables, recording every write. */
function fakeDb(seed: { reviews?: any[]; review_replies?: any[] } = {}, opts: { failReplyInsert?: boolean; failReviewInsert?: boolean } = {}) {
  const tables: Record<string, any[]> = { reviews: [...(seed.reviews || [])], review_replies: [...(seed.review_replies || [])] };
  const writes: Array<{ table: string; row: any }> = [];
  const calledTables: string[] = [];
  return {
    tables, writes, calledTables,
    from(table: string) {
      calledTables.push(table);
      const filters: Record<string, any> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filters[k] = v; return q; },
        limit: async () => ({ data: tables[table].filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)), error: null }),
        insert: (row: any) => {
          const fail = (table === 'review_replies' && opts.failReplyInsert) || (table === 'reviews' && opts.failReviewInsert);
          const stored = { id: `${table}-${tables[table].length + 1}`, ...row };
          if (!fail) { tables[table].push(stored); writes.push({ table, row }); }
          const res = fail ? { data: null, error: { message: 'db down' } } : { data: { id: stored.id }, error: null };
          return { select: () => ({ single: async () => res }), then: (resolve: any) => resolve(res) };
        },
      };
      return q;
    },
  };
}

describe('queueOnboardingHoldingReplies', () => {
  it('stores the review and a PENDING holding reply, and nothing else', async () => {
    const db = fakeDb();
    const r = await queueOnboardingHoldingReplies(db, 'p1', [rev('a', 'TWO', 3)], ratingOf, NOW);
    expect(r).toEqual({ queued: 1, alreadyHandled: 0, tooOld: 0, overCap: 0, failed: 0 });
    expect(db.writes).toEqual([
      { table: 'reviews', row: { profile_id: 'p1', google_review_id: 'a', reviewer_name: 'Sam Jones', rating: 2, comment: 'Fitter was late.', review_date: daysAgo(3) } },
      { table: 'review_replies', row: { review_id: 'reviews-1', reply_content: holdingReply('Sam Jones'), status: 'pending' } },
    ]);
  });

  it('the stored text is the fixed holding reply: no refund, no fault, no promise', async () => {
    const db = fakeDb();
    await queueOnboardingHoldingReplies(db, 'p1', [rev('a', 'ONE', 1, { comment: 'I want a refund, this was your fault!' })], ratingOf, NOW);
    const text = db.tables.review_replies[0].reply_content;
    expect(text).toBe("Thank you for your feedback, Sam. We're sorry to hear your experience wasn't what you hoped for. We'd like to understand more, so please contact us directly and we'll look into it.");
    expect(replyBreaksRules(text)).toBeNull();
    expect(text).not.toMatch(/refund|fault|compensat|discount|guarantee/i);
  });

  it('never stores anything as published, and only ever touches its two tables (no Google, no email, no SMS)', async () => {
    const db = fakeDb();
    await queueOnboardingHoldingReplies(db, 'p1', [rev('a', 'ONE', 1), rev('b', 'THREE', 2), rev('c', 'FIVE', 1), rev('d', 'ONE', 90)], ratingOf, NOW);
    expect(db.tables.review_replies.map((x) => x.status)).toEqual(['pending', 'pending']);
    expect(db.tables.review_replies.every((x) => !('published_at' in x))).toBe(true);
    expect(new Set(db.calledTables)).toEqual(new Set(['reviews', 'review_replies']));
    expect(db.tables.reviews.map((x) => x.google_review_id)).toEqual(['a', 'b']); // the 5 star and the 90-day-old one were not even recorded
  });

  it('does not queue twice: running onboarding again changes nothing', async () => {
    const db = fakeDb();
    const reviews = [rev('a', 'ONE', 1), rev('b', 'TWO', 2)];
    await queueOnboardingHoldingReplies(db, 'p1', reviews, ratingOf, NOW);
    const again = await queueOnboardingHoldingReplies(db, 'p1', reviews, ratingOf, NOW);
    expect(again).toMatchObject({ queued: 0, alreadyHandled: 2 });
    expect(db.tables.review_replies).toHaveLength(2);
  });

  it('leaves alone a review the shop already rejected or we already published', async () => {
    const db = fakeDb({ reviews: [{ id: 'rv1', profile_id: 'p1', google_review_id: 'a' }, { id: 'rv2', profile_id: 'p1', google_review_id: 'b' }], review_replies: [{ id: 'x', review_id: 'rv1', status: 'rejected' }, { id: 'y', review_id: 'rv2', status: 'published' }] });
    const r = await queueOnboardingHoldingReplies(db, 'p1', [rev('a', 'ONE', 1), rev('b', 'ONE', 1)], ratingOf, NOW);
    expect(r).toMatchObject({ queued: 0, alreadyHandled: 2 });
    expect(db.writes).toEqual([]);
  });

  it('uses a review row that already exists (recorded by the daily check) rather than making a second', async () => {
    const db = fakeDb({ reviews: [{ id: 'rv1', profile_id: 'p1', google_review_id: 'a' }] });
    const r = await queueOnboardingHoldingReplies(db, 'p1', [rev('a', 'ONE', 1)], ratingOf, NOW);
    expect(r.queued).toBe(1);
    expect(db.writes).toEqual([{ table: 'review_replies', row: { review_id: 'rv1', reply_content: holdingReply('Sam Jones'), status: 'pending' } }]);
  });

  it('a database failure on one review is counted and does not stop the rest or throw', async () => {
    expect(await queueOnboardingHoldingReplies(fakeDb({}, { failReplyInsert: true }), 'p1', [rev('a', 'ONE', 1), rev('b', 'ONE', 2)], ratingOf, NOW)).toMatchObject({ queued: 0, failed: 2 });
    expect(await queueOnboardingHoldingReplies(fakeDb({}, { failReviewInsert: true }), 'p1', [rev('a', 'ONE', 1)], ratingOf, NOW)).toMatchObject({ queued: 0, failed: 1 });
    expect(await queueOnboardingHoldingReplies({ from: () => { throw new Error('down'); } }, 'p1', [rev('a', 'ONE', 1)], ratingOf, NOW)).toMatchObject({ queued: 0, failed: 1 });
  });

  it('a reviewer name that is not plainly a name is left out of the reply', async () => {
    const db = fakeDb();
    await queueOnboardingHoldingReplies(db, 'p1', [rev('a', 'ONE', 1, { reviewer: { displayName: '<b>refund</b> now' } })], ratingOf, NOW);
    expect(db.tables.review_replies[0].reply_content).toMatch(/^Thank you for your feedback\. /);
  });
});

describe('pendingRepliesForDashboard', () => {
  const hashFor = (id: string) => `h-${id}`;
  it('gives each pending reply its signed approve and handle-it-myself addresses', () => {
    const out = pendingRepliesForDashboard([{ id: 'rr1', reply_content: 'Thank you for your feedback.', reviews: { id: 'rv 1', reviewer_name: 'Sam Jones', rating: 2, comment: 'Late.', review_date: daysAgo(2) } }], hashFor);
    expect(out).toEqual([{ reviewerName: 'Sam Jones', rating: 2, comment: 'Late.', date: daysAgo(2), reply: 'Thank you for your feedback.', approveUrl: '/api/reviews/auto-reply?action=approve&review_id=rv%201&hash=h-rv 1', rejectUrl: '/api/reviews/auto-reply?action=reject&review_id=rv%201&hash=h-rv 1' }]);
  });
  it('drops a row whose review is missing, and trims a very long comment', () => {
    const out = pendingRepliesForDashboard([
      { id: 'rr1', reply_content: 'x', reviews: null },
      { id: 'rr2', reply_content: 'x', reviews: { id: 'rv2', reviewer_name: null, rating: null, comment: 'y'.repeat(900), review_date: null } },
    ], hashFor);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reviewerName: 'A customer', rating: 0 });
    expect(out[0].comment).toHaveLength(400);
  });
});
