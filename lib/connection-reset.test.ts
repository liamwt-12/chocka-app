import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./secrets', () => ({ decryptSecret: (v: string) => `plain:${v}`, userTokenAad: (id: string) => `aad:${id}` }));

import { releaseStaleClaim, resetConnection } from './connection-reset';

/** A tiny in-memory stand-in for the four tables this module touches. */
function fakeDb(seed: { retailers: any[]; users: any[]; profiles: any[]; retailer_invites: any[] }) {
  const t: Record<string, any[]> = JSON.parse(JSON.stringify(seed));
  const from = (name: string) => {
    let filters: Array<(r: any) => boolean> = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: any = null;
    let order: { col: string; asc: boolean } | null = null;
    const run = () => {
      let rows = t[name].filter((r) => filters.every((f) => f(r)));
      if (op === 'update') rows.forEach((r) => Object.assign(r, patch));
      if (op === 'delete') { t[name] = t[name].filter((r) => !rows.includes(r)); if (name === 'users') { t.profiles = t.profiles.filter((p) => !rows.some((u) => u.id === p.user_id)); t.retailers.forEach((r) => { if (rows.some((u) => u.id === r.user_id)) r.user_id = null; }); } }
      if (order) rows = [...rows].sort((a, b) => (order!.asc ? 1 : -1) * String(a[order!.col]).localeCompare(String(b[order!.col])));
      return rows;
    };
    const q: any = {
      select: () => q, update: (p: any) => { op = 'update'; patch = p; return q; }, delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      order: (col: string, o: any) => { order = { col, asc: o?.ascending !== false }; return q; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: any) => res({ data: run(), error: null }),
    };
    return q;
  };
  return { t, from };
}

const NOW = new Date('2026-11-20T10:00:00Z');
const base = () => ({
  retailers: [{ id: 'shop', user_id: 'wrong', connection_status: 'no_access' }],
  users: [{ id: 'wrong', google_refresh_token: 'sealed' }],
  profiles: [] as any[],
  retailer_invites: [{ id: 'inv', retailer_id: 'shop', status: 'accepted', user_id: 'wrong' as string | null, expires_at: '2026-12-10T00:00:00Z', created_at: '2026-11-10T00:00:00Z' }],
});

let fetched: any[];
const fakeFetch = (async (url: string, init: any) => { fetched.push([url, String(init.body)]); return new Response('{}'); }) as any;
beforeEach(() => { fetched = []; });

describe('releaseStaleClaim: the wrong Google account does not lock a shop out', () => {
  it('removes an account that never bound a listing, re-opens the link, and hands the permission back', async () => {
    const db = fakeDb(base());
    expect(await releaseStaleClaim(db, 'shop', NOW, fakeFetch)).toBe(true);
    expect(db.t.users).toHaveLength(0);
    expect(db.t.retailers[0]).toMatchObject({ user_id: null, connection_status: 'invited' });
    expect(db.t.retailer_invites[0]).toMatchObject({ status: 'pending', user_id: null });
    expect(fetched[0][0]).toBe('https://oauth2.googleapis.com/revoke');
    expect(fetched[0][1]).toContain('plain%3Asealed');
  });

  it('NEVER removes an account that has a listing bound', async () => {
    const seed = base(); seed.profiles = [{ id: 'p', user_id: 'wrong', google_location_name: 'locations/1' }];
    const db = fakeDb(seed);
    expect(await releaseStaleClaim(db, 'shop', NOW, fakeFetch)).toBe(false);
    expect(db.t.users).toHaveLength(1);
    expect(db.t.retailers[0].user_id).toBe('wrong');
    expect(fetched).toHaveLength(0);
  });

  it('a profile row with no listing chosen (left at the picker) still counts as stale', async () => {
    const seed = base(); seed.profiles = [{ id: 'p', user_id: 'wrong', google_location_name: null }];
    const db = fakeDb(seed);
    expect(await releaseStaleClaim(db, 'shop', NOW, fakeFetch)).toBe(true);
    expect(db.t.users).toHaveLength(0);
  });

  it('a shop that is already free stays free, and a link left marked "used" is re-opened', async () => {
    const seed = base(); seed.retailers[0].user_id = null as any; seed.users = [];
    const db = fakeDb(seed);
    expect(await releaseStaleClaim(db, 'shop', NOW, fakeFetch)).toBe(true);
    expect(db.t.retailer_invites[0].status).toBe('pending');
  });

  it('is safe to run twice', async () => {
    const db = fakeDb(base());
    await releaseStaleClaim(db, 'shop', NOW, fakeFetch);
    expect(await releaseStaleClaim(db, 'shop', NOW, fakeFetch)).toBe(true);
    expect(db.t.retailer_invites.filter((i) => i.status === 'pending')).toHaveLength(1);
  });

  it('still frees the shop if Google cannot be reached to hand the permission back', async () => {
    const db = fakeDb(base());
    expect(await releaseStaleClaim(db, 'shop', NOW, (async () => { throw new Error('offline'); }) as any)).toBe(true);
    expect(db.t.retailers[0].user_id).toBeNull();
  });
});

describe('resetConnection: support starts a shop again', () => {
  it('removes a working connection when asked, and says the link can be reused', async () => {
    const seed = base(); seed.profiles = [{ id: 'p', user_id: 'wrong', google_location_name: 'locations/1' }];
    const db = fakeDb(seed);
    const r = await resetConnection(db, 'shop', NOW, fakeFetch);
    expect(r).toMatchObject({ ok: true, removedAccount: true, linkReusable: true });
    expect(db.t.users).toHaveLength(0);
    expect(db.t.profiles).toHaveLength(0);
    expect(db.t.retailers[0].connection_detail).toMatch(/reset by support/);
  });

  it('extends a link that had run out, so the shop\'s own link works again', async () => {
    const seed = base(); seed.retailer_invites[0].expires_at = '2026-11-01T00:00:00Z';
    const db = fakeDb(seed);
    await resetConnection(db, 'shop', NOW, fakeFetch);
    expect(Date.parse(db.t.retailer_invites[0].expires_at)).toBeGreaterThan(NOW.getTime());
  });

  it('says so when there is no link to reuse', async () => {
    const seed = base(); seed.retailer_invites = [{ id: 'inv', retailer_id: 'shop', status: 'revoked', user_id: null, expires_at: '2026-12-10T00:00:00Z', created_at: '2026-11-10T00:00:00Z' }];
    const r = await resetConnection(fakeDb(seed), 'shop', NOW, fakeFetch);
    expect(r).toMatchObject({ ok: true, linkReusable: false });
  });

  it('a shop with nothing connected is not an error', async () => {
    const seed = base(); seed.retailers[0].user_id = null as any; seed.users = [];
    expect(await resetConnection(fakeDb(seed), 'shop', NOW, fakeFetch)).toMatchObject({ ok: true, removedAccount: false });
  });

  it('an unknown shop is refused', async () => {
    expect((await resetConnection(fakeDb(base()), 'nope', NOW, fakeFetch)).ok).toBe(false);
  });
});
