import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { snapshotFrom, snapshotColumns, networkReviews, MIN_SHOPS, MAX_AGE_DAYS, type ShopReviews } from './review-snapshot';
import { buildNetworkSummary, MIN_SHOPS_FOR_TOTALS } from './network-summary';
import { parseStarRating } from './google';
import { FORBIDDEN_CONSOLE_FIELDS } from './console-data';

const NOW = new Date('2026-12-10T09:00:00Z');
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const review = (stars: string, replied = false) => ({ starRating: stars, comment: 'A private comment', reviewer: { displayName: 'Jo Bloggs' }, ...(replied ? { reviewReply: { comment: 'Thanks' } } : {}) });
const shop = (o: Partial<ShopReviews> = {}): ShopReviews => ({ live: true, rating: 4.5, count: 100, read: 100, answered: 80, snapshotAt: '2026-12-09T09:00:00Z', ...o });

describe('the daily note for one listing', () => {
  it('keeps Google\'s own rating and count, and counts the reviews with a reply', () => {
    const s = snapshotFrom({ reviews: [review('FIVE', true), review('FOUR'), review('ONE', true)], averageRating: 3.3333, totalReviewCount: 3 }, parseStarRating);
    expect(s).toEqual({ rating: 3.33, count: 3, read: 3, answered: 2 });
  });
  it('when a listing has more reviews than we page through, the count is Google\'s and "read" is what we read', () => {
    const s = snapshotFrom({ reviews: [review('FIVE', true), review('FIVE')], averageRating: 4.8, totalReviewCount: 900 }, parseStarRating);
    expect(s).toEqual({ rating: 4.8, count: 900, read: 2, answered: 1 });
  });
  it('works the rating out from the reviews if Google gives none, and gives none for a listing with no reviews', () => {
    expect(snapshotFrom({ reviews: [review('FIVE'), review('FOUR')] }, parseStarRating)).toEqual({ rating: 4.5, count: 2, read: 2, answered: 0 });
    expect(snapshotFrom({ reviews: [] }, parseStarRating)).toEqual({ rating: null, count: 0, read: 0, answered: 0 });
    expect(snapshotFrom(null, parseStarRating)).toEqual({ rating: null, count: 0, read: 0, answered: 0 });
  });
  it('ignores a nonsense average or count rather than store it', () => {
    expect(snapshotFrom({ reviews: [review('FOUR')], averageRating: 47, totalReviewCount: -3 }, parseStarRating)).toEqual({ rating: 4, count: 1, read: 1, answered: 0 });
  });
  it('stores totals only: no review text and no reviewer', () => {
    const cols = snapshotColumns(snapshotFrom({ reviews: [review('FIVE', true)], averageRating: 5, totalReviewCount: 1 }, parseStarRating), NOW);
    expect(Object.keys(cols).sort()).toEqual(['review_count', 'review_rating', 'review_snapshot_at', 'reviews_answered', 'reviews_read']);
    expect(JSON.stringify(cols)).not.toMatch(/private comment|Jo Bloggs|Thanks/);
  });
});

describe('the network rating', () => {
  it('counts every review once, so a shop with many reviews weighs more', () => {
    const n = networkReviews([shop({ rating: 5, count: 10, read: 10, answered: 10 }), shop({ rating: 4, count: 10, read: 10, answered: 5 }), shop({ rating: 3, count: 80, read: 80, answered: 0 })], NOW);
    // (5x10 + 4x10 + 3x80) / 100 = 3.3, not the plain average of 4.0
    expect(n.rating).toBe(3.3);
    expect(n.totalReviews).toBe(100);
    expect(n.ratedShops).toBe(3);
  });
  it('is given to one decimal place', () => {
    expect(networkReviews([shop({ rating: 4.56, count: 1 }), shop({ rating: 4.56, count: 1 }), shop({ rating: 4.56, count: 1 })], NOW).rating).toBe(4.6);
  });
});

describe('the share of reviews answered', () => {
  it('is reviews with a reply over reviews read, across the network', () => {
    const n = networkReviews([shop({ read: 10, answered: 10 }), shop({ read: 10, answered: 5 }), shop({ read: 80, answered: 0 })], NOW);
    expect(n.shareAnswered).toBe(15);
    expect(n.answeredShops).toBe(3);
  });
  it('uses the reviews we could read, not Google\'s count, for a listing we could not read in full', () => {
    const n = networkReviews([shop({ count: 900, read: 100, answered: 100 }), shop({ read: 50, answered: 50 }), shop({ read: 50, answered: 0 })], NOW);
    expect(n.shareAnswered).toBe(75);
  });
  it('can never be more than 100%', () => {
    expect(networkReviews([shop({ read: 2, answered: 9 }), shop({ read: 2, answered: 2 }), shop({ read: 2, answered: 2 })], NOW).shareAnswered).toBe(100);
  });
});

describe('never from fewer than three shops', () => {
  it('uses the same floor as every other network total', () => {
    expect(MIN_SHOPS).toBe(3);
    expect(MIN_SHOPS).toBe(MIN_SHOPS_FOR_TOTALS);
  });
  it('two shops: no rating and no share, and it says why', () => {
    const n = networkReviews([shop(), shop()], NOW);
    expect(n).toMatchObject({ rating: null, totalReviews: null, shareAnswered: null });
    expect(n.note).toMatch(/shown from 3 shops, so that a network figure is never one shop's own/);
  });
  it('three shops: both', () => {
    expect(networkReviews([shop(), shop(), shop()], NOW)).toMatchObject({ rating: 4.5, totalReviews: 300, shareAnswered: 80 });
  });
  it('a shop that is not live does not count towards the three, or the figure', () => {
    const n = networkReviews([shop(), shop(), shop({ live: false, rating: 1, count: 1000, read: 1000, answered: 0 })], NOW);
    expect(n).toMatchObject({ rating: null, shareAnswered: null });
    const four = networkReviews([shop(), shop(), shop(), shop({ live: false, rating: 1, count: 1000, read: 1000, answered: 0 })], NOW);
    expect(four).toMatchObject({ rating: 4.5, shareAnswered: 80 });
  });
  it('a shop with no reviews does not count towards the three', () => {
    const n = networkReviews([shop(), shop(), shop({ rating: null, count: 0, read: 0, answered: 0 })], NOW);
    expect(n).toMatchObject({ rating: null, shareAnswered: null });
  });
  it('a note that is out of date, or missing, is left out and said to be', () => {
    const old = new Date(NOW.getTime() - (MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    const n = networkReviews([shop(), shop(), shop(), shop({ snapshotAt: old, rating: 1, count: 500 }), shop({ snapshotAt: null })], NOW);
    expect(n).toMatchObject({ rating: 4.5, ratedShops: 3, shopsWithoutFigures: 2 });
    expect(n.note).toMatch(/2 live shops have no recent figures and are left out/);
    expect(networkReviews([shop(), shop(), shop({ snapshotAt: old })], NOW).rating).toBeNull();
  });
  it('says so plainly when there is nothing yet', () => {
    expect(networkReviews([], NOW).note).toBe('No shop is live yet.');
    expect(networkReviews([shop({ snapshotAt: null })], NOW).note).toMatch(/No review figures have been read for the live shops yet/);
  });
});

describe('in the monthly summary and the console', () => {
  it('the summary carries it, from the shops it is given', () => {
    const s = buildNetworkSummary([], { ranked: [] }, [], 'November 2026', [shop(), shop(), shop()], NOW);
    expect(s.reviews).toMatchObject({ rating: 4.5, totalReviews: 300, shareAnswered: 80 });
    expect(buildNetworkSummary([], { ranked: [] }, [], 'November 2026').reviews).toMatchObject({ rating: null, shareAnswered: null });
  });
  it('carries no per-shop review figure, no review text and no forbidden field', () => {
    const s = buildNetworkSummary([], { ranked: [] }, [], 'November 2026', [shop(), shop(), shop()], NOW);
    expect(Object.keys(s.reviews).sort()).toEqual(['answeredShops', 'note', 'ratedShops', 'rating', 'shareAnswered', 'shopsWithoutFigures', 'totalReviews']);
    for (const f of FORBIDDEN_CONSOLE_FIELDS) expect(JSON.stringify(s.reviews)).not.toContain(`"${f}"`);
    // The per-shop rows the console sends carry no review totals at all.
    expect(src('./console-data.ts')).not.toMatch(/shop\.review|reviewRating|review_rating:/);
  });
  it('the console only counts a live shop, as decided in the one place', () => {
    expect(src('./console-data.ts')).toMatch(/reviewTotals\.push\(\{ live: full\.live,/);
  });
  it('the daily job takes the note, and a failure there cannot stop the figures', () => {
    const job = src('../app/api/cron/metrics-sync/route.ts');
    expect(job).toMatch(/snapshotFrom\(await getReviews\(/);
    expect(job.indexOf('syncDailyMetrics(')).toBeLessThan(job.indexOf('snapshotFrom('));
    expect(job).toMatch(/review totals not read/);
  });
  it('the page shows both figures and says what they are', () => {
    const page = src('../app/console/console-client.tsx');
    expect(page).toMatch(/network rating, from/);
    expect(page).toMatch(/of reviews have a reply from the shop/);
    expect(page).toMatch(/No review text and no single shop&apos;s figures are shown/);
  });
});
