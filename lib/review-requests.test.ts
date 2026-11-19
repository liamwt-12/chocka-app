import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseRequestCsv, planRequests, emailProblem, normaliseEmail, hashEmail, cleanFirstName, reviewRequestsEnabled,
  requestText, requestSubject, requestFromName, unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, unsubscribeHeaders,
  retentionCutoffs, MAX_PER_BATCH, MAX_PER_SHOP_PER_DAY, MAX_PLATFORM_PER_DAY, MAX_ROWS_PER_FILE, REQUEST_ROW_DAYS, REASK_DAYS,
  type PlanContext,
} from './review-requests';
import {
  prepareRequests, sendRequests, composeRequest, confirmationMatches, purgeReviewRequests, loadRequestShop,
  type RequestStore, type RequestShop, type Composed,
} from './review-requests-data';
import { handleReviewRequestAction } from './review-requests-admin';
import { fromWithName, safeHeaders, sendEmail } from './email';
import { getTenantBySlug } from './tenant';

const tenant = getTenantBySlug('stellar');
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const NOW = new Date('2026-11-21T12:00:00Z');
const PLACE = 'ChIJexampleexampleexample01';
const SHOP: RequestShop = { id: '11111111-2222-4333-8444-555555555555', tenantId: 'tenant-1', name: 'Example Floors', town: 'Exampleton', contactEmail: 'owner@shop.example.com', reviewLink: `https://search.google.com/local/writereview?placeid=${PLACE}` };
const ON = { REVIEW_REQUESTS: 'on' };
const OFF = {};
const empty = (): PlanContext => ({ shopEmail: SHOP.contactEmail, suppressed: new Set(), askedBefore: new Map(), sentTodayShop: 0, sentTodayPlatform: 0 });
const csvOf = (n: number, start = 0) => Array.from({ length: n }, (_, i) => `person${start + i}@example.invalid`).join('\n');

/** An in-memory stand-in for the three tables. */
function memoryStore(init: { suppressed?: string[]; history?: Array<[string, string, string]>; sent?: Array<{ retailer_id: string; created_at: string }> } = {}) {
  const suppressed = new Set(init.suppressed || []);
  const history = new Map<string, string>((init.history || []).map(([r, h, at]) => [`${r}|${h}`, at]));
  const rows: Array<{ retailer_id: string; email_hash: string; status: string; created_at: string; batch_id: string }> = (init.sent || []).map((s) => ({ ...s, email_hash: 'x', status: 'sent', batch_id: 'b' }));
  const store: RequestStore & { suppressed: Set<string>; history: Map<string, string>; rows: typeof rows } = {
    suppressed, history, rows,
    async suppressedAmong(hs) { return new Set(hs.filter((h) => suppressed.has(h))); },
    async isSuppressed(h) { return suppressed.has(h); },
    async askedBefore(r, hs, since) { const m = new Map<string, string>(); for (const h of hs) { const at = history.get(`${r}|${h}`); if (at && at >= since) m.set(h, at); } return m; },
    async sentSince(r, since) { return rows.filter((x) => x.status === 'sent' && x.created_at >= since && (!r || x.retailer_id === r)).length; },
    async claim(r, _t, h, at, since) { const k = `${r}|${h}`; const was = history.get(k); if (was && was >= since) return false; history.set(k, at); return true; },
    async release(r, h, at) { if (history.get(`${r}|${h}`) === at) history.delete(`${r}|${h}`); },
    async record(row) { rows.push(row); },
  };
  return store;
}
const stubMailer = (ok: (e: Composed) => boolean = () => true) => { const sent: Composed[] = []; return { sent, send: vi.fn(async (e: Composed) => { sent.push(e); return ok(e); }) }; };
const fastDeps = (mailer: ReturnType<typeof stubMailer>, env: Record<string, string> = ON) => ({ send: mailer.send, sleep: async () => {}, now: () => NOW, env, gapMs: 0 });

beforeEach(() => { process.env.CANCEL_HASH_SECRET = 'test-secret'; });

describe('the file', () => {
  it('reads addresses with no header, one per line, first name optional', () => {
    const p = parseRequestCsv('a@example.invalid,Sam\nb@example.invalid\n');
    expect(p.error).toBeNull();
    expect(p.headerFound).toBe(false);
    expect(p.rows.map((r) => [r.row, r.email, r.firstName, r.problem])).toEqual([[1, 'a@example.invalid', 'Sam', null], [2, 'b@example.invalid', null, null]]);
  });
  it('recognises a header, in any column order, and skips blank lines, a BOM and Windows line ends', () => {
    const p = parseRequestCsv('﻿First Name,Email\r\n\r\nSam,  A@Example.invalid \r\n"Lou",b@example.invalid\r\n');
    expect(p.headerFound).toBe(true);
    expect(p.rows.map((r) => [r.row, r.email, r.firstName])).toEqual([[3, 'A@Example.invalid', 'Sam'], [4, 'b@example.invalid', 'Lou']]);
  });
  it('handles quoted cells, semicolons and tabs', () => {
    expect(parseRequestCsv('"a@example.invalid","Jo"').rows[0]).toMatchObject({ email: 'a@example.invalid', firstName: 'Jo' });
    expect(parseRequestCsv('a@example.invalid;Jo').rows[0]).toMatchObject({ email: 'a@example.invalid', firstName: 'Jo' });
    expect(parseRequestCsv('a@example.invalid\tJo').rows[0]).toMatchObject({ email: 'a@example.invalid', firstName: 'Jo' });
  });
  it('gives a reason for every address it cannot use', () => {
    const p = parseRequestCsv(['', 'not-an-address', 'a@b', 'two words@example.invalid', 'a..b@example.invalid', `${'x'.repeat(65)}@example.invalid`, `a@${'x'.repeat(250)}.com`, 'a@@example.invalid', 'a@example.c0m', ','].join('\n'));
    expect(p.rows.map((r) => r.problem)).toEqual(['not an email address', 'not an email address', 'not an email address', 'not an email address', 'too long to be an email address', 'too long to be an email address', 'not an email address', 'not an email address', 'no email address']);
  });
  it('accepts ordinary addresses, and compares them trimmed and lower-cased', () => {
    for (const ok of ['a@example.invalid', 'first.last+tag@sub.example.co.uk', "o'neil@example.com", 'A_B-c@Example-Mail.org']) expect(emailProblem(ok), ok).toBeNull();
    expect(normaliseEmail('  A@Example.COM ')).toBe('a@example.com');
    expect(hashEmail(' A@Example.COM')).toBe(hashEmail('a@example.com'));
    expect(hashEmail('a@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('uses a first name only if it is plainly one; otherwise says so and greets without one', () => {
    expect(cleanFirstName('Sam')).toBe('Sam');
    expect(cleanFirstName("Zoë-Ann")).toBe("Zoë-Ann");
    for (const bad of ['Sam Smith', '<b>x</b>', 'http://x', '12', '']) expect(cleanFirstName(bad), bad).toBeNull();
    expect(parseRequestCsv('a@example.invalid,Click here').rows[0]).toMatchObject({ firstName: null, firstNameDropped: true });
  });
  it('refuses an empty file, a file too long or too large, rather than cutting it short', () => {
    expect(parseRequestCsv('').error).toMatch(/empty/);
    expect(parseRequestCsv('email\n').error).toMatch(/no rows/);
    expect(parseRequestCsv(csvOf(MAX_ROWS_PER_FILE + 1)).error).toMatch(/more than 1000 rows/);
    expect(parseRequestCsv('a@example.invalid,' + 'x'.repeat(210_000)).error).toMatch(/larger than/);
  });
});

describe('who gets it: duplicates, own address, asked before', () => {
  it('leaves out a repeat within the file, whatever its case or spaces, naming the first row', () => {
    const plan = planRequests(parseRequestCsv('a@example.invalid\n A@EXAMPLE.invalid \nb@example.invalid').rows, empty());
    expect(plan.toSend.map((l) => l.email)).toEqual(['a@example.invalid', 'b@example.invalid']);
    expect(plan.excluded[0]).toMatchObject({ row: 2, reason: 'already in this file (row 1)' });
  });
  it("leaves out the shop's own address", () => {
    const plan = planRequests(parseRequestCsv('Owner@Shop.Example.com').rows, empty());
    expect(plan.excluded[0].reason).toBe("the shop's own address");
  });
  it('never asks the same address twice for the same shop within a year', () => {
    const ctx = empty();
    ctx.askedBefore.set(hashEmail('a@example.invalid'), '2026-10-01T09:00:00Z');
    const plan = planRequests(parseRequestCsv('a@example.invalid\nb@example.invalid').rows, ctx);
    expect(plan.excluded[0]).toMatchObject({ email: 'a@example.invalid', reason: 'already asked by this shop on 2026-10-01' });
    expect(REASK_DAYS).toBe(365);
  });
  it('a second send of the same file sends nothing new', async () => {
    const store = memoryStore();
    const m = stubMailer();
    const first = await prepareRequests(store, SHOP, 'a@example.invalid\nb@example.invalid', NOW);
    await sendRequests(store, SHOP, first.plan!, tenant, fastDeps(m));
    const again = await prepareRequests(store, SHOP, 'a@example.invalid\nB@example.invalid', NOW);
    expect(again.plan!.toSend).toEqual([]);
    expect(again.plan!.excluded.map((l) => l.reason)).toEqual(['already asked by this shop on 2026-11-21', 'already asked by this shop on 2026-11-21']);
    expect(m.sent).toHaveLength(2);
  });
  it('another shop may ask the same address', async () => {
    const store = memoryStore({ history: [['another-shop', hashEmail('a@example.invalid'), NOW.toISOString()]] });
    const p = await prepareRequests(store, SHOP, 'a@example.invalid', NOW);
    expect(p.plan!.toSend).toHaveLength(1);
  });
});

describe('the unsubscribe list', () => {
  it('an unsubscribed address is left out, for every shop', async () => {
    const store = memoryStore({ suppressed: [hashEmail('gone@example.invalid')] });
    for (const shop of [SHOP, { ...SHOP, id: 'another-shop' }]) {
      const p = await prepareRequests(store, shop, 'Gone@Example.invalid\nok@example.invalid', NOW);
      expect(p.plan!.excluded[0].reason).toBe('unsubscribed from review requests');
      expect(p.plan!.toSend.map((l) => l.email)).toEqual(['ok@example.invalid']);
    }
  });
  it('is checked again immediately before every send: someone who unsubscribes mid-batch is not sent to', async () => {
    const store = memoryStore();
    const p = await prepareRequests(store, SHOP, 'a@example.invalid\nb@example.invalid\nc@example.invalid', NOW);
    const m = stubMailer((e) => { if (e.to === 'a@example.invalid') store.suppressed.add(hashEmail('b@example.invalid')); return true; });
    const r = await sendRequests(store, SHOP, p.plan!, tenant, fastDeps(m));
    expect(m.sent.map((e) => e.to)).toEqual(['a@example.invalid', 'c@example.invalid']);
    expect(r.skipped).toEqual([{ row: 2, email: 'b@example.invalid', reason: 'unsubscribed' }]);
  });
  it('the table holds hashes, never addresses, and has no shop column', () => {
    const sql = src('../supabase/migrations/20261121100000_review_requests.sql');
    const suppress = sql.slice(sql.indexOf('create table if not exists public.review_request_suppressions'));
    expect(suppress.slice(0, suppress.indexOf(');'))).not.toMatch(/retailer_id|\bemail\s+text/);
    expect(sql).not.toMatch(/^\s+email\s+text/m);
  });
});

describe('the unsubscribe link', () => {
  const h = hashEmail('a@example.invalid');
  it('verifies its own token and returns the hash it is for', () => {
    expect(verifyUnsubscribeToken(unsubscribeToken(h))).toBe(h);
  });
  it('refuses a changed hash, a changed signature, a token signed with another secret, and junk', () => {
    const t = unsubscribeToken(h);
    const other = hashEmail('b@example.invalid');
    expect(verifyUnsubscribeToken(`${other}.${t.split('.')[1]}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${h}.${'0'.repeat(32)}`)).toBeNull();
    process.env.CANCEL_HASH_SECRET = 'another-secret';
    expect(verifyUnsubscribeToken(t)).toBeNull();
    for (const junk of [undefined, null, '', 'x', `${h}.`, `${h}.zz`, 42]) expect(verifyUnsubscribeToken(junk)).toBeNull();
  });
  it('carries no address, and the headers offer one-click unsubscribe', () => {
    const url = unsubscribeUrl('https://app.example.com/', h);
    expect(url).toMatch(/^https:\/\/app\.example\.com\/api\/review-requests\/unsubscribe\?t=[0-9a-f]{64}\.[0-9a-f]{32}$/);
    expect(url).not.toContain('example.invalid');
    expect(unsubscribeHeaders(url)).toEqual({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  });
  it('refuses to make a token for something that is not a hash', () => {
    expect(() => unsubscribeToken('a@example.invalid')).toThrow();
  });
});

describe('the dry run', () => {
  it('shows who would get it and who would not and why, and the exact email; sends and writes nothing', async () => {
    const store = memoryStore({ suppressed: [hashEmail('gone@example.invalid')] });
    const m = stubMailer();
    const out = await handleReviewRequestAction(
      { action: 'dry_run', retailerId: SHOP.id, csv: 'email,first_name\nsam@example.invalid,Sam\nnope\ngone@example.invalid,\nsam@example.invalid,Sam' },
      { tenant, loadShop: async () => ({ ok: true, shop: SHOP }), store, deps: { send: m.send }, env: ON, now: NOW },
    );
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ dryRun: true, enabled: true, willSend: 1, excludedCount: 3, headerFound: true, confirmWith: 1 });
    expect(out.body.rows.map((r: any) => [r.row, r.send, r.reason])).toEqual([[2, true, null], [3, false, 'not an email address'], [4, false, 'unsubscribed from review requests'], [5, false, 'already in this file (row 2)']]);
    expect(out.body.sample).toMatchObject({ to: 'sam@example.invalid', from: '"Example Floors via Stellar Local" <hello@stellarlocal.co.uk>', replyTo: SHOP.contactEmail, subject: 'Would you review Example Floors on Google?' });
    expect(out.body.sample.text).toMatch(/^Hello Sam,\n/);
    expect(m.send).not.toHaveBeenCalled();
    expect(store.rows).toEqual([]);
    expect(store.history.size).toBe(0);
  });
  it('works, as a dry run only, with the switch off', async () => {
    const out = await handleReviewRequestAction({ action: 'dry_run', retailerId: SHOP.id, csv: 'a@example.invalid' }, { tenant, loadShop: async () => ({ ok: true, shop: SHOP }), store: memoryStore(), deps: { send: stubMailer().send }, env: OFF, now: NOW });
    expect(out.body).toMatchObject({ enabled: false, willSend: 1 });
  });
  it('a refused shop or a broken file is an error, not a dry run', async () => {
    const base = { tenant, store: memoryStore(), deps: { send: stubMailer().send }, env: ON, now: NOW };
    expect((await handleReviewRequestAction({ action: 'dry_run', csv: 'a@example.invalid' }, { ...base, loadShop: async () => ({ ok: false, error: 'nope' }) })).status).toBe(400);
    expect((await handleReviewRequestAction({ action: 'dry_run', csv: '' }, { ...base, loadShop: async () => ({ ok: true, shop: SHOP }) })).body.error).toMatch(/empty/);
    expect((await handleReviewRequestAction({ action: 'whatever' }, { ...base, loadShop: async () => ({ ok: true, shop: SHOP }) })).status).toBe(400);
  });
});

describe('sending needs the switch AND the typed confirmation', () => {
  const ctx = (env: Record<string, string>, store = memoryStore(), m = stubMailer()) => ({ m, store, c: { tenant, loadShop: async () => ({ ok: true as const, shop: SHOP }), store, deps: { send: m.send, sleep: async () => {}, gapMs: 0 }, env, now: NOW } });
  it('with the switch off, nothing is sent, whatever is typed', async () => {
    const { m, store, c } = ctx(OFF);
    const out = await handleReviewRequestAction({ action: 'send', retailerId: SHOP.id, csv: 'a@example.invalid', confirmCount: '1' }, c);
    expect(out.status).toBe(403);
    expect(out.body.error).toMatch(/switched off/);
    expect(m.send).not.toHaveBeenCalled();
    expect(store.rows).toEqual([]);
  });
  it('the sending loop itself refuses with the switch off, even if called directly', async () => {
    const store = memoryStore(); const m = stubMailer();
    const p = await prepareRequests(store, SHOP, 'a@example.invalid', NOW);
    for (const env of [OFF, { REVIEW_REQUESTS: 'yes' }, { REVIEW_REQUESTS: 'true' }, { REVIEW_REQUESTS: '' }]) {
      const r = await sendRequests(store, SHOP, p.plan!, tenant, fastDeps(m, env as any));
      expect(r.refused).toMatch(/switched off/);
    }
    expect(m.send).not.toHaveBeenCalled();
    expect(reviewRequestsEnabled({ REVIEW_REQUESTS: ' ON ' })).toBe(true);
  });
  it('without the count, or with the wrong one, nothing is sent', async () => {
    for (const confirmCount of [undefined, '', '2', '0', 'yes', 'Example Floors']) {
      const { m, c } = ctx(ON);
      const out = await handleReviewRequestAction({ action: 'send', retailerId: SHOP.id, csv: 'a@example.invalid', confirmCount }, c);
      expect(out.status).toBe(409);
      expect(m.send).not.toHaveBeenCalled();
    }
  });
  it('a plan with nobody to send to cannot be confirmed', async () => {
    const p = await prepareRequests(memoryStore(), SHOP, 'nope', NOW);
    expect(confirmationMatches(p.plan!, '0')).toBe(false);
  });
  it('with the switch on and the right count, it sends, records hashes only, and reports', async () => {
    const { m, store, c } = ctx(ON);
    const out = await handleReviewRequestAction({ action: 'send', retailerId: SHOP.id, csv: 'a@example.invalid,Ann\nb@example.invalid', confirmCount: ' 2 ' }, c);
    expect(out.status).toBe(200);
    expect(out.body.result).toMatchObject({ sent: 2, failed: [], skipped: [], notReached: [] });
    expect(m.sent.map((e) => e.to)).toEqual(['a@example.invalid', 'b@example.invalid']);
    expect(store.rows.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(JSON.stringify(store.rows)).not.toContain('@');
    expect(Array.from(store.history.keys()).join()).not.toContain('@');
  });
  it('a failed send is recorded as failed and can be tried again', async () => {
    const store = memoryStore(); const m = stubMailer((e) => e.to !== 'b@example.invalid');
    const p = await prepareRequests(store, SHOP, 'a@example.invalid\nb@example.invalid', NOW);
    const r = await sendRequests(store, SHOP, p.plan!, tenant, fastDeps(m));
    expect(r.sent).toBe(1);
    expect(r.failed).toEqual([{ row: 2, email: 'b@example.invalid' }]);
    const again = await prepareRequests(store, SHOP, 'a@example.invalid\nb@example.invalid', NOW);
    expect(again.plan!.toSend.map((l) => l.email)).toEqual(['b@example.invalid']);
  });
  it('stops starting sends when its time is up, and says who was not reached', async () => {
    const store = memoryStore(); const m = stubMailer();
    const p = await prepareRequests(store, SHOP, csvOf(5), NOW);
    let t = NOW.getTime();
    const r = await sendRequests(store, SHOP, p.plan!, tenant, { send: m.send, sleep: async () => { t += 10_000; }, now: () => new Date(t), env: ON, gapMs: 1, budgetMs: 20_000 });
    expect(r.sent).toBe(2);
    expect(r.notReached.map((n) => n.row)).toEqual([3, 4, 5]);
  });
  it('waits between sends, so the mail provider is not flooded', async () => {
    const sleeps: number[] = []; const m = stubMailer();
    const store = memoryStore();
    const p = await prepareRequests(store, SHOP, csvOf(3), NOW);
    await sendRequests(store, SHOP, p.plan!, tenant, { send: m.send, sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW, env: ON });
    expect(sleeps).toEqual([600, 600]);
  });
});

describe('limits', () => {
  it(`at most ${MAX_PER_BATCH} in one send; the rest are listed, to send next`, () => {
    const plan = planRequests(parseRequestCsv(csvOf(MAX_PER_BATCH + 3)).rows, empty());
    expect(plan.toSend).toHaveLength(MAX_PER_BATCH);
    expect(plan.excluded.map((l) => l.reason)).toEqual(Array(3).fill(`over the limit of ${MAX_PER_BATCH} for one send: send the rest next`));
  });
  it(`at most ${MAX_PER_SHOP_PER_DAY} per shop in 24 hours`, async () => {
    const sent = Array.from({ length: MAX_PER_SHOP_PER_DAY - 2 }, () => ({ retailer_id: SHOP.id, created_at: '2026-11-21T08:00:00Z' }));
    const p = await prepareRequests(memoryStore({ sent }), SHOP, csvOf(5), NOW);
    expect(p.plan!.toSend).toHaveLength(2);
    expect(p.plan!.excluded[0].reason).toBe(`over this shop's limit of ${MAX_PER_SHOP_PER_DAY} in 24 hours`);
    expect(p.plan!.limits.shopLeftToday).toBe(0);
  });
  it('sends more than 24 hours ago do not count', async () => {
    const sent = Array.from({ length: MAX_PER_SHOP_PER_DAY }, () => ({ retailer_id: SHOP.id, created_at: '2026-11-20T11:59:00Z' }));
    const p = await prepareRequests(memoryStore({ sent }), SHOP, csvOf(3), NOW);
    expect(p.plan!.toSend).toHaveLength(3);
  });
  it(`at most ${MAX_PLATFORM_PER_DAY} for all shops together in 24 hours`, async () => {
    const sent = Array.from({ length: MAX_PLATFORM_PER_DAY - 1 }, (_, i) => ({ retailer_id: `shop-${i % 20}`, created_at: '2026-11-21T08:00:00Z' }));
    const p = await prepareRequests(memoryStore({ sent }), SHOP, csvOf(3), NOW);
    expect(p.plan!.toSend).toHaveLength(1);
    expect(p.plan!.excluded[0].reason).toBe(`over the limit of ${MAX_PLATFORM_PER_DAY} in 24 hours for all shops`);
  });
  it('are constants, not settings, and small', () => {
    expect([MAX_PER_BATCH, MAX_PER_SHOP_PER_DAY, MAX_PLATFORM_PER_DAY]).toEqual([25, 50, 300]);
    expect(src('./review-requests.ts')).not.toMatch(/process\.env\.(MAX|REVIEW_REQUEST_)/);
  });
});

describe('retention', () => {
  it('per-email rows go after 30 days, "already asked" after 365; the unsubscribe list is never cleared', async () => {
    const calls: Array<{ table: string; col: string; before: string }> = [];
    const db = { from: (table: string) => ({ delete: () => ({ lt: async (col: string, before: string) => { calls.push({ table, col, before }); return { error: null, count: 3 }; } }) }) };
    const r = await purgeReviewRequests(db, NOW);
    expect(r).toEqual({ ok: true, requestsDeleted: 3, historyDeleted: 3 });
    expect(calls).toEqual([
      { table: 'review_requests', col: 'created_at', before: '2026-10-22T12:00:00.000Z' },
      { table: 'review_request_history', col: 'first_asked_at', before: '2025-11-21T12:00:00.000Z' },
    ]);
    expect(REQUEST_ROW_DAYS).toBe(30);
    expect(retentionCutoffs(NOW).requestRowsBefore).toBe('2026-10-22T12:00:00.000Z');
  });
  it('never throws: a missing table is reported, and the job carries on', async () => {
    const db = { from: () => ({ delete: () => ({ lt: async () => ({ error: { message: 'relation does not exist' }, count: null }) }) }) };
    expect(await purgeReviewRequests(db, NOW)).toMatchObject({ ok: false, detail: 'relation does not exist' });
    const boom = { from: () => { throw new Error('down'); } };
    expect(await purgeReviewRequests(boom, NOW)).toMatchObject({ ok: false, detail: 'down' });
  });
  it('runs every day, from the daily onboarding job, before its own work', () => {
    const route = src('../app/api/cron/onboarding-sequence/route.ts');
    expect(route).toMatch(/purgeReviewRequests\(supabaseAdmin, new Date\(\)\)/);
    expect(route.indexOf('purgeReviewRequests(')).toBeLessThan(route.indexOf("from('users')"));
    expect(src('../netlify/functions/cron-onboarding-sequence.mts')).toMatch(/schedule: '0 10 \* \* \*'/);
  });
  it('the uploaded file is never stored: no table has an address column', () => {
    const sql = src('../supabase/migrations/20261121100000_review_requests.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\b(email|first_name|csv)\s+text/);
  });
});

describe('the wording', () => {
  const text = (firstName: string | null = null, h = hashEmail('a@example.invalid')) => requestText({ shopName: SHOP.name, town: SHOP.town, firstName, reviewLink: SHOP.reviewLink, unsubscribeUrl: unsubscribeUrl(tenant.appUrl, h), tenant });
  const GATING_OR_INCENTIVE = [
    /\bhappy\b/i, /\bunhappy\b/i, /\bsatisf/i, /\bpleased\b/i, /\benjoy/i, /\bpositive\b/i, /\bnegative\b/i, /\bgood\b/i, /\bgreat\b/i, /\bbad\b/i,
    /\bstars?\b/i, /5[- ]?star/i, /\bfive[- ]star/i, /\bif you (were|are|did|liked|loved)\b/i, /\bcontact us first\b/i, /\bbefore (you )?(leave|leaving|post)/i,
    /\bdiscount/i, /\bvoucher/i, /\bcoupon/i, /\bprize/i, /\bdraw\b/i, /\bwin\b/i, /\breward/i, /\bgift/i, /\bfree\b/i, /\bincentive/i, /\boffer/i, /\bcash\b/i, /\bmoney\b/i, /\bcompetition\b/i, /\b% off\b/i, /\bin return\b/i,
  ];
  it('has no gating and no incentive words, in the subject, the name or the body', () => {
    for (const s of [text(), text('Sam'), requestSubject(SHOP.name), requestFromName(SHOP.name, tenant)]) {
      for (const re of GATING_OR_INCENTIVE) expect(s, `${re}`).not.toMatch(re);
    }
  });
  it('asks for an honest review, whatever the experience, with the Google link', () => {
    const t = text();
    expect(t).toMatch(/honest review on Google, whatever your experience was/);
    expect(t).toContain(SHOP.reviewLink);
  });
  it('is the same for everyone apart from the greeting and their own unsubscribe link', () => {
    const strip = (s: string) => s.replace(/^Hello[^\n]*\n/, '').replace(/\?t=[0-9a-f.]+/, '?t=X');
    expect(strip(text('Sam', hashEmail('a@example.invalid')))).toBe(strip(text(null, hashEmail('b@example.invalid'))));
    expect(text('Sam')).toMatch(/^Hello Sam,\n/);
    expect(text(null)).toMatch(/^Hello,\n/);
    expect(text('<script>')).toMatch(/^Hello,\n/);
  });
  it('says who it is from and for, how replies work, and how to stop them, in plain text', () => {
    const t = text();
    expect(t).toMatch(/Sent on behalf of Example Floors, Exampleton, by Stellar Local \(/);
    expect(t).toMatch(/reply to this email and it will go to them/);
    expect(t).toMatch(/To stop review requests from every shop that uses Stellar Local:\nhttps:\/\/\S+\/api\/review-requests\/unsubscribe\?t=/);
    expect(t).not.toMatch(/<[a-z]/i);
    expect(t).toMatch(/single request\. You will not be sent reminders/);
  });
});

describe('From and Reply-To', () => {
  it('From is "<Shop> via Stellar Local" at Stellar Local\'s own address, never the shop\'s', () => {
    const e = composeRequest(SHOP, { email: 'a@example.invalid', firstName: null, hash: hashEmail('a@example.invalid') }, tenant);
    expect(e.fromName).toBe('Example Floors via Stellar Local');
    expect(fromWithName(tenant.emailFrom, e.fromName)).toBe('"Example Floors via Stellar Local" <hello@stellarlocal.co.uk>');
    expect(e.replyTo).toBe('owner@shop.example.com');
    expect(e.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(e.tenant.slug).toBe('stellar');
  });
  it('a shop name cannot break out of the display name or add a header', () => {
    expect(fromWithName('Stellar Local <hello@stellarlocal.co.uk>', 'Evil" <x@evil.example>\r\nBcc: y@evil.example')).toBe('"Evil x@evil.example Bcc: y@evil.example" <hello@stellarlocal.co.uk>');
    expect(fromWithName('hello@stellarlocal.co.uk', 'A Shop')).toBe('"A Shop" <hello@stellarlocal.co.uk>');
    expect(safeHeaders({ 'List-Unsubscribe': '<https://x>', 'Bad Header': 'x', 'X-Injected': 'a\r\nBcc: y' })).toEqual({ 'List-Unsubscribe': '<https://x>' });
  });
  describe('sendEmail carries them (fetch stubbed: nothing leaves)', () => {
    let calls: any[] = [];
    beforeEach(() => { calls = []; vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => { calls.push(JSON.parse(init.body)); return { ok: true, text: async () => '' }; })); });
    afterEach(() => { vi.unstubAllGlobals(); });
    it('From, Reply-To and the unsubscribe headers reach the provider', async () => {
      const e = composeRequest(SHOP, { email: 'a@example.invalid', firstName: 'Sam', hash: hashEmail('a@example.invalid') }, tenant);
      expect(await sendEmail(e)).toBe(true);
      expect(calls[0]).toMatchObject({ from: '"Example Floors via Stellar Local" <hello@stellarlocal.co.uk>', to: 'a@example.invalid', reply_to: 'owner@shop.example.com', subject: 'Would you review Example Floors on Google?', headers: e.headers });
      expect(calls[0].html).toBeUndefined();
    });
    it('every other email is unchanged: no reply_to, no headers, the usual From', async () => {
      await sendEmail({ to: 'a@example.invalid', subject: 's', text: 't', tenant });
      expect(calls[0]).toEqual({ from: tenant.emailFrom, to: 'a@example.invalid', subject: 's', text: 't' });
    });
  });
});

describe('which shops can send at all', () => {
  const db = (retailer: any, user: any) => ({ from: (t: string) => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: t === 'retailers' ? retailer : user, error: null }) };
    return q;
  } });
  const R = { id: SHOP.id, name: 'Example Floors', town: 'Exampleton', user_id: 'u1', delisted_at: null };
  const U = { id: 'u1', email: 'owner@shop.example.com', managed_by_user_id: null, profiles: [{ google_place_id: PLACE }] };
  it('a connected shop with its own address and listing', async () => {
    const r = await loadRequestShop(db(R, U), 'tenant-1', SHOP.id);
    expect(r).toEqual({ ok: true, shop: { ...SHOP } });
  });
  it('refused: set up through an operator account, so no address of its own for replies', async () => {
    const r = await loadRequestShop(db(R, { ...U, managed_by_user_id: 'op-1' }), 'tenant-1', SHOP.id);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/no address of its own/) });
  });
  it('refused: not connected, gone, no listing, not found', async () => {
    expect(await loadRequestShop(db({ ...R, user_id: null }, U), 't', SHOP.id)).toMatchObject({ ok: false, error: expect.stringMatching(/not connected/) });
    expect(await loadRequestShop(db({ ...R, delisted_at: '2026-01-01' }, U), 't', SHOP.id)).toMatchObject({ ok: false });
    expect(await loadRequestShop(db(R, { ...U, profiles: [] }), 't', SHOP.id)).toMatchObject({ ok: false, error: expect.stringMatching(/no Google place ID/) });
    expect(await loadRequestShop(db(null, U), 't', SHOP.id)).toMatchObject({ ok: false, error: 'Shop not found.' });
    expect(await loadRequestShop(db(R, U), 't', undefined)).toMatchObject({ ok: false });
  });
});

describe('the database change', () => {
  const sql = src('../supabase/migrations/20261121100000_review_requests.sql');
  it('adds three new tables, each with RLS on and the public roles revoked, and changes nothing else', () => {
    for (const t of ['review_requests', 'review_request_history', 'review_request_suppressions']) {
      expect(sql).toContain(`create table if not exists public.${t} (`);
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${t} from anon, authenticated;`);
    }
    const code = sql.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\balter table public\.(?!review_request)/);
    expect(code).not.toMatch(/\bdrop\b|\bupdate\s+public|\bdelete\s+from|create policy/i);
  });
});

describe('where it lives', () => {
  it('the pilot route still sends nothing; review requests have their own route', () => {
    expect(src('../app/api/admin/pilot/route.ts')).not.toMatch(/sendEmail|review-requests/);
    const route = src('../app/api/admin/review-requests/route.ts');
    expect(route).toMatch(/verifyAdminAuth\(/);
    expect(route).toMatch(/handleReviewRequestAction\(/);
  });
});
