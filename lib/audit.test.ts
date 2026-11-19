import { describe, it, expect } from 'vitest';
import { scoreProfile, manualGaps } from './audit';

const empty = { location: { phoneNumbers: { primaryPhone: '01632 960001' } }, attributes: { attributes: [] }, media: { mediaItems: [] }, posts: { localPosts: [] }, googleUpdated: null };
const rev = (stars: string, replied = false) => ({ starRating: stars, ...(replied ? { reviewReply: { comment: 'ta' } } : {}) });

describe('the score only offers fixes the app really makes', () => {
  it('never offers to set attributes, which nothing writes', () => {
    const a = scoreProfile({ ...empty, reviews: { reviews: [] } });
    expect(a.fixes.map((f) => f.key)).not.toContain('attributes');
    expect(a.fixes.map((f) => f.key).sort()).toEqual(['categories', 'description', 'firstPost', 'hours', 'services']);
  });

  it('hours are described as the shop\'s own, never a default', () => {
    const hours = scoreProfile({ ...empty, reviews: { reviews: [] } }).fixes.find((f) => f.key === 'hours')!;
    expect(`${hours.label} ${hours.description}`).not.toMatch(/default/i);
    expect(hours.description).toMatch(/You tell us/);
  });

  it('only good reviews are counted as replies we could post', () => {
    const a = scoreProfile({ ...empty, reviews: { reviews: [rev('FIVE'), rev('FOUR'), rev('TWO'), rev('ONE')] } });
    const fix = a.fixes.find((f) => f.key === 'reviews')!;
    expect(fix.label).toBe('Reply to 2 unanswered reviews');
    // Two low reviews stay unanswered, so the full eight points are not promised.
    expect(fix.pointsGain).toBe(4);
  });

  it('no reply fix at all when only lower-rated reviews are unanswered', () => {
    const a = scoreProfile({ ...empty, reviews: { reviews: [rev('TWO'), rev('FIVE', true)] } });
    expect(a.fixes.some((f) => f.key === 'reviews')).toBe(false);
  });

  it('a booked first post promises no points until it is published', () => {
    expect(scoreProfile({ ...empty, reviews: { reviews: [] } }).fixes.find((f) => f.key === 'firstPost')!.pointsGain).toBe(0);
  });
});

describe('what we do not do is said plainly', () => {
  it('lists every scored gap we leave to the shop, with how to do it', () => {
    const gaps = manualGaps(scoreProfile({ ...empty, reviews: { reviews: [] } }));
    expect(gaps.map((g) => g.key).sort()).toEqual(['attributes', 'photos', 'recentPhotos', 'serviceArea', 'specialHours', 'website']);
    for (const g of gaps) { expect(g.why.length).toBeGreaterThan(10); expect(g.how.length).toBeGreaterThan(20); }
  });

  it('lists nothing that is already in place', () => {
    const full = scoreProfile({
      location: { phoneNumbers: { primaryPhone: '1' }, websiteUri: 'https://x.invalid', serviceArea: {}, specialHours: { specialHourPeriods: [{}] } },
      attributes: { attributes: [1, 2, 3, 4] }, media: { mediaItems: Array.from({ length: 6 }, () => ({ createTime: new Date().toISOString() })) },
      reviews: { reviews: [] }, posts: { localPosts: [] }, googleUpdated: null,
    });
    expect(manualGaps(full)).toEqual([]);
  });
});
