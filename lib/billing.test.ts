import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { billingSettingsFromEnv, planLiveMarks, buildStatement, statementCsv, recordLiveToday, ukDay, monthOf, countsForMonth, lastDayOfMonth, type LiveMonthRow } from './billing';

const row = (id: string, o: Partial<LiveMonthRow> = {}): LiveMonthRow => ({ month: '2026-12', retailer_id: id, tenant_id: 't', name: `Shop ${id}`, town: 'Town', live_days: 10, first_live_on: '2026-12-01', last_live_on: '2026-12-10', ...o });
const shop = (id: string, name = `Shop ${id}`) => ({ retailerId: id, tenantId: 't', name, town: 'Town' });

describe('settings: no price and no cap lives in the code', () => {
  it('unset means counts only and no cap', () => {
    expect(billingSettingsFromEnv({})).toEqual({ pricePence: null, capPence: null });
  });
  it('reads whole pence and ignores nonsense', () => {
    expect(billingSettingsFromEnv({ BILLING_PRICE_PENCE_PER_SHOP: '1000', BILLING_MONTHLY_CAP_PENCE: '25000' })).toEqual({ pricePence: 1000, capPence: 25000 });
    expect(billingSettingsFromEnv({ BILLING_PRICE_PENCE_PER_SHOP: '10.5', BILLING_MONTHLY_CAP_PENCE: '-3' })).toEqual({ pricePence: null, capPence: null });
  });
  it('the module itself contains no amount of money: both are settings with no default', () => {
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/£\s?\d|pricePence\s*[:=]\s*\d|capPence\s*[:=]\s*\d|\b1500\b|\b120000\b|\b1200\b/);
    expect(src).toMatch(/capPence: wholeNumber\(env\.BILLING_MONTHLY_CAP_PENCE, 0\)/);
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

describe('who counts for a month: live on its last day, decided in one place', () => {
  const r = (last: string, month = '2026-12') => ({ month, last_live_on: last });
  it('a month that has ended: only a shop live on the last day', () => {
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31');
    expect(lastDayOfMonth('2027-02')).toBe('2027-02-28');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(countsForMonth(r('2026-12-31'), '2026-12', '2027-01-05')).toBe(true);
    expect(countsForMonth(r('2026-12-30'), '2026-12', '2027-01-05')).toBe(false); // live for 30 days, lost it on the last
    expect(countsForMonth(r('2026-12-31'), '2026-11', '2027-01-05')).toBe(false); // another month's row
  });
  it('the month in progress: live now (today, or yesterday if today has not been marked yet)', () => {
    expect(countsForMonth(r('2026-12-10'), '2026-12', '2026-12-10')).toBe(true);
    expect(countsForMonth(r('2026-12-09'), '2026-12', '2026-12-10')).toBe(true);
    expect(countsForMonth(r('2026-12-08'), '2026-12', '2026-12-10')).toBe(false);
  });
  it('a month that has not begun: nobody', () => {
    expect(countsForMonth(r('2027-01-01', '2027-01'), '2027-01', '2026-12-10')).toBe(false);
  });
  it('nothing else in the code decides it', () => {
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src.match(/countsForMonth\(r, month, today\)/g)).toHaveLength(2); // counted, and its complement
    expect(src).not.toMatch(/minLiveDays|live_days >=/);
  });
});

describe('the statement', () => {
  const AFTER = '2027-01-05'; // December has ended
  const rows = [
    row('c', { name: 'Carpets C', first_live_on: '2026-12-09', last_live_on: '2026-12-31' }),
    row('a', { name: 'Floors A', first_live_on: '2026-12-01', last_live_on: '2026-12-31' }),
    row('b', { name: 'Bare B', first_live_on: '2026-12-01', last_live_on: '2026-12-31' }),
    row('d', { name: 'Late D', first_live_on: '2026-12-31', last_live_on: '2026-12-31', live_days: 1 }),
    row('e', { name: 'Left E', first_live_on: '2026-12-01', last_live_on: '2026-12-20', live_days: 20 }),
    row('z', { month: '2026-11', name: 'Last month only', last_live_on: '2026-11-30' }),
  ];
  const st = (settings: any, today = AFTER) => buildStatement('2026-12', rows, settings, today);

  it('lists the shops live on the last day by name, earliest first; a shop that left is shown but not counted', () => {
    const s = st({ pricePence: null, capPence: null });
    expect(s.lines.map((l) => l.name)).toEqual(['Bare B', 'Floors A', 'Carpets C', 'Late D']);
    expect(s.notCounted.map((l) => l.name)).toEqual(['Left E']);
    expect(s).toMatchObject({ liveShops: 4, shopsAboveCap: 0, money: null, provisional: false, decidedOn: '2026-12-31' });
  });

  it('with a cap in money, every shop is still listed and priced, and the excess is one credit line', () => {
    const s = st({ pricePence: 1000, capPence: 2500 });
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 1500, totalPence: 2500 });
    expect(s.money!.grossPence - s.money!.creditPence).toBe(s.money!.totalPence);
    // Two shops fit wholly inside the cap; the other two are marked.
    expect(s.lines.filter((l) => l.aboveCap).map((l) => l.name)).toEqual(['Carpets C', 'Late D']);
    expect(s.shopsAboveCap).toBe(2);
  });

  it('under the cap, or with no cap, there is no credit', () => {
    expect(st({ pricePence: 1000, capPence: 9000 }).money).toEqual({ grossPence: 4000, creditPence: 0, totalPence: 4000 });
    expect(st({ pricePence: 1000, capPence: null }).money).toEqual({ grossPence: 4000, creditPence: 0, totalPence: 4000 });
    expect(st({ pricePence: 1000, capPence: 4000 })).toMatchObject({ shopsAboveCap: 0, money: { creditPence: 0 } });
  });

  it('a cap of nought charges nothing and credits everything', () => {
    expect(st({ pricePence: 1000, capPence: 0 }).money).toEqual({ grossPence: 4000, creditPence: 4000, totalPence: 0 });
  });

  it('the month in progress is provisional: who is live now', () => {
    const now = [row('a', { name: 'Floors A', last_live_on: '2026-12-20' }), row('b', { name: 'Bare B', last_live_on: '2026-12-19' }), row('e', { name: 'Left E', last_live_on: '2026-12-12' })];
    const s = buildStatement('2026-12', now, { pricePence: 1000, capPence: null }, '2026-12-20');
    expect(s).toMatchObject({ provisional: true, decidedOn: '2026-12-20', liveShops: 2 });
    expect(s.notCounted.map((l) => l.name)).toEqual(['Left E']);
    expect(statementCsv(s)).toContain('Provisional: shops live now,2026-12-20');
  });

  it('an empty month is an empty statement, not an error', () => {
    expect(buildStatement('2025-01', rows, { pricePence: 1000, capPence: 500 }, AFTER)).toMatchObject({ liveShops: 0, lines: [], money: { grossPence: 0, creditPence: 0, totalPence: 0 } });
  });

  it('the spreadsheet adds up in the open, and a name cannot be read as a formula', () => {
    const csv = statementCsv(buildStatement('2026-12', [...rows, row('f', { name: '=HYPERLINK("x")', first_live_on: '2026-12-02', last_live_on: '2026-12-31' }), row('g', { name: 'Smith, Jones & Co', first_live_on: '2026-12-03', last_live_on: '2026-12-31' })], { pricePence: 1000, capPence: 2500 }, AFTER));
    expect(csv).toContain('Month,2026-12');
    expect(csv).toContain('Shops live on the last day of the month,2026-12-31');
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"Smith, Jones & Co"');
    expect(csv).toContain('Live shops,6');
    expect(csv).toContain('Live shops x 10.00,60.00');
    expect(csv).toContain('Monthly cap,25.00');
    expect(csv).toContain('Credit: above the monthly cap (4 shops),-35.00');
    expect(csv).toContain('Total,25.00');
    expect(csv).toContain('Not counted: live during the month, not on its last day');
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
