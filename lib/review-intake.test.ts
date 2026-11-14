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
