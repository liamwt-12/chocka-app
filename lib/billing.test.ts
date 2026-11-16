import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { billingSettingsFromEnv, planLiveMarks, buildStatement, statementCsv, recordLiveToday, ukDay, monthOf, type LiveMonthRow } from './billing';

const row = (id: string, o: Partial<LiveMonthRow> = {}): LiveMonthRow => ({ month: '2026-12', retailer_id: id, tenant_id: 't', name: `Shop ${id}`, town: 'Town', live_days: 10, first_live_on: '2026-12-01', last_live_on: '2026-12-10', ...o });
const shop = (id: string, name = `Shop ${id}`) => ({ retailerId: id, tenantId: 't', name, town: 'Town' });

describe('settings: no price lives in the code', () => {
  it('unset means counts only, no cap, one day', () => {
    expect(billingSettingsFromEnv({})).toEqual({ pricePence: null, capShops: null, minLiveDays: 1 });
  });
  it('reads whole numbers and ignores nonsense', () => {
    expect(billingSettingsFromEnv({ BILLING_PRICE_PENCE_PER_SHOP: '1000', BILLING_MONTHLY_CAP_SHOPS: '80', BILLING_MIN_LIVE_DAYS: '7' })).toEqual({ pricePence: 1000, capShops: 80, minLiveDays: 7 });
    expect(billingSettingsFromEnv({ BILLING_PRICE_PENCE_PER_SHOP: '10.5', BILLING_MONTHLY_CAP_SHOPS: '-3', BILLING_MIN_LIVE_DAYS: '0' })).toEqual({ pricePence: null, capShops: null, minLiveDays: 1 });
  });
  it('the module itself contains no amount of money', () => {
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/£\s?\d|pricePence\s*[:=]\s*\d|1500/);
  });
});

describe('marking who is live today', () => {
  it('a first day makes a row; another day adds one; the same day twice adds nothing', () => {
    const d1 = planLiveMarks([shop('a')], [], '2026-12-01');
    expect(d1).toEqual([row('a', { live_days: 1, first_live_on: '2026-12-01', last_live_on: '2026-12-01' })]);
    const d2 = planLiveMarks([shop('a')], d1, '2026-12-02');
    expect(d2[0]).toMatchObject({ live_days: 2, first_live_on: '2026-12-01', last_live_on: '2026-12-02' });
    expect(planLiveMarks([shop('a')], d2, '2026-12-02')).toEqual([]);
  });
  it('a new month starts a new row and leaves last month alone', () => {
    const nov = [row('a', { month: '2026-11', live_days: 20, last_live_on: '2026-11-30' })];
    const dec = planLiveMarks([shop('a')], nov, '2026-12-01');
    expect(dec).toEqual([row('a', { month: '2026-12', live_days: 1, first_live_on: '2026-12-01', last_live_on: '2026-12-01' })]);
  });
  it('a shop that is not live today is simply not marked; a renamed shop takes its new name', () => {
    const existing = [row('a'), row('b')];
    const out = planLiveMarks([shop('a', 'New Name Floors')], existing, '2026-12-11');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ retailer_id: 'a', name: 'New Name Floors', live_days: 11 });
  });
  it('the day and the month are UK ones', () => {
    expect(ukDay(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01'); // already July in the UK in summer
    expect(ukDay(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
    expect(monthOf('2026-12-31')).toBe('2026-12');
  });
});

describe('the statement', () => {
  const rows = [
    row('c', { name: 'Carpets C', first_live_on: '2026-12-09' }),
    row('a', { name: 'Floors A', first_live_on: '2026-12-01' }),
    row('b', { name: 'Bare B', first_live_on: '2026-12-01' }),
    row('d', { name: 'Brief D', first_live_on: '2026-12-20', live_days: 2 }),
    row('z', { month: '2026-11', name: 'Last month only' }),
  ];

  it('lists the month\'s live shops by name, earliest first, then by name', () => {
    const s = buildStatement('2026-12', rows, { pricePence: null, capShops: null, minLiveDays: 1 });
    expect(s.lines.map((l) => l.name)).toEqual(['Bare B', 'Floors A', 'Carpets C', 'Brief D']);
    expect(s).toMatchObject({ liveShops: 4, shopsAboveCap: 0, billableShops: 4, money: null });
  });

  it('with a cap, the shops beyond it are still listed, and shown as a credit', () => {
    const s = buildStatement('2026-12', rows, { pricePence: 1000, capShops: 3, minLiveDays: 1 });
    expect(s.lines.filter((l) => l.aboveCap).map((l) => l.name)).toEqual(['Brief D']);
    expect(s).toMatchObject({ liveShops: 4, shopsAboveCap: 1, billableShops: 3 });
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 1000, totalPence: 3000 });
    expect(s.money!.grossPence - s.money!.creditPence).toBe(s.money!.totalPence);
  });

  it('under the cap there is no credit', () => {
    const s = buildStatement('2026-12', rows, { pricePence: 1000, capShops: 80, minLiveDays: 1 });
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 0, totalPence: 4000 });
  });

  it('a cap of nought charges nothing and credits everything', () => {
    expect(buildStatement('2026-12', rows, { pricePence: 1000, capShops: 0, minLiveDays: 1 }).money).toEqual({ grossPence: 4000, creditPence: 4000, totalPence: 0 });
  });

  it('a minimum number of days leaves short stays out of the count, but still shows them', () => {
    const s = buildStatement('2026-12', rows, { pricePence: 1000, capShops: null, minLiveDays: 7 });
    expect(s.liveShops).toBe(3);
    expect(s.notCounted.map((l) => l.name)).toEqual(['Brief D']);
  });

  it('an empty month is an empty statement, not an error', () => {
    expect(buildStatement('2025-01', rows, { pricePence: 1000, capShops: 5, minLiveDays: 1 })).toMatchObject({ liveShops: 0, lines: [], money: { grossPence: 0, creditPence: 0, totalPence: 0 } });
  });

  it('the spreadsheet adds up in the open, and a name cannot be read as a formula', () => {
    const csv = statementCsv(buildStatement('2026-12', [...rows, row('e', { name: '=HYPERLINK("x")', first_live_on: '2026-12-02' }), row('f', { name: 'Smith, Jones & Co', first_live_on: '2026-12-03' })], { pricePence: 1000, capShops: 3, minLiveDays: 1 }));
    expect(csv).toContain('Month,2026-12');
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"Smith, Jones & Co"');
    expect(csv).toContain('Live shops,6');
    expect(csv).toContain('Live shops x 10.00,60.00');
    expect(csv).toContain('Credit: 3 shops above the cap,-30.00');
    expect(csv).toContain('Total,30.00');
  });
});

describe('recordLiveToday', () => {
  const NOW = new Date('2026-12-05T10:00:00Z');
  function db(retailers: any[], users: any[], months: any[] = []) {
    const writes: any = { months: [], first: [] };
    return { writes, months, from: (t: string) => {
      const q: any = {
        select: () => q, not: () => q, eq: () => q, in: () => q, is: async () => ({ error: null }),
        update: (p: any) => { writes.first.push(p); return q; },
        upsert: async (rows: any[]) => { writes.months.push(...rows); for (const r of rows) { const i = months.findIndex((m) => m.month === r.month && m.retailer_id === r.retailer_id); if (i >= 0) months[i] = r; else months.push(r); } return { error: null }; },
        then: (res: any) => res({ data: t === 'retailers' ? retailers : t === 'users' ? users : months, error: null }),
      };
      return q;
    } };
  }
  const user = (id: string, o: any = {}) => ({ id, google_refresh_token: 'v1.x', token_status: 'valid', profiles: [{ google_location_name: 'locations/1' }], ...o });
  const retailer = (id: string, o: any = {}) => ({ id, tenant_id: 't', name: `Shop ${id}`, town: null, user_id: `u-${id}`, connection_status: 'connected', listing_confirmed_at: null, first_live_on: null, exclude_from_count: false, ...o });

  it('counts only shops that are live by the one definition', async () => {
    const d = db(
      [retailer('live'), retailer('wrong', { connection_status: 'check_listing' }), retailer('confirmed', { connection_status: 'check_listing', listing_confirmed_at: '2026-12-01' }), retailer('unverified', { connection_status: 'waiting_google' }), retailer('lost'), retailer('test', { exclude_from_count: true })],
      [user('u-live'), user('u-wrong'), user('u-confirmed'), user('u-unverified'), user('u-lost', { token_status: 'invalid' }), user('u-test')],
    );
    const r = await recordLiveToday(d, NOW);
    expect(r).toMatchObject({ live: 2, marked: 2, firstLive: 2 });
    expect(d.writes.months.map((m: any) => m.retailer_id).sort()).toEqual(['confirmed', 'live']);
    expect(d.writes.first[0]).toEqual({ first_live_on: '2026-12-05' });
  });

  it('a second run the same day writes nothing', async () => {
    const d = db([retailer('live')], [user('u-live')]);
    await recordLiveToday(d, NOW);
    const again = await recordLiveToday(d, new Date('2026-12-05T15:00:00Z'));
    expect(again).toMatchObject({ live: 1, marked: 0 });
    expect(d.months).toHaveLength(1);
    expect(d.months[0].live_days).toBe(1);
  });

  it('never throws: a failure is reported as null and the job it rides on carries on', async () => {
    const broken = { from: () => { throw new Error('db down'); } };
    expect(await recordLiveToday(broken as any, NOW)).toBeNull();
  });

  it('rides on the hourly job, before anything that could run out of time', () => {
    const src = readFileSync(new URL('../app/api/cron/metrics-sync/route.ts', import.meta.url), 'utf8');
    expect(src.indexOf('recordLiveToday(supabaseAdmin)')).toBeGreaterThan(0);
    expect(src.indexOf('recordLiveToday(supabaseAdmin)')).toBeLessThan(src.indexOf('for (const { user, profile } of queue)'));
  });
});
