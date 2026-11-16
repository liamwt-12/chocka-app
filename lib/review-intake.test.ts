import { describe, it, expect } from 'vitest';
import { splitNewReviews, reviewKey, BACKLOG_DAYS, MAX_NEW_REVIEWS_PER_RUN } from './review-intake';

const NOW = Date.UTC(2026, 10, 14, 9, 0, 0);
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const rev = (id: string, d: number | null) => ({ name: `locations/1/reviews/${id}`, reviewId: id, createTime: d === null ? undefined : daysAgo(d) });

describe('splitNewReviews', () => {
  it('skips reviews already seen', () => {
    const r = splitNewReviews([rev('a', 1), rev('b', 1)], new Set(['a']), NOW);
    expect(r.toHandle.map(reviewKey)).toEqual(['b']);
  });

  it('records old reviews as backlog instead of alerting on them', () => {
    const r = splitNewReviews([rev('new', 2), rev('old', BACKLOG_DAYS + 1), rev('ancient', 900)], new Set(), NOW);
    expect(r.toHandle.map(reviewKey)).toEqual(['new']);
    expect(r.backlog.map(reviewKey)).toEqual(['old', 'ancient']);
  });

  it('treats an undated review as backlog', () => {
    expect(splitNewReviews([rev('x', null)], new Set(), NOW).backlog).toHaveLength(1);
  });

  it('caps recent reviews per run and defers the rest, oldest first', () => {
    const many = Array.from({ length: MAX_NEW_REVIEWS_PER_RUN + 3 }, (_, i) => rev(`r${i}`, i % BACKLOG_DAYS));
    const r = splitNewReviews(many, new Set(), NOW);
    expect(r.toHandle).toHaveLength(MAX_NEW_REVIEWS_PER_RUN);
    expect(r.deferred).toHaveLength(3);
    const handledTimes = r.toHandle.map((x) => Date.parse(x.createTime!));
    const deferredTimes = r.deferred.map((x) => Date.parse(x.createTime!));
    expect(Math.max(...handledTimes)).toBeLessThanOrEqual(Math.min(...deferredTimes));
  });

  it('a deferred review is handled on the next run once the first batch is seen', () => {
    const many = Array.from({ length: 12 }, (_, i) => rev(`r${i}`, 1 + i / 10));
    const first = splitNewReviews(many, new Set(), NOW);
    const seen = new Set(first.toHandle.map(reviewKey));
    const second = splitNewReviews(many, seen, NOW);
    expect(second.toHandle.map(reviewKey).sort()).toEqual(first.deferred.map(reviewKey).sort());
  });

  it('falls back to the resource name as the key', () => {
    expect(reviewKey({ name: 'locations/1/reviews/z' })).toBe('locations/1/reviews/z');
  });
});

describe('reviews that already have a reply', () => {
  const answeredRev = (id: string, d: number) => ({ ...rev(id, d), reviewReply: { comment: 'Thanks, from the shop itself' } });

  it('are never handled, however recent: the shop (or onboarding) has already answered', () => {
    const r = splitNewReviews([rev('new', 1), answeredRev('by-owner', 1), answeredRev('old-answered', 200)], new Set(), NOW);
    expect(r.toHandle.map(reviewKey)).toEqual(['new']);
    expect(r.answered.map(reviewKey)).toEqual(['by-owner', 'old-answered']);
    expect(r.backlog).toEqual([]);
  });

  it('do not use up the per-run cap', () => {
    const many = [...Array.from({ length: 5 }, (_, i) => answeredRev(`ans${i}`, 1)), ...Array.from({ length: MAX_NEW_REVIEWS_PER_RUN }, (_, i) => rev(`new${i}`, 1))];
    const r = splitNewReviews(many, new Set(), NOW);
    expect(r.toHandle).toHaveLength(MAX_NEW_REVIEWS_PER_RUN);
    expect(r.deferred).toEqual([]);
    expect(r.answered).toHaveLength(5);
  });

  it('once recorded as seen, are not returned at all', () => {
    const r = splitNewReviews([answeredRev('by-owner', 1)], new Set(['by-owner']), NOW);
    expect([r.toHandle, r.backlog, r.deferred, r.answered]).toEqual([[], [], [], []]);
  });
});

describe('REVIEWS_CONFLICT_TARGET', () => {
  it('names the columns of the real unique index on reviews (tenant_id, google_review_id)', async () => {
    const { REVIEWS_CONFLICT_TARGET } = await import('./review-intake');
    const { readFileSync } = await import('node:fs');
    const schema = readFileSync(new URL('../supabase/schema/production-baseline.sql', import.meta.url), 'utf8');
    const index = /create unique index if not exists \w+ ON public\.reviews USING btree \(([^)]+)\)/.exec(schema);
    expect(index).not.toBeNull();
    expect(REVIEWS_CONFLICT_TARGET.split(',')).toEqual(index![1].split(',').map((c) => c.trim()));
    // And nothing unique exists on google_review_id alone, which is what the code used to name.
    expect(/unique[^\n]*public\.reviews[^\n]*\(google_review_id\)/i.test(schema)).toBe(false);
  });

  it('no upsert into reviews names anything else', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['../app/api/profile-fix/route.ts', '../app/api/cron/review-alerts/route.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).not.toMatch(/onConflict:\s*'google_review_id'/);
      expect(src).toMatch(/onConflict:\s*REVIEWS_CONFLICT_TARGET/);
    }
  });
});
