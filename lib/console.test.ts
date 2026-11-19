import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── fakes ────────────────────────────────────────────────────────────────────
const sent: any[] = [];
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async (m: any) => { sent.push(m); return true; }) }));

type Result = { data: any; error: any; count?: number };
let handlers: Record<string, (op: string, args: any[]) => Result> = {};
const calls: Array<{ table: string; op: string; args: any[] }> = [];
function chain(table: string) {
  const ops: Array<[string, any[]]> = [];
  const resolve = () => {
    const op = ops.find(([o]) => ['insert', 'update', 'upsert'].includes(o))?.[0] ?? 'select';
    const args = ops.flatMap(([, a]) => a);
    calls.push({ table, op, args });
    return (handlers[table] ?? (() => ({ data: null, error: null })))(op, args);
  };
  const q: any = new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === 'then') return (res: any) => res(resolve());
      if (prop === 'single' || prop === 'maybeSingle') return async () => resolve();
      return (...a: any[]) => { ops.push([prop, a]); return q; };
    },
  });
  return q;
}
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => chain(t) } }));

import { POST as loginPOST } from '@/app/api/console/login/route';
import { GET as verifyGET, POST as verifyPOST } from '@/app/api/console/verify/route';
import { POST as logoutPOST } from '@/app/api/console/logout/route';
import { GET as dataGET } from '@/app/api/console/data/route';
import { readFileSync } from 'node:fs';
import { createFunderSession, verifyFunderSession, hashLoginToken, FUNDER_COOKIE, consoleEnabled } from './funder-auth';
import { createSessionValue } from './session';
import { buildLeague, improvementBand } from './league';
import { FORBIDDEN_CONSOLE_FIELDS } from './console-data';
import { addDaysIso, type MetricRow } from './metrics';

const FUNDER = '11111111-2222-4333-8444-555555555555';
const req = (url: string, init: any = {}) => new NextRequest(`https://app.example${url}`, init);

beforeEach(() => {
  sent.length = 0; calls.length = 0; handlers = {};
  process.env.SESSION_SECRET = 'test-secret';
  delete process.env.TARKETT_CONSOLE_ENABLED;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.TARKETT_CONSOLE_ENABLED; });

describe('flag OFF (the default): nothing is reachable', () => {
  it('is off unless set to "on"', () => {
    expect(consoleEnabled()).toBe(false);
    process.env.TARKETT_CONSOLE_ENABLED = 'true';
    expect(consoleEnabled()).toBe(false);
  });

  it('every console API answers 404, sends nothing and reads nothing', async () => {
    const cookie = { headers: { cookie: `${FUNDER_COOKIE}=${createFunderSession(FUNDER)}` } };
    const responses = [
      await loginPOST(req('/api/console/login', { method: 'POST', body: JSON.stringify({ email: 'a@tarkett.com' }) })),
      await verifyGET(req('/api/console/verify?token=x')),
      await verifyPOST(req('/api/console/verify?token=x', { method: 'POST' })),
      await logoutPOST(req('/api/console/logout', { method: 'POST' })),
      await dataGET(req('/api/console/data', cookie)),
    ];
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(sent).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('the console and league pages call notFound() before rendering anything', () => {
    for (const f of ['app/console/page.tsx', 'app/console/league/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/if \(!consoleEnabled\(\)\) notFound\(\);\s*\n\s*return <ConsoleClient/);
    }
  });
});

describe('funder session is separate from shop sessions', () => {
  it('round-trips and expires', () => {
    const v = createFunderSession(FUNDER, 0);
    expect(verifyFunderSession(v, 1000)).toBe(FUNDER);
    expect(verifyFunderSession(v, 13 * 3600 * 1000)).toBeNull();
  });
  it('rejects a tampered id and a shop session cookie', () => {
    expect(verifyFunderSession(createFunderSession(FUNDER).replace(FUNDER, '99999999-2222-4333-8444-555555555555'))).toBeNull();
    expect(verifyFunderSession(createSessionValue(FUNDER))).toBeNull();
  });
});

describe('flag ON', () => {
  beforeEach(() => { process.env.TARKETT_CONSOLE_ENABLED = 'on'; });

  it('login: an unknown address gets the same answer and no email', async () => {
    handlers.funder_users = () => ({ data: null, error: null });
    const res = await loginPOST(req('/api/console/login', { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com' }) }));
    expect((await res.json()).ok).toBe(true);
    expect(sent).toEqual([]);
  });

  it('login: a registered address gets a link; only the hash is stored', async () => {
    handlers.funder_users = () => ({ data: { id: FUNDER, email: 'console.user@funder.example', active: true }, error: null });
    handlers.funder_login_tokens = (op) => (op === 'insert' ? { data: null, error: null } : { data: null, error: null, count: 0 });
    await loginPOST(req('/api/console/login', { method: 'POST', body: JSON.stringify({ email: 'Console.User@Funder.example' }) }));
    expect(sent).toHaveLength(1);
    const token = String(sent[0].html).match(/token=([A-Za-z0-9_-]+)/)![1];
    const insert = calls.find((c) => c.table === 'funder_login_tokens' && c.op === 'insert')!;
    expect(insert.args[0].token_hash).toBe(hashLoginToken(token));
    expect(JSON.stringify(insert.args)).not.toContain(token);
  });

  it('login: rate limited after five links an hour, with the same answer', async () => {
    handlers.funder_users = () => ({ data: { id: FUNDER, email: 'z@tarkett.com', active: true }, error: null });
    handlers.funder_login_tokens = () => ({ data: null, error: null, count: 5 });
    const res = await loginPOST(req('/api/console/login', { method: 'POST', body: JSON.stringify({ email: 'z@tarkett.com' }) }));
    expect((await res.json()).ok).toBe(true);
    expect(sent).toEqual([]);
  });

  it('verify: GET only confirms; POST spends the token once and sets the funder cookie', async () => {
    const token = 'a'.repeat(43);
    expect(await (await verifyGET(req(`/api/console/verify?token=${token}`))).text()).toContain('<form method="POST"');
    expect(calls).toEqual([]);
    handlers.funder_login_tokens = () => ({ data: [{ funder_user_id: FUNDER }], error: null });
    handlers.funder_users = () => ({ data: { id: FUNDER, active: true }, error: null });
    const res = await verifyPOST(req(`/api/console/verify?token=${token}`, { method: 'POST' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toContain(FUNDER_COOKIE);
    const spend = calls.find((c) => c.table === 'funder_login_tokens')!;
    expect(spend.op).toBe('update');
  });

  it('verify: a spent or expired token is refused', async () => {
    handlers.funder_login_tokens = () => ({ data: [], error: null });
    const res = await verifyPOST(req(`/api/console/verify?token=${'b'.repeat(43)}`, { method: 'POST' }));
    expect(await res.text()).toContain('Link not valid');
  });

  it('data: no session is 401; a shop session cookie does not count', async () => {
    expect((await dataGET(req('/api/console/data'))).status).toBe(401);
    expect((await dataGET(req('/api/console/data', { headers: { cookie: `chocka_session=${createSessionValue(FUNDER)}` } }))).status).toBe(401);
  });

  it('data: per-shop health without contact details, and no score for shops that have not joined', async () => {
    handlers.funder_users = () => ({ data: { id: FUNDER, tenant_id: 't', name: 'Z', active: true }, error: null });
    handlers.retailers = () => ({ data: [
      { id: 'r1', name: 'Testwell', town: 'Leeds', user_id: 'u1', connection_status: 'connected', ad_start_date: '2026-10-01', contact_email: 'dave@testwell.example' },
      { id: 'r2', name: 'Not Joined', town: 'York', user_id: null, connection_status: 'invited', ad_start_date: '2026-10-01' },
    ], error: null });
    handlers.retailer_invites = () => ({ data: [], error: null });
    handlers.users = () => ({ data: [{ id: 'u1', google_refresh_token: 'v1.secret', token_status: 'valid', phone_number: '07700900000', profiles: [{ id: 'p1', created_at: '2026-09-01T00:00:00Z', audit_score: 61, google_location_name: 'locations/1' }] }], error: null });
    handlers.scheduled_posts = () => ({ data: null, error: null, count: 4 });
    handlers.review_replies = () => ({ data: null, error: null, count: 2 });
    handlers.daily_metrics = () => ({ data: [], error: null });
    const res = await dataGET(req('/api/console/data', { headers: { cookie: `${FUNDER_COOKIE}=${createFunderSession(FUNDER)}` } }));
    const body = await res.json();
    const text = JSON.stringify(body);
    for (const f of FORBIDDEN_CONSOLE_FIELDS) expect(text).not.toContain(`"${f}"`);
    expect(text).not.toContain('dave@testwell');
    expect(text).not.toContain('v1.secret');
    expect(text).not.toContain('07700900000');
    const [joined, notJoined] = body.shops;
    expect(joined).toMatchObject({ name: 'Testwell', scoreAtActivation: 61, postsLast30: 4, repliesLast30: 2, adStartDate: '2026-10-01' });
    expect(notJoined).toMatchObject({ participating: false, scoreAtActivation: null, adStartDate: null });
  });
});

describe('league ranks improvement, not size', () => {
  const NOW = new Date('2026-11-14T12:00:00Z');
  function shop(id: string, activatedOn: string, before: number, after: number, viewsBefore = 100, viewsAfter = 100): any {
    const rows: MetricRow[] = [];
    for (let i = -28; i < 80; i++) {
      const date = addDaysIso(activatedOn, i);
      const pre = i < 0;
      rows.push({ date, metric: 'CALL_CLICKS', value: pre ? before : after });
      rows.push({ date, metric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', value: pre ? viewsBefore : viewsAfter });
    }
    return { retailerId: id, name: id, town: null, activatedOn, rows };
  }

  it('a small shop that grew beats a big shop that stood still', () => {
    const { ranked } = buildLeague([shop('Big', '2026-09-01', 50, 50), shop('Small', '2026-09-01', 2, 4)], NOW);
    expect(ranked.map((r) => r.name)).toEqual(['Small', 'Big']);
    expect(ranked[0]).toMatchObject({ actionsChange: 100, band: 'Strong rise' });
    expect(ranked[1]).toMatchObject({ actionsChange: 0, band: 'Steady' });
  });

  it('carries no raw counts', () => {
    const { ranked } = buildLeague([shop('A', '2026-09-01', 5, 6)], NOW);
    expect(Object.keys(ranked[0]).sort()).toEqual(['actionsChange', 'band', 'name', 'rank', 'retailerId', 'town', 'viewsChange']);
  });

  it('lists shops that joined too recently or have too little data, without ranking them', () => {
    const recent = shop('New', '2026-11-01', 5, 6);
    const tiny = shop('Tiny', '2026-09-01', 0, 1);
    const gappy = { ...shop('Gappy', '2026-09-01', 5, 6), rows: [] };
    const { ranked, excluded } = buildLeague([recent, tiny, gappy], NOW);
    expect(ranked).toEqual([]);
    expect(excluded.map((e) => e.name).sort()).toEqual(['Gappy', 'New', 'Tiny']);
  });

  it('bands', () => {
    expect([30, 10, 0, -10].map(improvementBand)).toEqual(['Strong rise', 'Rising', 'Steady', 'Falling']);
  });
});
