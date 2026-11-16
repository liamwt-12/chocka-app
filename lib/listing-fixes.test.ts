import { describe, it, expect, vi, beforeEach } from 'vitest';

// A small in-memory Google. `refuse` makes the next write fail; `ignoreWrites`
// accepts a write and silently does not apply it (Google holding a change for review).
const { G, FakeGbpError } = vi.hoisted(() => {
  class FakeGbpError extends Error { status: number; googleStatus: string | null; constructor(m: string, s: number, g: string | null) { super(m); this.status = s; this.googleStatus = g; } }
  const G = { location: {} as any, reviews: [] as any[], refuse: null as null | { status: number; googleStatus?: string }, ignoreWrites: false, patches: [] as string[], categoriesKnown: {} as Record<string, string> };
  return { G, FakeGbpError };
});

vi.mock('./google', () => ({
  GbpError: FakeGbpError,
  getLocationFields: vi.fn(async (_t: string, _l: string, fields: string[]) => { const out: any = { name: 'locations/1' }; for (const f of fields) if (f in G.location) out[f] = JSON.parse(JSON.stringify(G.location[f])); return out; }),
  updateLocation: vi.fn(async (_t: string, _l: string, mask: string, data: any) => {
    if (G.refuse) throw new FakeGbpError(`Update failed (${mask}): refused`, G.refuse.status, G.refuse.googleStatus ?? null);
    G.patches.push(mask);
    if (!G.ignoreWrites) for (const f of mask.split(',')) { if (f in data) G.location[f] = JSON.parse(JSON.stringify(data[f])); else delete G.location[f]; }
    return { name: 'locations/1', ...data };
  }),
  replyToReview: vi.fn(async (_t: string, name: string, comment: string) => {
    if (G.refuse) throw new FakeGbpError('Failed to reply: refused', G.refuse.status, G.refuse.googleStatus ?? null);
    const r = G.reviews.find((x) => x.name === name); r.reviewReply = { comment }; return r.reviewReply;
  }),
  getReviews: vi.fn(async () => ({ reviews: G.reviews })),
  parseStarRating: (s: string) => ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as any)[s] ?? 0,
  findCategoryByName: vi.fn(async (_t: string, n: string) => (G.categoriesKnown[n.toLowerCase()] ? { name: G.categoriesKnown[n.toLowerCase()], displayName: n } : null)),
  getLocationFull: vi.fn(async () => G.location),
  getGoogleUpdated: vi.fn(async () => null), getAttributes: vi.fn(async () => ({ attributes: [] })), getMedia: vi.fn(async () => ({ mediaItems: [] })), getLocalPosts: vi.fn(async () => ({ localPosts: [] })),
  createLocalPost: vi.fn(), createLocationMedia: vi.fn(),
}));

import {
  applyDescription, applyServices, applyCategories, applyHours, applyReply, scheduleFirstPost, measureListing, applySpecialHours, applyWebsite, cleanWebsite, applyReplies, REPLIES_PER_REQUEST,
  plainProblem, descriptionProblem, reviewsNeedingReply, cleanNames, DESCRIPTION_MAX, type FixContext,
} from './listing-fixes';
import { DAYS } from './opening-hours';

function fakeDb() {
  const tables: Record<string, any[]> = { change_log: [], reviews: [], scheduled_posts: [] };
  const from = (t: string) => {
    const rows = (tables[t] ||= []);
    const filters: Array<(r: any) => boolean> = [];
    const q: any = {
      insert: (r: any) => { const row = { id: `${t}-${rows.length + 1}`, ...r }; rows.push(row); const res: any = Promise.resolve({ data: row, error: null }); res.select = () => ({ single: async () => ({ data: row, error: null }) }); return res; },
      upsert: async (r: any) => { rows.push(r); return { error: null }; },
      update: (patch: any) => ({ eq: async (_c: string, id: string) => { const row = rows.find((x) => x.id === id); if (row) Object.assign(row, patch); return { error: null }; } }),
      select: () => q, eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      limit: async () => ({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }),
    };
    return q;
  };
  return { tables, from };
}

let db: ReturnType<typeof fakeDb>;
let c: FixContext;
const longText = 'We are a family flooring shop in Testtown. We fit carpets, vinyl and laminate and bring samples to your home.';

beforeEach(() => {
  db = fakeDb();
  c = { db, accessToken: 't', userId: 'u1', profile: { id: 'p1', google_location_name: 'locations/1', google_account_id: 'accounts/9' } };
  G.location = { categories: { primaryCategory: { name: 'categories/gcid:flooring_store', displayName: 'Flooring shop' }, additionalCategories: [] }, profile: { description: '' }, serviceItems: [] };
  G.reviews = []; G.refuse = null; G.ignoreWrites = false; G.patches = []; G.categoriesKnown = { 'carpet store': 'categories/gcid:carpet_store' };
});

describe('a step is only "done" when Google holds what was sent', () => {
  it('description: written, read back, and recorded with its before-value', async () => {
    const r = await applyDescription(c, longText);
    expect(r.ok).toBe(true);
    expect(G.location.profile.description).toBe(longText);
    expect(db.tables.change_log[0]).toMatchObject({ action: 'update_location', target: 'profile', before_value: { profile: { description: '' } }, status: 'applied' });
  });

  it('description: accepted by Google but not showing is reported as NOT done', async () => {
    G.ignoreWrites = true;
    const r = await applyDescription(c, longText);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not showing/);
  });

  it('description: a refusal is reported in plain words, and nothing claims success', async () => {
    G.refuse = { status: 403, googleStatus: 'PERMISSION_DENIED' };
    const r = await applyDescription(c, longText);
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(r.message).toMatch(/would not let us/);
    expect(db.tables.change_log[0].status).toBe('failed');
  });

  it('description: over Google\'s limit is refused before anything is sent', async () => {
    const r = await applyDescription(c, 'x'.repeat(DESCRIPTION_MAX + 1));
    expect(r.ok).toBe(false);
    expect(G.patches).toEqual([]);
    expect(descriptionProblem('ring 01632 960001 for a quote, we fit carpets and vinyl')).toMatch(/phone/);
  });
});

describe('services and categories', () => {
  it('services are added to what is there, under Google\'s id for the main category', async () => {
    G.location.serviceItems = [{ freeFormServiceItem: { category: 'categories/gcid:flooring_store', label: { displayName: 'Carpet fitting' } } }];
    const r = await applyServices(c, ['Carpet fitting', 'Vinyl flooring', ' vinyl flooring ']);
    expect(r.ok).toBe(true);
    expect(G.location.serviceItems.map((s: any) => s.freeFormServiceItem.label.displayName)).toEqual(['Carpet fitting', 'Vinyl flooring']);
    expect(G.location.serviceItems[1].freeFormServiceItem.category).toBe('categories/gcid:flooring_store');
  });

  it('services already all present: nothing is written, and it is still reported done', async () => {
    G.location.serviceItems = [{ freeFormServiceItem: { category: 'x', label: { displayName: 'Carpet fitting' } } }];
    const r = await applyServices(c, ['carpet fitting']);
    expect(r.ok).toBe(true);
    expect(G.patches).toEqual([]);
  });

  it('a category Google does not have is left out and named; the main category never changes', async () => {
    const r = await applyCategories(c, ['Carpet store', 'Rug wizard']);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Rug wizard/);
    expect(G.location.categories.primaryCategory.name).toBe('categories/gcid:flooring_store');
    expect(G.location.categories.additionalCategories).toEqual([{ name: 'categories/gcid:carpet_store' }]);
  });

  it('categories are sent by Google\'s id, never by name', async () => {
    await applyCategories(c, ['Carpet store']);
    const sent = db.tables.change_log[0].after_value.categories;
    expect(JSON.stringify(sent)).not.toMatch(/displayName/);
  });

  it('cleanNames drops blanks, duplicates and over-long entries', () => {
    expect(cleanNames(['A', 'Ab', 'ab', 'x'.repeat(81), 3, 'Cd'], 5)).toEqual(['Ab', 'Cd']);
  });
});

describe('opening hours', () => {
  const week = DAYS.map((day, i) => (i < 5 ? { day, open: true, from: '09:00', to: '17:30' } : { day, open: false, from: '', to: '' }));
  it('writes exactly the confirmed week and checks it', async () => {
    const r = await applyHours(c, week);
    expect(r.ok).toBe(true);
    expect(G.location.regularHours.periods).toHaveLength(5);
    expect(G.location.regularHours.periods[0]).toEqual({ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17, minutes: 30 } });
    expect(r.message).toMatch(/Monday 9:00 to 17:30/);
  });
  it('writes nothing for an empty or invalid week: there is no default', async () => {
    for (const bad of [undefined, null, [], DAYS.map((day) => ({ day, open: false, from: '', to: '' }))]) {
      const r = await applyHours(c, bad);
      expect(r.ok).toBe(false);
    }
    expect(G.patches).toEqual([]);
    expect(G.location.regularHours).toBeUndefined();
  });
});

describe('holiday hours', () => {
  const today = '2026-12-01';
  const days = [{ date: '2026-12-25', open: false, from: '', to: '' }, { date: '2026-12-24', open: true, from: '09:00', to: '13:00' }];
  it('writes exactly the dates the shop listed, and checks them', async () => {
    const r = await applySpecialHours(c, days, today);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/closed on 1 day, different hours on 1 day/);
    expect(G.location.specialHours.specialHourPeriods).toEqual([
      { startDate: { year: 2026, month: 12, day: 24 }, endDate: { year: 2026, month: 12, day: 24 }, openTime: { hours: 9 }, closeTime: { hours: 13 } },
      { startDate: { year: 2026, month: 12, day: 25 }, endDate: { year: 2026, month: 12, day: 25 }, closed: true },
    ]);
    expect(db.tables.change_log[0]).toMatchObject({ target: 'specialHours', before_value: {} });
  });
  it('keeps a range of days the shop set in Google itself', async () => {
    const range = { startDate: { year: 2026, month: 12, day: 27 }, endDate: { year: 2026, month: 12, day: 31 }, closed: true };
    G.location.specialHours = { specialHourPeriods: [range, { startDate: { year: 2026, month: 12, day: 25 }, endDate: { year: 2026, month: 12, day: 25 }, closed: true }] };
    const r = await applySpecialHours(c, [{ date: '2026-12-24', open: false }], today);
    expect(r.ok).toBe(true);
    expect(G.location.specialHours.specialHourPeriods[0]).toEqual(range);
    expect(G.location.specialHours.specialHourPeriods).toHaveLength(2);
  });
  it('an empty list clears them, and says so', async () => {
    G.location.specialHours = { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 25 }, endDate: { year: 2026, month: 12, day: 25 }, closed: true }] };
    const r = await applySpecialHours(c, [], today);
    expect(r.ok).toBe(true);
    expect(G.location.specialHours).toBeUndefined();
    expect(r.message).toMatch(/cleared/);
  });
  it('a bad date writes nothing', async () => {
    expect((await applySpecialHours(c, [{ date: '2026-11-01', open: false }], today)).ok).toBe(false);
    expect(G.patches).toEqual([]);
  });
});

describe('website', () => {
  it('only ever an address the shop typed, tidied', () => {
    expect(cleanWebsite('www.bare-carpets.co.uk')).toBe('https://www.bare-carpets.co.uk');
    expect(cleanWebsite(' http://shop.example/floors ')).toBe('http://shop.example/floors');
    for (const bad of ['', 'not a site', 'ftp://x.example', 'javascript:alert(1)', 'localhost', 'x'.repeat(250), null, 42]) expect(cleanWebsite(bad)).toBeNull();
  });
  it('writes it, checks it, and logs what it replaced', async () => {
    G.location.websiteUri = 'https://old.example';
    const r = await applyWebsite(c, 'www.bare-carpets.co.uk');
    expect(r.ok).toBe(true);
    expect(G.location.websiteUri).toBe('https://www.bare-carpets.co.uk');
    expect(db.tables.change_log[0]).toMatchObject({ target: 'websiteUri', before_value: { websiteUri: 'https://old.example' } });
  });
  it('refuses nonsense without touching Google', async () => {
    expect((await applyWebsite(c, 'my shop')).ok).toBe(false);
    expect(G.patches).toEqual([]);
  });
});

describe('one reply at a time', () => {
  const rev = (id: string, stars: string, reply?: string) => ({ name: `accounts/9/locations/1/reviews/${id}`, reviewId: id, starRating: stars, reviewer: { displayName: 'Dana Test' }, comment: 'Lovely', createTime: '2026-11-01T00:00:00Z', ...(reply ? { reviewReply: { comment: reply } } : {}) });
  const text = 'Thanks so much, Dana. We are glad you were pleased with the job.';

  it('posts the exact text, records the review, and logs it', async () => {
    G.reviews = [rev('r1', 'FIVE')];
    const r = await applyReply(c, 'r1', text);
    expect(r.ok).toBe(true);
    expect(G.reviews[0].reviewReply.comment).toBe(text);
    expect(db.tables.reviews[0]).toMatchObject({ google_review_id: 'r1', rating: 5, reply_content: text });
    expect(db.tables.change_log[0]).toMatchObject({ action: 'reply_review', before_value: { known: true, comment: null } });
  });

  it('is safe to send twice: the second time changes nothing and says done', async () => {
    G.reviews = [rev('r1', 'FIVE')];
    await applyReply(c, 'r1', text);
    const again = await applyReply(c, 'r1', text);
    expect(again.ok).toBe(true);
    expect(db.tables.change_log).toHaveLength(1);
  });

  it('never replies over a reply the shop wrote itself', async () => {
    G.reviews = [rev('r1', 'FIVE', 'Cheers Dana, from the shop')];
    const r = await applyReply(c, 'r1', text);
    expect(r.ok).toBe(false);
    expect(G.reviews[0].reviewReply.comment).toBe('Cheers Dana, from the shop');
  });

  it.each(['ONE', 'TWO', 'THREE'])('never posts to a %s star review, whatever is sent', async (stars) => {
    G.reviews = [rev('r1', stars)];
    const r = await applyReply(c, 'r1', text);
    expect(r.ok).toBe(false);
    expect(G.reviews[0].reviewReply).toBeUndefined();
  });

  it('refuses wording that breaks the reply rules', async () => {
    G.reviews = [rev('r1', 'FIVE')];
    const r = await applyReply(c, 'r1', 'Thanks Dana, we will give you a full refund and a discount next time.');
    expect(r.ok).toBe(false);
    expect(G.reviews[0].reviewReply).toBeUndefined();
  });

  it('a busy Google is reported as worth trying again', async () => {
    G.reviews = [rev('r1', 'FIVE')];
    G.refuse = { status: 429, googleStatus: 'RESOURCE_EXHAUSTED' };
    const r = await applyReply(c, 'r1', text);
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it('a batch reads the reviews once, posts each reply on its own, and reports each on its own', async () => {
    const google = await import('./google');
    (google.getReviews as any).mockClear();
    G.reviews = [rev('g1', 'FIVE'), rev('g2', 'FOUR'), rev('low', 'TWO'), rev('mine', 'FIVE', 'the shop already answered')];
    const out = await applyReplies(c, [{ reviewId: 'g1', text }, { reviewId: 'g2', text }, { reviewId: 'low', text }, { reviewId: 'mine', text }, { reviewId: 'gone', text }]);
    expect(out.map((r) => [r.reviewId, r.ok])).toEqual([['g1', true], ['g2', true], ['low', false], ['mine', false], ['gone', false]]);
    expect((google.getReviews as any).mock.calls).toHaveLength(1);
    expect(G.reviews.find((r) => r.reviewId === 'low').reviewReply).toBeUndefined();
    expect(G.reviews.find((r) => r.reviewId === 'mine').reviewReply.comment).toBe('the shop already answered');
    expect(db.tables.change_log).toHaveLength(2);
  });

  it('a batch is capped, is safe to send twice, and one refusal does not stop the rest', async () => {
    G.reviews = Array.from({ length: 8 }, (_, i) => rev(`r${i}`, 'FIVE'));
    const all = G.reviews.map((r) => ({ reviewId: r.reviewId, text }));
    const first = await applyReplies(c, all);
    expect(first).toHaveLength(REPLIES_PER_REQUEST);
    const again = await applyReplies(c, all);
    expect(again.every((r) => r.ok)).toBe(true);
    expect(db.tables.change_log).toHaveLength(REPLIES_PER_REQUEST); // nothing posted twice
    expect(await applyReplies(c, 'nonsense')).toEqual([]);
  });

  it('reviewsNeedingReply: good, unanswered, capped, and says how many there were', () => {
    const many = Array.from({ length: 30 }, (_, i) => rev(`g${i}`, 'FIVE'));
    const out = reviewsNeedingReply([...many, rev('low', 'TWO'), rev('done', 'FIVE', 'ta')], (s) => ({ TWO: 2, FIVE: 5 } as any)[s], 20);
    expect(out.list).toHaveLength(20);
    expect(out.total).toBe(30);
  });
});

describe('first post and measuring', () => {
  const post = 'Cold mornings show up a tired hallway floor. Pop in and see what is new in the showroom.';
  it('books the post the shop read, once, however many times it is sent', async () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect((await scheduleFirstPost(c, post, now)).ok).toBe(true);
    expect((await scheduleFirstPost(c, post, now)).ok).toBe(true);
    expect(db.tables.scheduled_posts).toHaveLength(1);
    expect(db.tables.scheduled_posts[0]).toMatchObject({ status: 'pending_approval', content: post });
    expect(db.tables.scheduled_posts[0].approved_at).toBeTruthy();
  });
  it('refuses a post with a price in it', async () => {
    expect((await scheduleFirstPost(c, 'Carpets fitted from £9 a metre this week only, pop in and see us soon.')).ok).toBe(false);
    expect(db.tables.scheduled_posts).toHaveLength(0);
  });
  it('measureListing scores what Google holds now', async () => {
    const before = (await measureListing(c)).audit.score;
    await applyDescription(c, 'd'.repeat(300));
    expect((await measureListing(c)).audit.score).toBe(before + 15);
  });
});

describe('plainProblem', () => {
  it.each([
    [{ status: 429, message: 'x' }, /too busy/, true],
    [{ status: 503, message: 'x' }, /did not answer/, true],
    [{ message: 'fetch failed' }, /did not answer/, true],
    [{ status: 403, googleStatus: 'PERMISSION_DENIED', message: 'x' }, /would not let us/, false],
    [{ status: 404, message: 'x' }, /could not find/, false],
    [{ message: 'Token refresh failed: {"error":"invalid_grant"}' }, /lost the connection/, false],
    [{ message: 'change_log: could not record before-value, write not made' }, /did not make it/, true],
    [{ status: 400, message: 'INVALID_ARGUMENT' }, /did not accept/, false],
  ])('%j', (err, re, retry) => {
    const p = plainProblem(err);
    expect(p.message).toMatch(re);
    expect(p.retryable).toBe(retry);
    expect(p.nextStep.length).toBeGreaterThan(10);
  });
});

describe('the apply route does one thing per request', () => {
  it('has no all-in-one path and no loop over reviews', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../app/api/profile-fix/route.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/for\s*\(const rev of/);
    expect(src).not.toMatch(/generateReviewReply/);
    expect(src).toMatch(/isDeadGrant/);
  });
  it('the screen reads the answer to every step', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/ImproveListing.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/d\?\.result/);
    expect(src).toMatch(/Measured from Google/);
  });
});
