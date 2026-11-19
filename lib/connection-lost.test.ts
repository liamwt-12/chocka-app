/**
 * The connection-lost email: off by default, once when access breaks, then at
 * most weekly, cleared on reconnect, only ever to the shop's own address.
 * Runs against a stand-in database that applies each query's own filters.
 * Nothing is sent: the sender is a spy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { connectionLostEmailsEnabled, connectionLostDue, runConnectionLostNotices, RESEND_DAYS, MAX_PER_RUN, CONNECTION_LOST_MIGRATION } from './connection-lost';
import { connectionLostNotice } from './shop-notices';
import { getTenantBySlug } from './tenant';
import { settingChecks, SCHEMA_PROBES } from './readiness';
import { emailPreview } from './email-previews';

const DAY = 86_400_000;
const NOW = new Date('2026-12-01T10:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

// ── A stand-in database ──
type Row = Record<string, any>;
let users: Row[] = [];
let failColumn = false;
const db = {
  from: (t: string) => {
    if (t !== 'users') throw new Error(`unexpected table ${t}`);
    const tests: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let cols = '';
    const run = () => {
      if (failColumn && (/connection_lost_notice_at/.test(cols) || (patch && 'connection_lost_notice_at' in patch))) return { data: null, error: { message: 'column users.connection_lost_notice_at does not exist' } };
      const hit = users.filter((r) => tests.every((f) => f(r)));
      if (patch) { for (const r of hit) Object.assign(r, patch); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q: any = {
      select: (c?: string) => { if (!patch) cols = c || ''; return q; },
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: any) => { tests.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { tests.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: any) => { tests.push((r) => (r[c] ?? null) !== v); return q; },
      in: (c: string, v: any[]) => { tests.push((r) => v.includes(r[c])); return q; },
      then: (res: any) => res(run()),
    };
    return q;
  },
};
const shop = (id: string, o: Row = {}): Row => ({ id, email: `${id}@shop.example`, managed_by_user_id: null, token_status: 'invalid', connection_lost_notice_at: null, tenants: { slug: 'stellar' }, retailers: [{ name: `Shop ${id}`, delisted_at: null }], profiles: [{ business_name: `Shop ${id}` }], ...o });
const sent: any[] = [];
const send = async (m: any) => { sent.push(m); return true; };
const pass = (enabled = true, now = NOW, extra: any = {}) => runConnectionLostNotices(db, { now, enabled, send, ...extra });
const marker = (id: string) => users.find((u) => u.id === id)!.connection_lost_notice_at;

let log: ReturnType<typeof vi.spyOn>, err: ReturnType<typeof vi.spyOn>;
beforeEach(() => { users = []; sent.length = 0; failColumn = false; log = vi.spyOn(console, 'log').mockImplementation(() => {}); err = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { log.mockRestore(); err.mockRestore(); });

describe('the switch', () => {
  it('is off unless CONNECTION_LOST_EMAILS is exactly "on"', () => {
    expect(connectionLostEmailsEnabled({})).toBe(false);
    for (const v of ['true', '1', 'yes', 'off', ' ']) expect(connectionLostEmailsEnabled({ CONNECTION_LOST_EMAILS: v })).toBe(false);
    expect(connectionLostEmailsEnabled({ CONNECTION_LOST_EMAILS: ' On ' })).toBe(true);
  });
  it('off: counts and logs what is due, sends nothing and writes nothing', async () => {
    users = [shop('a'), shop('b')];
    const r = await pass(false);
    expect(r).toMatchObject({ enabled: false, due: 2, sent: 0 });
    expect(sent).toHaveLength(0);
    expect(marker('a')).toBeNull();
    expect(log.mock.calls.flat().join(' ')).toMatch(/2 connection-lost email\(s\) due, NOT sent: CONNECTION_LOST_EMAILS is off/);
  });
  it('off with the migration not applied: still counts, and says to apply it', async () => {
    users = [shop('a')];
    failColumn = true;
    const r = await pass(false);
    expect(r).toMatchObject({ enabled: false, due: 1, sent: 0 });
    expect(log.mock.calls.flat().join(' ')).toContain(CONNECTION_LOST_MIGRATION);
  });
  it('on with the migration not applied: sends nothing, and says why', async () => {
    users = [shop('a')];
    failColumn = true;
    const r = await pass(true);
    expect(r.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(r.problem).toMatch(/NOTHING SENT.*20261121090000_connection_lost_notice_marker/);
  });
});

describe('when it is sent', () => {
  it('first time: one email, and the marker is set', async () => {
    users = [shop('a')];
    const r = await pass();
    expect(r).toMatchObject({ enabled: true, due: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@shop.example');
    expect(marker('a')).toBe(NOW.toISOString());
  });
  it('not again within the week, however often the job runs', async () => {
    users = [shop('a')];
    await pass();
    for (const h of [1, 24, 6 * 24, 7 * 24 - 1]) await pass(true, new Date(NOW.getTime() + h * 3_600_000));
    expect(sent).toHaveLength(1);
  });
  it('again once a week has passed', async () => {
    users = [shop('a', { connection_lost_notice_at: ago(RESEND_DAYS) })];
    expect((await pass()).sent).toBe(1);
    expect(marker('a')).toBe(NOW.toISOString());
    users = [shop('b', { connection_lost_notice_at: ago(RESEND_DAYS - 0.01) })];
    expect((await pass()).sent).toBe(0);
  });
  it('reconnecting clears the marker and stops it; a later break is told straight away', async () => {
    users = [shop('a', { connection_lost_notice_at: ago(1) })];
    users[0].token_status = 'valid';
    const r = await pass();
    expect(r.cleared).toBe(1);
    expect(marker('a')).toBeNull();
    expect(sent).toHaveLength(0);
    users[0].token_status = 'invalid';
    expect((await pass()).sent).toBe(1);
  });
  it('two runs at once send one email: the marker is claimed before sending', async () => {
    users = [shop('a')];
    await Promise.all([pass(), pass()]);
    expect(sent).toHaveLength(1);
  });
  it('stays inside its share of the job: a cap per run, and stops when time is up', async () => {
    users = Array.from({ length: MAX_PER_RUN + 5 }, (_, i) => shop(`s${i}`));
    expect((await pass()).sent).toBe(MAX_PER_RUN);
    sent.length = 0;
    users = [shop('x'), shop('y')];
    expect((await pass(true, NOW, { timeLeft: () => false })).sent).toBe(0);
  });
});

describe('who it goes to', () => {
  it('never an account made through an operator account', async () => {
    users = [shop('m', { managed_by_user_id: 'op-1' })];
    expect((await pass()).due).toBe(0);
    expect(sent).toHaveLength(0);
    expect(connectionLostDue(shop('m', { managed_by_user_id: 'op-1' }) as any, NOW)).toBe(false);
  });
  it('never an operator account itself (a rep), even with its own lost access', async () => {
    users = [shop('op'), shop('managed-shop', { managed_by_user_id: 'op', token_status: 'valid' })];
    const r = await pass();
    expect(r.due).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('never a shop we took off the list, an offboarded account, or one with no shop record', async () => {
    users = [shop('delisted', { retailers: [{ name: 'x', delisted_at: ago(3) }] }), shop('offboarded', { token_status: 'offboarded' }), shop('no-shop', { retailers: [] })];
    expect((await pass()).due).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('never a missing or malformed address', async () => {
    users = [shop('blank', { email: '' }), shop('bad', { email: 'not-an-address' })];
    expect((await pass()).due).toBe(0);
  });
  it('never a shop whose connection works', async () => {
    users = [shop('ok', { token_status: 'valid' })];
    expect((await pass()).due).toBe(0);
  });
  it('in the shop\'s own brand', async () => {
    users = [shop('c', { tenants: { slug: 'chocka' } }), shop('s')];
    await pass();
    const by = (to: string) => sent.find((m) => m.to === to);
    expect(by('c@shop.example').tenant.slug).toBe(getTenantBySlug('chocka').slug);
    expect(by('s@shop.example').tenant.slug).toBe('stellar');
    expect(by('s@shop.example').text).toContain(getTenantBySlug('stellar').brandName);
  });
});

describe('what it says', () => {
  const tenant = getTenantBySlug('stellar');
  const n = connectionLostNotice({ businessName: 'Bare Carpets', settingsUrl: 'https://app.example.test/settings', tenant });
  it('what happened, what is paused, what to do, signed', () => {
    expect(n.subject).toBe('Please reconnect Bare Carpets to Google');
    expect(n.text).toContain('Google has stopped letting us into the Google listing for Bare Carpets.');
    expect(n.text).toContain('after the password of the Google account is changed, or when someone removes us');
    expect(n.text).toContain('Until you reconnect, nothing is posted, no reviews are replied to, and nothing on your listing is changed.');
    expect(n.text).toContain('sign in, go to Settings and press Reconnect. Use the same Google account as before.');
    expect(n.text).toContain('https://app.example.test/settings');
    expect(n.text.trimEnd().endsWith(`${tenant.brandName}\n${tenant.supportEmail}`)).toBe(true);
  });
  it('is plain text, and is sent with no HTML part', async () => {
    expect(n.text).not.toMatch(/<[a-z!\/][^>]*>|style=|&nbsp;|&amp;/i);
    expect(n.subject).not.toMatch(/[\r\n<>]/);
    users = [shop('a')];
    await pass();
    expect(Object.keys(sent[0]).sort()).toEqual(['subject', 'tenant', 'text', 'to']);
  });
  it('a shop name cannot add a line to the subject or the text', () => {
    const bad = connectionLostNotice({ businessName: 'Bare\nBcc: x@evil.example', settingsUrl: 'https://app.example.test/settings', tenant });
    expect(bad.subject).toBe('Please reconnect Bare Bcc: x@evil.example to Google');
    expect(bad.text.split('\n').filter((l) => l.startsWith('https://'))).toEqual(['https://app.example.test/settings']);
  });
});

describe('where it is wired in', () => {
  it('runs from the hourly figures job, before the shops, inside the time budget', () => {
    const src = readFileSync(new URL('../app/api/cron/metrics-sync/route.ts', import.meta.url), 'utf8');
    expect(src.indexOf('runConnectionLostNotices(')).toBeGreaterThan(0);
    expect(src.indexOf('runConnectionLostNotices(')).toBeLessThan(src.indexOf('for (const { user, profile } of queue)'));
    expect(src).toMatch(/enabled: connectionLostEmailsEnabled\(\)/);
    expect(src).toMatch(/timeLeft: \(\) => Date\.now\(\) - started < TIME_BUDGET_MS \/ 3/);
  });
  it('the launch check shows On or Off, and probes the marker', () => {
    const line = (env: Record<string, string>) => settingChecks(env).find((c) => c.key === 'CONNECTION_LOST_EMAILS')!;
    expect(line({}).detail).toMatch(/^Off\./);
    expect(line({ CONNECTION_LOST_EMAILS: 'on' }).detail).toMatch(/^ON\./);
    expect(SCHEMA_PROBES.some((p) => p.migration === CONNECTION_LOST_MIGRATION && p.columns === 'connection_lost_notice_at')).toBe(true);
  });
  it('can be read in /admin/pilot with made-up content', () => {
    const e = emailPreview('connection_lost', getTenantBySlug('stellar'))!;
    expect(e.text).toContain('Example Flooring');
    expect(e.text).not.toMatch(/https?:\/\//);
  });
});
