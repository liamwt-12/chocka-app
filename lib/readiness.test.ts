import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { settingChecks, schemaChecks, dataChecks, summary, SCHEMA_PROBES } from './readiness';

const FULL = { SESSION_SECRET: 's'.repeat(32), SECRET_ENCRYPTION_KEY: 'k', CANCEL_HASH_SECRET: 'c', CRON_SECRET: 'x', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec', ANTHROPIC_API_KEY: 'a', STELLAR_APP_URL: 'https://app.example', ADMIN_PASSWORD: 'p'.repeat(24), RESEND_API_KEY: 'r', SESSION_ACCEPT_LEGACY_COOKIE: 'false', CRON_ACCEPT_QUERY_SECRET: 'false' };

describe('settings', () => {
  it('everything set: nothing to fix', () => {
    expect(summary(settingChecks(FULL))).toEqual({ ready: true, toFix: 0 });
  });
  it('each missing setting is named, with what breaks without it', () => {
    const checks = settingChecks({});
    const missing = checks.filter((c) => c.ok === false).map((c) => c.key);
    expect(missing).toEqual(expect.arrayContaining(['SESSION_SECRET', 'SECRET_ENCRYPTION_KEY', 'CANCEL_HASH_SECRET', 'CRON_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'STELLAR_APP_URL', 'ADMIN_PASSWORD', 'SESSION_ACCEPT_LEGACY_COOKIE']));
    expect(checks.find((c) => c.key === 'CRON_SECRET')!.detail).toMatch(/no post, reply, figure or daily check runs/);
  });
  it('NEVER reveals a value, only whether it is there', () => {
    const secretish = { ...FULL, SESSION_SECRET: 'TOPSECRET-session-value-123456789', ADMIN_PASSWORD: 'hunter2-hunter2-hunter2', CRON_SECRET: 'cron-value-xyz', GOOGLE_CLIENT_SECRET: 'google-secret-abc', BILLING_PRICE_PENCE_PER_SHOP: '4242', BILLING_MONTHLY_CAP_SHOPS: '77' };
    const text = JSON.stringify(settingChecks(secretish));
    for (const v of ['TOPSECRET', 'hunter2', 'cron-value', 'google-secret', '4242', '77']) expect(text).not.toContain(v);
    expect(text).toMatch(/Price per shop set; cap set/);
  });
  it('a short admin password is called out; the old cookie still being accepted is a thing to fix', () => {
    expect(settingChecks({ ...FULL, ADMIN_PASSWORD: 'short' }).find((c) => c.key === 'ADMIN_PASSWORD')).toMatchObject({ ok: false });
    expect(settingChecks({ ...FULL, SESSION_ACCEPT_LEGACY_COOKIE: undefined }).find((c) => c.key === 'SESSION_ACCEPT_LEGACY_COOKIE')).toMatchObject({ ok: false });
  });
  it('switches are shown for information, so nothing is on by surprise', () => {
    const on = settingChecks({ ...FULL, WELCOME_EMAIL: 'on', SHOP_PHOTOS: 'on', TARKETT_CONSOLE_ENABLED: 'on', LIVE_REQUIRES: 'access' });
    expect(on.find((c) => c.key === 'WELCOME_EMAIL')).toMatchObject({ ok: null, detail: expect.stringMatching(/^ON/) });
    expect(on.find((c) => c.key === 'TARKETT_CONSOLE_ENABLED')!.detail).toMatch(/privacy checklist/);
    expect(on.find((c) => c.key === 'LIVE_REQUIRES')!.detail).toMatch(/without matched, verified/);
    expect(summary(on).ready).toBe(true);
    expect(settingChecks(FULL).find((c) => c.key === 'WELCOME_EMAIL')!.detail).toMatch(/^Off/);
  });
});

describe('database', () => {
  it('a missing column names the migration to apply', async () => {
    const db = { from: (t: string) => ({ select: (cols: string) => ({ limit: async () => ({ error: t === 'live_months' || cols.includes('welcome_email_sent_at') ? { message: 'column does not exist' } : null }) }) }) };
    const checks = await schemaChecks(db);
    const bad = checks.filter((c) => c.ok === false);
    expect(bad.map((c) => c.detail)).toEqual(['Not in the database. Apply migration 20261117100000_welcome_email_marker.', 'Not in the database. Apply migration 20261117110000_ad_spend_and_live_months.']);
  });
  it('every migration this work adds is probed, and every probe names a migration that exists', () => {
    const files = readdirSync(new URL('../supabase/migrations', import.meta.url)).map((f) => f.replace(/\.sql$/, ''));
    for (const p of SCHEMA_PROBES) expect(files).toContain(p.migration);
    for (const mine of files.filter((f) => f >= '20261117')) expect(SCHEMA_PROBES.some((p) => p.migration === mine)).toBe(true);
  });
  it('the columns probed are really in the migration named', () => {
    for (const p of SCHEMA_PROBES.filter((x) => x.migration >= '20261117')) {
      const sql = readFileSync(new URL(`../supabase/migrations/${p.migration}.sql`, import.meta.url), 'utf8');
      for (const col of p.columns.split(',').map((c) => c.trim())) expect(sql).toContain(col);
    }
  });
});

describe('shops and jobs', () => {
  const NOW = new Date('2026-11-20T12:00:00Z');
  const db = (shops: any[], lastSync: string | null) => ({ from: (t: string) => {
    const q: any = { select: () => q, eq: () => q, not: () => q, order: () => q, limit: async () => ({ data: lastSync ? [{ metrics_synced_at: lastSync }] : [] }), then: (res: any) => res({ data: shops, error: null }) };
    return q;
  } });
  it('counts shops, and says how many have no expected listing', async () => {
    const c = await dataChecks(db([{ id: 1, place_id: 'x', user_id: 'u' }, { id: 2, place_id: null, user_id: null }, { id: 3, place_id: null, user_id: null, delisted_at: '2026-01-01' }], '2026-11-20T11:00:00Z'), 't', NOW);
    expect(c.find((x) => x.key === 'shops')!.detail).toBe('2 shops, 1 connected.');
    expect(c.find((x) => x.key === 'place_ids')!.detail).toMatch(/^1 shop has no expected listing/);
    expect(c.find((x) => x.key === 'jobs')).toMatchObject({ ok: true });
  });
  it('jobs that have stopped are a thing to fix; with no shop connected there is nothing to judge', async () => {
    expect((await dataChecks(db([{ id: 1, place_id: 'x', user_id: 'u' }], '2026-11-15T11:00:00Z'), 't', NOW)).find((x) => x.key === 'jobs')).toMatchObject({ ok: false });
    expect((await dataChecks(db([{ id: 1, place_id: 'x', user_id: 'u' }], null), 't', NOW)).find((x) => x.key === 'jobs')).toMatchObject({ ok: false });
    expect((await dataChecks(db([{ id: 1, place_id: 'x', user_id: null }], null), 't', NOW)).find((x) => x.key === 'jobs')).toMatchObject({ ok: null });
  });
});
