import { describe, it, expect, beforeEach } from 'vitest';
import { verifyAdminAuth, validateNewRetailer, pilotStatus, mintInvites, MAX_INVITE_BATCH, type PilotInvite } from './pilot';
import { hashInviteToken } from './invite-token';

const NOW = new Date('2026-11-14T12:00:00Z');
beforeEach(() => { process.env.CANCEL_HASH_SECRET = 'test-secret'; });

describe('verifyAdminAuth', () => {
  it('accepts the right password and refuses anything else', () => {
    expect(verifyAdminAuth('Bearer pw', 'pw')).toBe(true);
    expect(verifyAdminAuth('Bearer nope', 'pw')).toBe(false);
    expect(verifyAdminAuth(null, 'pw')).toBe(false);
    expect(verifyAdminAuth('Bearer ', undefined)).toBe(false);
  });
});

describe('validateNewRetailer', () => {
  it('trims and normalises', () => {
    expect(validateNewRetailer({ name: '  Testwell  ', town: ' Leeds ', contactEmail: ' Dave@Example.CO.UK ' }))
      .toEqual({ ok: true, value: { name: 'Testwell', town: 'Leeds', contact_email: 'dave@example.co.uk' } });
  });
  it('allows a missing email and town', () => {
    expect(validateNewRetailer({ name: 'Testwell' })).toEqual({ ok: true, value: { name: 'Testwell', town: null, contact_email: null } });
  });
  it('rejects a missing name or a bad email', () => {
    expect(validateNewRetailer({ name: ' ' }).ok).toBe(false);
    expect(validateNewRetailer({ name: 'Testwell', contactEmail: 'not-an-email' }).ok).toBe(false);
  });
});

describe('pilotStatus', () => {
  const live = { id: 'u1', google_refresh_token: 'v1.x', token_status: 'valid', auto_reply_enabled: true, profiles: [{ google_location_name: 'locations/1' }] };
  const inv = (o: Partial<PilotInvite>): PilotInvite => ({ id: 'i', status: 'pending', expires_at: '2026-12-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z', accepted_at: null, ...o });

  it('live: linked, working access, listing bound, something switched on', () => {
    expect(pilotStatus({ user_id: 'u1' }, live, [], NOW).state).toBe('live');
  });
  it('connected with nothing switched on is still live: what is switched on does not decide it', () => {
    expect(pilotStatus({ user_id: 'u1' }, { ...live, auto_reply_enabled: false }, [], NOW).state).toBe('live');
  });
  it('live through manager access', () => {
    const managed = { id: 'u2', google_refresh_token: null, auto_post_enabled: true, managed_by_user_id: 'op', manager: { id: 'op', google_refresh_token: 'v1.y', token_status: 'valid' }, profiles: [{ google_location_name: 'locations/2' }] };
    expect(pilotStatus({ user_id: 'u2' }, managed, [], NOW)).toEqual({ state: 'live', detail: 'live (manager access)' });
  });
  it('not live when access has failed, or no listing is chosen', () => {
    expect(pilotStatus({ user_id: 'u1' }, { ...live, token_status: 'invalid' }, [], NOW).state).toBe('connected_not_live');
    expect(pilotStatus({ user_id: 'u1' }, { ...live, profiles: [] }, [], NOW).state).toBe('connected_not_live');
    expect(pilotStatus({ user_id: 'u1' }, null, [], NOW).state).toBe('connected_not_live');
  });
  it('invited, expired, or not invited', () => {
    expect(pilotStatus({ user_id: null }, null, [inv({})], NOW).state).toBe('invited');
    expect(pilotStatus({ user_id: null }, null, [inv({ expires_at: '2026-11-01T00:00:00Z' })], NOW).state).toBe('invite_expired');
    expect(pilotStatus({ user_id: null }, null, [inv({ status: 'revoked' })], NOW).state).toBe('not_invited');
    expect(pilotStatus({ user_id: null }, null, [], NOW).state).toBe('not_invited');
  });
});

/** Tiny in-memory fake of the two tables mintInvites touches. */
function fakeDb(retailers: any[], invites: any[] = []) {
  const tables: Record<string, any[]> = { retailers, retailer_invites: invites };
  const query = (rows: any[]) => {
    const filters: Array<(r: any) => boolean> = [];
    const q: any = {
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      single: async () => { const m = rows.filter((r) => filters.every((f) => f(r))); return m.length ? { data: m[0], error: null } : { data: null, error: { message: 'none' } }; },
      then: (res: any) => res({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }),
    };
    return q;
  };
  return {
    tables,
    from: (t: string) => ({
      select: () => query(tables[t]),
      insert: async (row: any) => { tables[t].push({ id: `new-${tables[t].length}`, ...row }); return { error: null }; },
      update: (patch: any) => {
        const filters: Array<(r: any) => boolean> = [];
        const q: any = { eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
          then: (res: any) => { tables[t].filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch)); res({ error: null }); } };
        return q;
      },
    }),
  };
}

describe('mintInvites (generate only)', () => {
  const shop = (id: string, extra: any = {}) => ({ id, tenant_id: 't', name: `Shop ${id}`, contact_email: `${id}@shop.example`, user_id: null, ...extra });

  it('returns one link per retailer and stores only the hash, with sent_at unset', async () => {
    const db = fakeDb([shop('a'), shop('b')]);
    const res = await mintInvites(db, ['a', 'b'], 'https://app.stellarlocal.co.uk', NOW);
    expect(res.every((r) => r.ok)).toBe(true);
    const token = res[0].link!.split('/invite/')[1];
    const stored = db.tables.retailer_invites[0];
    expect(stored.token_hash).toBe(hashInviteToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.sent_at).toBeUndefined();
    expect(stored.status).toBe('pending');
  });

  it('skips connected retailers and ones with a valid link', async () => {
    const db = fakeDb([shop('a', { user_id: 'u' }), shop('b')], [{ id: 'i1', retailer_id: 'b', status: 'pending', expires_at: '2026-12-01T00:00:00Z' }]);
    const res = await mintInvites(db, ['a', 'b', 'missing'], 'https://x', NOW);
    expect(res.map((r) => r.ok)).toEqual([false, false, false]);
    expect(res[0].error).toMatch(/already connected/);
    expect(res[1].error).toMatch(/valid link/);
    expect(res[2].error).toMatch(/not found/);
  });

  it('revokes an expired link and issues a fresh one', async () => {
    const db = fakeDb([shop('a')], [{ id: 'old', retailer_id: 'a', status: 'pending', expires_at: '2026-10-01T00:00:00Z' }]);
    const res = await mintInvites(db, ['a'], 'https://x', NOW);
    expect(res[0].ok).toBe(true);
    expect(db.tables.retailer_invites.find((i) => i.id === 'old').status).toBe('revoked');
  });

  it('refuses an oversized batch', async () => {
    const ids = Array.from({ length: MAX_INVITE_BATCH + 1 }, (_, i) => `r${i}`);
    await expect(mintInvites(fakeDb([]), ids, 'https://x', NOW)).rejects.toThrow(/At most/);
  });

  it('dedupes ids', async () => {
    const db = fakeDb([shop('a')]);
    const res = await mintInvites(db, ['a', 'a'], 'https://x', NOW);
    expect(res).toHaveLength(1);
  });
});
