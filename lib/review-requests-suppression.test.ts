/**
 * The do-not-email list for review requests, end to end: the unsubscribe
 * link, the operator's manual add, every send and every export.
 *
 * Supabase is replaced by a fake that keeps the list in memory; the mailer is
 * a stub. Nothing reaches Supabase or Resend. Test addresses are
 * @example.invalid only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const db = vi.hoisted(() => ({
  /** review_request_suppressions, as the fake database holds it. */
  suppressions: [] as Array<{ email_hash: string; source: string }>,
  writes: [] as Array<{ table: string; op: string; row: any }>,
  failWrites: false,
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      // The tenant lookup in /api/admin/review-requests.
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'tenant-1' }, error: null }) }) }),
      upsert: async (row: any, opts: any) => {
        db.writes.push({ table, op: 'upsert', row });
        if (db.failWrites) return { error: { message: 'down' } };
        // ignoreDuplicates: an existing row is left exactly as it was.
        if (table === 'review_request_suppressions' && opts?.ignoreDuplicates && !db.suppressions.some((r) => r.email_hash === row.email_hash)) db.suppressions.push({ ...row });
        return { error: null };
      },
      delete: () => { db.writes.push({ table, op: 'delete', row: null }); throw new Error('nothing in these tests may delete'); },
    }),
  },
}));

import { POST as adminPOST } from '@/app/api/admin/review-requests/route';
import { GET as unsubGET, POST as unsubPOST } from '@/app/api/review-requests/unsubscribe/route';
import { hashEmail, normaliseEmail, unsubscribeUrl, verifyUnsubscribeToken } from './review-requests';
import { prepareRequests, sendRequests, purgeReviewRequests, addToDoNotEmail, type RequestShop } from './review-requests-data';
import { handleReviewRequestAction, SUPPRESSED_MESSAGE } from './review-requests-admin';
import { needsHelpCsv } from './needs-help-csv';
import { memoryStore, stubMailer, type MemoryStore } from './review-requests-test-fixtures';
import { getTenantBySlug } from './tenant';

const tenant = getTenantBySlug('stellar');
const ROOT = join(__dirname, '..');
const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const NOW = new Date('2026-11-21T12:00:00Z');
const ON = { REVIEW_REQUESTS: 'on' };
const OFF = {};
const PLACE = 'ChIJexampleexampleexample01';
const shop = (id: string, n: string): RequestShop => ({ id, tenantId: 'tenant-1', name: `Example Floors ${n}`, town: 'Exampleton', contactEmail: `owner-${n}@shop.example.invalid`, reviewLink: `https://search.google.com/local/writereview?placeid=${PLACE}` });
const SHOP_1 = shop('11111111-2222-4333-8444-555555555551', 'One');
const SHOP_2 = shop('11111111-2222-4333-8444-555555555552', 'Two');
const SHOPS = [SHOP_1, SHOP_2];
const PASSWORD = 'an-admin-password-for-tests-only';

const ctx = (store: MemoryStore, s: RequestShop, env: Record<string, string> = ON, m = stubMailer(undefined, store.log)) => ({
  m, c: { tenant, loadShop: async () => ({ ok: true as const, shop: s }), store, deps: { send: m.send, sleep: async () => {}, gapMs: 0, now: () => NOW }, env, now: NOW },
});
const dry = (store: MemoryStore, s: RequestShop, csv: string, env: Record<string, string> = ON) => handleReviewRequestAction({ action: 'dry_run', retailerId: s.id, csv }, ctx(store, s, env).c);
const willSend = (out: { body: any }) => out.body.rows.filter((r: any) => r.send).map((r: any) => normaliseEmail(r.email));
const adminReq = (body: unknown, auth: string | null = `Bearer ${PASSWORD}`) => new NextRequest('https://app.example.com/api/admin/review-requests', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const tokenOf = (url: string) => new URL(url).searchParams.get('t');
/** A memory store seeded with whatever the fake database's list holds now. */
const storeFromDb = () => memoryStore({ suppressed: db.suppressions.map((r) => r.email_hash) });

beforeEach(() => {
  db.suppressions.length = 0; db.writes.length = 0; db.failWrites = false;
  process.env.CANCEL_HASH_SECRET = 'test-secret';
  process.env.ADMIN_PASSWORD = PASSWORD;
  delete process.env.REVIEW_REQUESTS;
});

describe('one normaliser for every way onto the list', () => {
  it('case and surrounding spaces never matter: "  Someone@Example.INVALID " is "someone@example.invalid"', () => {
    expect(hashEmail('  Someone@Example.INVALID ')).toBe(hashEmail('someone@example.invalid'));
    expect(normaliseEmail('  Someone@Example.INVALID ')).toBe('someone@example.invalid');
  });
  it('the manual add uses the same emailProblem and hashEmail as the uploaded file, not a second implementation', () => {
    const data = src('lib/review-requests-data.ts');
    const from = data.slice(data.indexOf('export async function addToDoNotEmail'));
    const body = from.slice(0, from.indexOf('\n}\n'));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/emailProblem\(raw\)/);
    expect(body).toMatch(/hashEmail\(raw\)/);
    expect(body).not.toMatch(/toLowerCase|trim\(|createHash/);
    // hashEmail is the only place an address is hashed, and it normalises first.
    expect(src('lib/review-requests.ts')).toMatch(/update\(`review-request-email:v1:\$\{normaliseEmail\(email\)\}`\)/);
    for (const f of ['lib/review-requests-data.ts', 'lib/review-requests-admin.ts', 'app/api/admin/review-requests/route.ts', 'app/api/review-requests/unsubscribe/route.ts']) expect(src(f), f).not.toMatch(/createHash/);
  });
});

describe('the operator adds an address by hand (POST /api/admin/review-requests { action: "suppress" })', () => {
  it('refuses without the admin password, or with the wrong one, and adds nothing', async () => {
    for (const auth of [null, 'Bearer wrong', `Bearer ${PASSWORD}x`, PASSWORD.slice(1)]) {
      const res = await adminPOST(adminReq({ action: 'suppress', email: 'someone@example.invalid' }, auth));
      expect(res.status, String(auth)).toBe(401);
    }
    expect(db.writes).toEqual([]);
  });
  it('refuses malformed addresses, says nothing was added, and adds nothing', async () => {
    for (const email of ['', '   ', 'nope', 'a@b', 'two@@example.invalid', 'a b@example.invalid', '<a@example.invalid>', 'a@example.invalid, b@example.invalid', `${'x'.repeat(400)}@example.invalid`, 42, null, undefined, ['a@example.invalid'], { email: 'a@example.invalid' }]) {
      const res = await adminPOST(adminReq({ action: 'suppress', email }));
      const body = await res.json();
      expect(res.status, JSON.stringify(email)).toBe(400);
      expect(body.error).toMatch(/Nothing was added/);
    }
    expect(db.writes).toEqual([]);
  });
  it('adds the hash, never the address, marked as added by an operator, case-insensitively', async () => {
    const res = await adminPOST(adminReq({ action: 'suppress', email: '  Someone@Example.INVALID ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true, message: SUPPRESSED_MESSAGE });
    expect(db.suppressions).toEqual([{ email_hash: hashEmail('someone@example.invalid'), source: 'operator' }]);
    expect(JSON.stringify(db.writes)).not.toContain('@');
  });
  it('is idempotent, and the answer is identical whether or not the address was already on the list', async () => {
    const first = await (await adminPOST(adminReq({ action: 'suppress', email: 'someone@example.invalid' }))).json();
    const again = await (await adminPOST(adminReq({ action: 'suppress', email: 'SOMEONE@example.invalid' }))).json();
    expect(again).toEqual(first);
    expect(first.message).toBe(SUPPRESSED_MESSAGE);
    expect(first.message).toMatch(/^Done\./);
    expect(JSON.stringify(first)).not.toMatch(/@|already|new|added before/i);
    expect(db.suppressions).toHaveLength(1);
  });
  it('keeps the first entry: an address that unsubscribed by its link stays marked as "link"', async () => {
    const h = hashEmail('someone@example.invalid');
    await unsubPOST(new NextRequest(unsubscribeUrl('https://app.example.com', h), { method: 'POST', headers: { 'x-tenant-slug': 'stellar' } }));
    await adminPOST(adminReq({ action: 'suppress', email: 'someone@example.invalid' }));
    expect(db.suppressions).toEqual([{ email_hash: h, source: 'link' }]);
  });
  it('works whether REVIEW_REQUESTS is on or off, and needs no shop', async () => {
    for (const env of [undefined, 'off', 'on']) {
      if (env === undefined) delete process.env.REVIEW_REQUESTS; else process.env.REVIEW_REQUESTS = env;
      const res = await adminPOST(adminReq({ action: 'suppress', email: `x-${env}@example.invalid` }));
      expect(res.status, String(env)).toBe(200);
    }
    expect(db.suppressions).toHaveLength(3);
  });
  it('a failed write says so, and is not reported as done', async () => {
    db.failWrites = true;
    const res = await adminPOST(adminReq({ action: 'suppress', email: 'someone@example.invalid' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/^Done/);
  });
  it('the address is not logged', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await adminPOST(adminReq({ action: 'suppress', email: 'someone@example.invalid' }));
    db.failWrites = true;
    await adminPOST(adminReq({ action: 'suppress', email: 'someone@example.invalid' }));
    expect(JSON.stringify([...log.mock.calls, ...err.mock.calls])).not.toContain('someone');
    log.mockRestore(); err.mockRestore();
  });
  it('the panel has the form, posting { action: "suppress" } and showing the answer as one line', () => {
    const panel = src('components/admin/ReviewRequestPanel.tsx');
    expect(panel).toContain('Add to the do-not-email list');
    expect(panel).toMatch(/action: 'suppress', email/);
    expect(panel).toMatch(/role="status"/);
  });
});

describe('an operator-added address is never sent to, by any shop', () => {
  it('excluded from the dry run and the send for every shop, whatever its case or spaces', async () => {
    await adminPOST(adminReq({ action: 'suppress', email: '  Someone@Example.INVALID ' }));
    for (const s of SHOPS) {
      const store = storeFromDb();
      const csv = 'someone@example.invalid\nSOMEONE@EXAMPLE.INVALID\nother@example.invalid';
      const d = await dry(store, s, csv);
      expect(d.body.rows.map((r: any) => r.reason)).toEqual(['unsubscribed from review requests', 'already in this file (row 1)', null]);
      const { m, c } = ctx(store, s);
      const out = await handleReviewRequestAction({ action: 'send', retailerId: s.id, csv, confirmCount: '1' }, c);
      expect(out.body.result.sent).toBe(1);
      expect(m.sent.map((e) => e.to)).toEqual(['other@example.invalid']);
    }
  });
});

describe('after someone unsubscribes by the link, no shop sends to them', () => {
  const h = hashEmail('leaver@example.invalid');
  const link = () => unsubscribeUrl('https://app.example.com', h);
  const req = (method: string, body?: string) => new NextRequest(link(), { method, headers: { 'x-tenant-slug': 'stellar', ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body });

  it('GET shows the confirm button and writes nothing; POST puts the hash on the list as "link"', async () => {
    const page = await unsubGET(req('GET'));
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/Stop review requests\?[\s\S]*<form method="POST"/);
    expect(db.writes).toEqual([]);
    const done = await unsubPOST(req('POST'));
    expect(done.status).toBe(200);
    expect(db.suppressions).toEqual([{ email_hash: h, source: 'link' }]);
  });
  it("a mail client's one-click POST (RFC 8058) does the same", async () => {
    const done = await unsubPOST(req('POST', 'List-Unsubscribe=One-Click'));
    expect(done.status).toBe(200);
    expect(db.suppressions).toEqual([{ email_hash: h, source: 'link' }]);
  });
  it('then excluded from the dry run and the send, for every shop', async () => {
    await unsubPOST(req('POST', 'List-Unsubscribe=One-Click'));
    for (const s of SHOPS) {
      const store = storeFromDb();
      const csv = 'Leaver@Example.invalid\nstay@example.invalid';
      const d = await dry(store, s, csv);
      expect(willSend(d)).toEqual(['stay@example.invalid']);
      expect(d.body.rows[0].reason).toBe('unsubscribed from review requests');
      const { m, c } = ctx(store, s);
      await handleReviewRequestAction({ action: 'send', retailerId: s.id, csv, confirmCount: '1' }, c);
      expect(m.sent.map((e) => e.to)).toEqual(['stay@example.invalid']);
    }
  });
});

describe('the list is read again at the last moment before each email', () => {
  it('an address added between the dry run and the confirm is not emailed: the old count is refused, and a new dry run leaves it out', async () => {
    const store = memoryStore();
    const csv = 'a@example.invalid\nb@example.invalid\nc@example.invalid';
    expect((await dry(store, SHOP_1, csv)).body.willSend).toBe(3);
    // The operator records a "stop" for b before pressing Send.
    expect((await handleReviewRequestAction({ action: 'suppress', email: ' B@example.invalid' }, ctx(store, SHOP_1).c)).status).toBe(200);
    const { m, c } = ctx(store, SHOP_1);
    const stale = await handleReviewRequestAction({ action: 'send', retailerId: SHOP_1.id, csv, confirmCount: '3' }, c);
    expect(stale.status).toBe(409);
    expect(m.send).not.toHaveBeenCalled();
    const again = await dry(store, SHOP_1, csv);
    expect(willSend(again)).toEqual(['a@example.invalid', 'c@example.invalid']);
    const sent = await handleReviewRequestAction({ action: 'send', retailerId: SHOP_1.id, csv, confirmCount: '2' }, c);
    expect(sent.status).toBe(200);
    expect(m.sent.map((e) => e.to)).toEqual(['a@example.invalid', 'c@example.invalid']);
  });
  it('an address added after the plan was made, while the batch is going out, is not emailed', async () => {
    const store = memoryStore();
    const p = await prepareRequests(store, SHOP_1, 'a@example.invalid\nb@example.invalid\nc@example.invalid', NOW);
    expect(p.plan!.toSend).toHaveLength(3);
    // b is added by hand while a's email is being sent.
    const m = stubMailer((e) => { if (e.to === 'a@example.invalid') void addToDoNotEmail(store, 'b@EXAMPLE.invalid'); return true; }, store.log);
    const r = await sendRequests(store, SHOP_1, p.plan!, tenant, { send: m.send, sleep: async () => {}, now: () => NOW, env: ON, gapMs: 0 });
    expect(m.sent.map((e) => e.to)).toEqual(['a@example.invalid', 'c@example.invalid']);
    expect(r.skipped).toEqual([{ row: 2, email: 'b@example.invalid', reason: 'unsubscribed' }]);
    // Its claim was given back: it is not recorded as asked.
    expect(store.history.has(`${SHOP_1.id}|${hashEmail('b@example.invalid')}`)).toBe(false);
  });
  it('for every email, the list check for that address is the store call immediately before the send', async () => {
    const store = memoryStore();
    const p = await prepareRequests(store, SHOP_1, 'a@example.invalid\nb@example.invalid\nc@example.invalid', NOW);
    store.log.length = 0;
    const m = stubMailer(undefined, store.log);
    await sendRequests(store, SHOP_1, p.plan!, tenant, { send: m.send, sleep: async () => {}, now: () => NOW, env: ON, gapMs: 0 });
    for (const to of ['a@example.invalid', 'b@example.invalid', 'c@example.invalid']) {
      const i = store.log.indexOf(`send:${to}`);
      expect(i, to).toBeGreaterThan(0);
      expect(store.log[i - 1], to).toBe(`isSuppressed:${hashEmail(to)}`);
    }
  });
  it('if the list cannot be read at that moment, nothing more is sent and the claim is given back', async () => {
    const store = memoryStore();
    const p = await prepareRequests(store, SHOP_1, 'a@example.invalid', NOW);
    store.isSuppressed = async () => { throw new Error('could not read the unsubscribe list'); };
    const m = stubMailer();
    await expect(sendRequests(store, SHOP_1, p.plan!, tenant, { send: m.send, sleep: async () => {}, now: () => NOW, env: ON, gapMs: 0 })).rejects.toThrow();
    expect(m.send).not.toHaveBeenCalled();
    expect(store.history.size).toBe(0);
  });
});

describe('every request email can be unsubscribed from', () => {
  it('carries its own working link in the text and the List-Unsubscribe headers, for its own address', async () => {
    const store = memoryStore();
    const { m, c } = ctx(store, SHOP_1);
    await handleReviewRequestAction({ action: 'send', retailerId: SHOP_1.id, csv: 'a@example.invalid\nB@Example.invalid', confirmCount: '2' }, c);
    expect(m.sent).toHaveLength(2);
    for (const e of m.sent) {
      const url = /^(https:\/\/\S+\/api\/review-requests\/unsubscribe\?t=\S+)$/m.exec(e.text)?.[1];
      expect(url, e.to).toBeTruthy();
      expect(verifyUnsubscribeToken(tokenOf(url!))).toBe(hashEmail(e.to));
      expect(e.headers).toEqual({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
      // And the link works: pressing it puts that address on the list.
      const res = await unsubPOST(new NextRequest(url!, { method: 'POST', headers: { 'x-tenant-slug': 'stellar' } }));
      expect(res.status).toBe(200);
    }
    expect(db.suppressions.map((r) => r.email_hash).sort()).toEqual([hashEmail('a@example.invalid'), hashEmail('b@example.invalid')].sort());
  });
});

describe('an unsubscribe is permanent', () => {
  it('the daily clear-out never touches the do-not-email list', async () => {
    const touched: string[] = [];
    const fake = { from: (t: string) => { touched.push(t); return { delete: () => ({ lt: async () => ({ error: null, count: 0 }) }) }; } };
    await purgeReviewRequests(fake, NOW);
    expect(touched).toEqual(['review_requests', 'review_request_history']);
    const data = src('lib/review-requests-data.ts');
    const purge = data.slice(data.indexOf('export async function purgeReviewRequests'));
    expect(purge.slice(0, purge.indexOf('\n}\n'))).not.toMatch(/T_SUPPRESS|review_request_suppressions/);
  });
  it('no app code deletes from it: every use of the table is a read or an insert that keeps what is there', () => {
    const data = src('lib/review-requests-data.ts');
    const uses = data.match(/\.from\(T_SUPPRESS\)\.\w+\([^)]*\)/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const u of uses) expect(u).toMatch(/\.from\(T_SUPPRESS\)\.(select|upsert)\(/);
    expect(data).toMatch(/upsert\(\{ email_hash: emailHash, source \}, \{ onConflict: 'email_hash', ignoreDuplicates: true \}\)/);
  });
  it('no source file outside the dummy run names the table next to a delete, an update or a truncate', () => {
    // The staging dummy run (scripts/dummy-run) is the one exception, on
    // purpose: it deletes the rows IT created, so staging is left as found.
    const skip = new Set(['node_modules', '.next', '.netlify', '.git', 'dummy-run', 'source-data', '.claude']);
    const files: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { if (skip.has(n)) continue; const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|js|mjs|mts|sql)$/.test(n) && !/\.test\.ts$/.test(n)) files.push(p); } };
    for (const d of ['app', 'lib', 'components', 'netlify', 'scripts', 'supabase', 'middleware.ts']) { const p = join(ROOT, d); try { statSync(p).isDirectory() ? walk(p) : files.push(p); } catch { /* not there */ } }
    const naming = files.filter((f) => /review_request_suppressions|T_SUPPRESS/.test(readFileSync(f, 'utf8')));
    // review-requests.ts names it only in its header comment.
    expect(naming.map((f) => relative(ROOT, f)).sort()).toEqual(['lib/readiness.ts', 'lib/review-requests-data.ts', 'lib/review-requests.ts', 'supabase/migrations/20261121100000_review_requests.sql']);
    for (const f of naming) {
      const text = readFileSync(f, 'utf8').replace(/--.*$/gm, '');
      for (const line of text.split('\n').filter((l) => /review_request_suppressions|T_SUPPRESS/.test(l))) {
        expect(line, relative(ROOT, f)).not.toMatch(/\.delete\(|\.update\(|\bdelete\s+from\b|\btruncate\b|\bdrop\b|on delete/i);
      }
    }
  });
  it('the table: hashes only, when it was added, and how (link or operator); no shop column, nothing that cascades it away', () => {
    const sql = src('supabase/migrations/20261121100000_review_requests.sql');
    const def = sql.slice(sql.indexOf('create table if not exists public.review_request_suppressions'));
    const cols = def.slice(0, def.indexOf(');'));
    expect(cols).toMatch(/email_hash\s+text primary key check \(email_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(cols).toMatch(/added_at\s+timestamptz not null default now\(\)/);
    expect(cols).toMatch(/source\s+text not null check \(source in \('link', 'operator'\)\)/);
    expect(cols).not.toMatch(/retailer_id|tenant_id|references|\bemail\s+text/);
  });
});

describe('exports', () => {
  it('the review-request flow has no file export at all: the dry run is shown on screen only', () => {
    for (const f of ['components/admin/ReviewRequestPanel.tsx', 'lib/review-requests.ts', 'lib/review-requests-data.ts', 'lib/review-requests-admin.ts', 'app/api/admin/review-requests/route.ts']) {
      expect(src(f), f).not.toMatch(/new Blob|createObjectURL|\.download\s*=|Content-Disposition|text\/csv['"]\s*[,}]/);
    }
  });
  it('the needs-help file carries no email address, even one typed into a note or passed in by mistake', () => {
    const row: any = { name: 'Example Floors', town: 'Exampleton', contactEmail: 'owner@shop.example.invalid', help: { label: 'Not connected', since: '2026-11-01T00:00:00Z', why: 'Invited, not connected', action: 'Ring them' }, note: 'Spoke to Sam, sam.someone@Example.invalid, call back Tuesday' };
    const file = needsHelpCsv([row]);
    expect(file).not.toContain('@');
    expect(file).toContain('[address removed]');
    expect(file.split('\n')[0]).toBe('shop,town,status,waiting since,what happened,what to do,note');
  });
  it('every other file /admin/pilot downloads is built from names, towns, links and figures only, never an address', () => {
    const page = src('app/admin/pilot/page.tsx');
    // Each download builds its file in the few lines before its createObjectURL.
    const builders = page.split('\n').map((l, i, all) => (l.includes('createObjectURL') ? all.slice(Math.max(0, i - 8), i + 1).join('\n') : null)).filter(Boolean) as string[];
    expect(builders.length).toBeGreaterThanOrEqual(5);
    for (const b of builders) expect(b).not.toMatch(/contactEmail|\.email\b|contact_email/);
    expect(page).toMatch(/needsHelpCsv\(helpRows\.map\(\(r\) => \(\{ name: r\.name, town: r\.town, help: r\.help, note: r\.note \}\)\)\)/);
    // The server-built files: the statement and the retention view.
    expect(src('lib/retention.ts')).toMatch(/no email address, no phone number/);
    const statement = src('lib/billing.ts');
    const fn = statement.slice(statement.indexOf('export function statementCsv'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).not.toMatch(/email|contact/i);
  });
});
