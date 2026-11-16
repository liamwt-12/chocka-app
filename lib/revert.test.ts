import { describe, it, expect, vi, beforeEach } from 'vitest';

const { G } = vi.hoisted(() => ({ G: { location: {} as any, deleted: [] as string[], replies: {} as Record<string, string>, dead: false } }));
vi.mock('./secrets', () => ({ decryptSecret: (v: string) => v, userTokenAad: (id: string) => id }));
vi.mock('./google', () => ({
  refreshAccessToken: vi.fn(async () => { if (G.dead) throw new Error('Token refresh failed: {"error":"invalid_grant"}'); return 'tok'; }),
  isDeadGrant: (e: any) => /invalid_grant/.test(String(e?.message)),
  getLocationFields: vi.fn(async (_t: string, _l: string, fields: string[]) => { const o: any = { name: 'locations/1' }; for (const f of fields) if (f in G.location) o[f] = JSON.parse(JSON.stringify(G.location[f])); return o; }),
  updateLocation: vi.fn(async (_t: string, _l: string, mask: string, data: any) => { for (const f of mask.split(',')) { if (f in data) G.location[f] = data[f]; else delete G.location[f]; } return { ...data }; }),
  replyToReview: vi.fn(async (_t: string, name: string, c: string) => { G.replies[name] = c; return {}; }),
  deleteLocalPost: vi.fn(async (_t: string, n: string) => { G.deleted.push(n); }),
  deleteReviewReply: vi.fn(async (_t: string, n: string) => { G.deleted.push(n); delete G.replies[n]; }),
  deleteLocationMedia: vi.fn(async (_t: string, n: string) => { G.deleted.push(n); }),
  createLocalPost: vi.fn(), createLocationMedia: vi.fn(),
}));

import { undoChange, describeChange, summarise, same } from './revert';

function fakeDb(rows: any[]) {
  const t: Record<string, any[]> = { change_log: rows, profiles: [{ id: 'p1', user_id: 'u1' }], users: [{ id: 'u1', google_refresh_token: 'v1.x', token_status: 'valid' }], reviews: [] };
  const from = (name: string) => {
    let filters: Array<(r: any) => boolean> = []; let op = 'select'; let patch: any; let ins: any;
    const run = () => { const m = t[name].filter((r) => filters.every((f) => f(r))); if (op === 'update') m.forEach((r) => Object.assign(r, patch)); return m; };
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      update: (p: any) => { op = 'update'; patch = p; return q; },
      insert: (r: any) => { ins = { id: `log-${t[name].length + 1}`, created_at: new Date().toISOString(), reverted_at: null, ...r }; t[name].push(ins); return { select: () => ({ single: async () => ({ data: ins, error: null }) }) }; },
      maybeSingle: async () => { const m = run(); return { data: name === 'change_log' && op === 'select' && filters.length === 2 ? m[m.length - 1] ?? null : m[0] ?? null, error: null }; },
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: any) => res({ data: run(), error: null }),
    };
    return q;
  };
  return { t, from };
}
const change = (o: any) => ({ id: 'c1', profile_id: 'p1', user_id: 'u1', location_name: 'locations/1', source: 'onboarding', status: 'applied', reverted_at: null, created_at: '2026-11-16T10:00:00Z', target: null, before_value: null, after_value: null, ...o });
const HOURS = { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }] };

beforeEach(() => { G.location = {}; G.deleted = []; G.replies = {}; G.dead = false; });

describe('undoing a field', () => {
  it('writes the old value back, checks it, logs the undo and marks the original', async () => {
    G.location = { profile: { description: 'new words' } };
    const db = fakeDb([change({ action: 'update_location', target: 'profile', before_value: { profile: { description: 'old words' } }, after_value: { profile: { description: 'new words' } } })]);
    const r = await undoChange(db, 'c1', { confirm: true });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Description put back to: "old words"\. Checked on Google\./);
    expect(G.location.profile.description).toBe('old words');
    const log = db.t.change_log;
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ source: 'revert', action: 'update_location', status: 'applied' });
    expect(log[0].reverted_at).toBeTruthy();
    expect(log[0].reverted_by_change_id).toBe(log[1].id);
  });

  it('a field that was empty before is cleared again', async () => {
    G.location = { regularHours: HOURS };
    const db = fakeDb([change({ action: 'update_location', target: 'regularHours', before_value: {}, after_value: { regularHours: HOURS } })]);
    const r = await undoChange(db, 'c1', { confirm: true });
    expect(r.ok).toBe(true);
    expect(G.location.regularHours).toBeUndefined();
    expect(r.message).toMatch(/Opening hours put back to: nothing/);
  });

  it('refuses if the field has been changed again since, unless told to go ahead', async () => {
    G.location = { profile: { description: 'the shop rewrote this in Google' } };
    const db = fakeDb([change({ action: 'update_location', target: 'profile', before_value: { profile: { description: 'old words' } }, after_value: { profile: { description: 'new words' } } })]);
    const r = await undoChange(db, 'c1', { confirm: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/changed again since/);
    expect(G.location.profile.description).toBe('the shop rewrote this in Google');
    expect((await undoChange(db, 'c1', { confirm: true, allowLaterEdits: true })).ok).toBe(true);
    expect(G.location.profile.description).toBe('old words');
  });

  it('without confirm it only says what it would do', async () => {
    G.location = { profile: { description: 'new words' } };
    const db = fakeDb([change({ action: 'update_location', target: 'profile', before_value: { profile: { description: 'old words' } }, after_value: { profile: { description: 'new words' } } })]);
    const r = await undoChange(db, 'c1');
    expect(r).toMatchObject({ ok: true });
    expect(r.message).toMatch(/^Would put description back/);
    expect(G.location.profile.description).toBe('new words');
    expect(db.t.change_log).toHaveLength(1);
  });
});

describe('comparing what Google holds with what was logged', () => {
  it('key order does not matter: the database and Google order keys differently', () => {
    expect(same({ specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 25 }, closed: true }] } }, { specialHours: { specialHourPeriods: [{ closed: true, startDate: { day: 25, month: 12, year: 2026 } }] } })).toBe(true);
    expect(same({ a: [1, 2] }, { a: [2, 1] })).toBe(false); // the order of a list does matter
    expect(same({}, undefined)).toBe(false);
    expect(same(null, undefined)).toBe(true);
  });
  it('an undo is not refused as "changed since" because of key order alone', async () => {
    G.location = { regularHours: { periods: [{ closeTime: { hours: 17 }, closeDay: 'MONDAY', openTime: { hours: 9 }, openDay: 'MONDAY' }] } };
    const db = fakeDb([change({ action: 'update_location', target: 'regularHours', before_value: {}, after_value: { regularHours: HOURS } })]);
    expect((await undoChange(db, 'c1', { confirm: true })).ok).toBe(true);
  });
});

describe('undoing a reply or a post', () => {
  it('our reply is deleted when there was none before, and our own record of it is cleared', async () => {
    const name = 'accounts/9/locations/1/reviews/r1';
    G.replies[name] = 'Thanks Dana';
    const db = fakeDb([change({ action: 'reply_review', target: name, before_value: { known: true, comment: null }, after_value: { comment: 'Thanks Dana' } })]);
    db.t.reviews.push({ profile_id: 'p1', google_review_id: 'r1', reply_content: 'Thanks Dana' });
    expect((await undoChange(db, 'c1', { confirm: true })).ok).toBe(true);
    expect(G.deleted).toEqual([name]);
    expect(db.t.reviews[0].reply_content).toBeNull();
  });
  it('an earlier reply is restored', async () => {
    const name = 'accounts/9/locations/1/reviews/r1';
    const db = fakeDb([change({ action: 'reply_review', target: name, before_value: { known: true, comment: 'the shop wrote this' }, after_value: { comment: 'ours' } })]);
    expect((await undoChange(db, 'c1', { confirm: true })).ok).toBe(true);
    expect(G.replies[name]).toBe('the shop wrote this');
  });
  it('a published post is deleted', async () => {
    const db = fakeDb([change({ action: 'create_post', after_value: { name: 'accounts/9/locations/1/localPosts/7', summary: 'hello' } })]);
    expect((await undoChange(db, 'c1', { confirm: true })).ok).toBe(true);
    expect(G.deleted).toEqual(['accounts/9/locations/1/localPosts/7']);
  });
});

describe('it refuses, in plain words, when there is nothing safe to do', () => {
  it.each([
    [{ reverted_at: '2026-11-17T00:00:00Z', action: 'update_location', target: 'profile' }, /Already undone/],
    [{ status: 'failed', action: 'update_location', target: 'profile' }, /never went through/],
    [{ action: 'reply_review', target: 'x/reviews/1', before_value: { known: false, comment: null } }, /checked by hand/],
    [{ source: 'revert', action: 'update_location', target: 'profile' }, /itself an undo/],
    [{ profile_id: null, action: 'update_location', target: 'profile', before_value: {} }, /since been removed/],
  ])('%j', async (o, re) => {
    const r = await undoChange(fakeDb([change(o)]), 'c1', { confirm: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(re);
  });
  it('lost Google access', async () => {
    G.dead = true;
    const r = await undoChange(fakeDb([change({ action: 'update_location', target: 'profile', before_value: {} })]), 'c1', { confirm: true });
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/lost the connection/);
  });
  it('an unknown change', async () => {
    expect((await undoChange(fakeDb([]), 'nope', { confirm: true })).ok).toBe(false);
  });
});

describe('what support sees', () => {
  it('hours and services are described in words that can be checked against the listing', () => {
    expect(summarise('regularHours', { regularHours: HOURS })).toBe('Monday 9:00 to 17:00');
    expect(summarise('regularHours', {})).toBe('nothing');
    expect(summarise('serviceItems', { serviceItems: [{ freeFormServiceItem: { label: { displayName: 'Carpet fitting' } } }] })).toBe('1 services: Carpet fitting');
    const v = describeChange(change({ action: 'update_location', target: 'regularHours', before_value: {}, after_value: { regularHours: HOURS } }) as any);
    expect(v).toMatchObject({ what: 'Opening hours', before: 'nothing', after: 'Monday 9:00 to 17:00', canUndo: true, undone: false });
  });
  it('the button and the script share one implementation', async () => {
    const { readFileSync } = await import('node:fs');
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('../scripts/revert-listing-change.ts')).toMatch(/undoChange\(/);
    expect(src('../app/api/admin/pilot/route.ts')).toMatch(/undoChange\(supabaseAdmin, row\.id/);
    expect(src('../app/api/admin/pilot/route.ts')).toMatch(/row\.profile_id !== owned\.profileId/);
  });
});
