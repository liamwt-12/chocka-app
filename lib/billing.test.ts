import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { billingSettingsFromEnv, planLiveMarks, buildStatement, statementCsv, recordLiveToday, ukDay, monthOf, countsForMonth, lastDayOfMonth, capForMonth, termProblem, loadStatement, StatementNotAvailable, type LiveMonthRow } from './billing';

const row = (id: string, o: Partial<LiveMonthRow> = {}): LiveMonthRow => ({ month: '2026-12', retailer_id: id, tenant_id: 't', name: `Shop ${id}`, town: 'Town', live_days: 10, first_live_on: '2026-12-01', last_live_on: '2026-12-10', ...o });
const shop = (id: string, name = `Shop ${id}`) => ({ retailerId: id, tenantId: 't', name, town: 'Town' });

describe('settings: no price and no cap lives in the code', () => {
  it('unset means counts only and no cap', () => {
    expect(billingSettingsFromEnv({})).toEqual({ pricePence: null, capPence: null, termStart: null, termEnd: null });
  });
  it('reads whole pence and ignores nonsense', () => {
    expect(billingSettingsFromEnv({ BILLING_PRICE_PENCE_PER_SHOP: '1000', BILLING_MONTHLY_CAP_PENCE: '25000' })).toMatchObject({ pricePence: 1000, capPence: 25000 });
    expect(billingSettingsFromEnv({ BILLING_PRICE_PENCE_PER_SHOP: '10.5', BILLING_MONTHLY_CAP_PENCE: '-3' })).toMatchObject({ pricePence: null, capPence: null });
  });
  it('the module itself contains no amount of money: both are settings with no default', () => {
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/£\s?\d|pricePence\s*[:=]\s*\d|capPence\s*[:=]\s*\d/);
    // Neither setting has a fallback value: unset means unset.
    expect(src).toMatch(/pricePence: wholeNumber\(env\.BILLING_PRICE_PENCE_PER_SHOP, \d\)/);
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
  // A term that December 2026 falls inside, so the cap is in force for these.
  const TERM = { termStart: '2020-01-01', termEnd: '2039-12-31' };
  const st = (settings: any, today = AFTER) => buildStatement('2026-12', rows, { ...TERM, ...settings }, today);

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

  it('a month where no count was taken on the last day says so, instead of showing nobody live', () => {
    const missed = [row('a', { name: 'Floors A', last_live_on: '2026-12-30' }), row('b', { name: 'Bare B', last_live_on: '2026-12-30' })];
    const s = buildStatement('2026-12', missed, { pricePence: 1000, capPence: null }, AFTER);
    expect(s).toMatchObject({ liveShops: 0, noCountOnLastDay: true });
    expect(statementCsv(s).split('\n')[0]).toMatch(/^"?WARNING: no count was taken on the last day/);
    expect(st({ pricePence: 1000, capPence: null }).noCountOnLastDay).toBe(false);
    expect(buildStatement('2025-01', rows, { pricePence: null, capPence: null }, AFTER).noCountOnLastDay).toBe(false); // an empty month is just empty
    expect(buildStatement('2026-12', missed, { pricePence: null, capPence: null }, '2026-12-31').noCountOnLastDay).toBe(false); // still in progress
  });

  it('an empty month is an empty statement, not an error', () => {
    expect(buildStatement('2025-01', rows, { pricePence: 1000, capPence: 500, ...TERM }, AFTER)).toMatchObject({ liveShops: 0, lines: [], money: { grossPence: 0, creditPence: 0, totalPence: 0 } });
  });

  it('the spreadsheet adds up in the open, and a name cannot be read as a formula', () => {
    const csv = statementCsv(buildStatement('2026-12', [...rows, row('f', { name: '=HYPERLINK("x")', first_live_on: '2026-12-02', last_live_on: '2026-12-31' }), row('g', { name: 'Smith, Jones & Co', first_live_on: '2026-12-03', last_live_on: '2026-12-31' })], { pricePence: 1000, capPence: 2500, ...TERM }, AFTER));
    expect(csv).toContain('Month,2026-12');
    expect(csv).toContain('Shops live on the last day of the month,2026-12-31');
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"Smith, Jones & Co"');
    expect(csv).toContain('Live shops,6');
    expect(csv).toContain('Live shops x 10.00,60.00');
    expect(csv).toContain('Monthly cap,25.00');
    expect(csv).toContain('The cap applies for the term,2020-01-01 to 2039-12-31');
    expect(csv).toContain('Credit: above the monthly cap (4 shops),-35.00');
    expect(csv).toContain('Total,25.00');
    expect(csv).toContain('Not counted: live during the month, not on its last day');
  });
});

describe('the cap belongs to a term, and stops applying after it', () => {
  // Every date and amount here is made up, and far from any real one on purpose.
  const rows = ['a', 'b', 'c', 'd'].map((id) => row(id, { month: '2030-06', first_live_on: '2030-06-01', last_live_on: '2030-06-30' }));
  const march = ['a', 'b', 'c', 'd'].map((id) => row(id, { month: '2030-11', first_live_on: '2030-11-01', last_live_on: '2030-11-30' }));
  const S = { pricePence: 1000, capPence: 2500, termStart: '2030-02-10', termEnd: '2030-11-09' };

  it('the settings are two days, with no defaults; nonsense is treated as not set', () => {
    expect(billingSettingsFromEnv({ BILLING_TERM_START: '2030-02-10', BILLING_TERM_END: ' 2030-11-09 ' })).toMatchObject({ termStart: '2030-02-10', termEnd: '2030-11-09' });
    for (const bad of ['', '10/12/2026', '2030-02', '2030-02-30', 'soon', '2026-13-01']) expect(billingSettingsFromEnv({ BILLING_TERM_START: bad, BILLING_TERM_END: bad })).toMatchObject({ termStart: null, termEnd: null });
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/termStart: dayOrNull\(env\.BILLING_TERM_START\)/);
    expect(src).toMatch(/termEnd: dayOrNull\(env\.BILLING_TERM_END\)/);
    // No date is written in the code, in a default or anywhere else outside comments.
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('a month counts as inside the term if its last day is: the same day that decides who is live', () => {
    expect(capForMonth(S, '2030-01')).toMatchObject({ applies: false, reason: 'before_term' });
    expect(capForMonth(S, '2030-02')).toMatchObject({ applies: true, reason: 'in_term', note: null });  // ends 28 Feb, inside
    expect(capForMonth(S, '2030-06').applies).toBe(true);
    expect(capForMonth(S, '2030-10').applies).toBe(true);
    expect(capForMonth(S, '2030-11')).toMatchObject({ applies: false, reason: 'after_term' });          // ends 30 Nov, after 9 Nov
    // A term that ends on a month's last day includes that month.
    expect(capForMonth({ ...S, termEnd: '2030-11-30' }, '2030-11').applies).toBe(true);
    expect(capForMonth({ ...S, termEnd: '2030-11-29' }, '2030-11').applies).toBe(false);
  });

  it('inside the term: capped, with the credit line', () => {
    const s = buildStatement('2030-06', rows, S, '2030-07-05');
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 1500, totalPence: 2500 });
    expect(s).toMatchObject({ shopsAboveCap: 2, cap: { applies: true } });
    expect(statementCsv(s)).toContain('Credit: above the monthly cap (2 shops),-15.00');
  });

  it('after the term: no cap, no credit line, no shop marked as above it, and it says the term has ended', () => {
    const s = buildStatement('2030-11', march, S, '2030-12-05');
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 0, totalPence: 4000 });
    expect(s.shopsAboveCap).toBe(0);
    expect(s.lines.some((l) => l.aboveCap)).toBe(false);
    expect(s.cap).toMatchObject({ applies: false, reason: 'after_term' });
    const csv = statementCsv(s);
    expect(csv).not.toMatch(/Credit: above the monthly cap|^Monthly cap,/m);
    expect(csv).toContain('The monthly cap is not applied: the term ended on 2030-11-09');
    expect(csv).toContain('Total,40.00');
  });

  it('a cap with no term dates is NOT applied, and the statement says so loudly', () => {
    for (const dates of [{}, { termStart: '2030-02-10' }, { termEnd: '2030-11-09' }, { termStart: null, termEnd: null }]) {
      const s = buildStatement('2030-06', rows, { pricePence: 1000, capPence: 2500, ...dates }, '2030-07-05');
      expect(s.money).toEqual({ grossPence: 4000, creditPence: 0, totalPence: 4000 });
      expect(s.cap).toMatchObject({ applies: false, reason: 'no_term' });
      expect(statementCsv(s)).toContain('the cap has NOT been applied');
    }
  });

  it('a term that ends before it starts is not a term', () => {
    const s = buildStatement('2030-06', rows, { ...S, termStart: '2030-11-09', termEnd: '2030-02-10' }, '2030-07-05');
    expect(s.cap).toMatchObject({ applies: false, reason: 'bad_term' });
    expect(s.money!.creditPence).toBe(0);
  });

  it('with no cap set, term dates change nothing and nothing is said', () => {
    const s = buildStatement('2030-06', rows, { pricePence: 1000, capPence: null, termStart: '2030-02-10', termEnd: '2030-11-09' }, '2030-07-05');
    expect(s.cap).toEqual({ applies: false, reason: 'no_cap', note: null });
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 0, totalPence: 4000 });
  });

  it('nothing else decides whether the cap applies', () => {
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src.match(/capForMonth\(settings, month\)/g)).toHaveLength(1);
    expect(src).toMatch(/const capPence = cap\.applies \? settings\.capPence : null;/);
  });
});

describe('no statement until the term is set', () => {
  const T = { pricePence: 1000, capPence: null };
  it('both dates, real days, in order: or there is no statement, and it says which is missing', () => {
    expect(termProblem({ ...T })).toMatch(/until the term is set: BILLING_TERM_START and BILLING_TERM_END/);
    expect(termProblem({ ...T, termStart: '2030-02-10' })).toMatch(/BILLING_TERM_END is missing, or is not a real day/);
    expect(termProblem({ ...T, termEnd: '2030-11-09' })).toMatch(/BILLING_TERM_START is missing/);
    expect(termProblem({ ...T, termStart: '2030-02-10', termEnd: '2030-02-30' })).toMatch(/BILLING_TERM_END is missing, or is not a real day/);
    expect(termProblem({ ...T, termStart: '2030-11-09', termEnd: '2030-02-10' })).toMatch(/ends before it starts/);
    expect(termProblem({ ...T, termStart: '2030-02-10', termEnd: '2030-11-09' })).toBeNull();
  });
  it('applies whether or not a cap is set, and nothing reads the database first', async () => {
    let read = false;
    const db = { from: () => { read = true; return {}; } } as any;
    await expect(loadStatement(db, 't', '2030-06', { pricePence: null, capPence: null })).rejects.toBeInstanceOf(StatementNotAvailable);
    await expect(loadStatement(db, 't', '2030-06', { pricePence: 1000, capPence: 2500, termStart: '2030-02-10' })).rejects.toThrow(/BILLING_TERM_END/);
    expect(read).toBe(false);
  });
  it('the admin page is told so plainly, before anything is loaded; there is no default term anywhere', () => {
    const route = readFileSync(new URL('../app/api/admin/pilot/route.ts', import.meta.url), 'utf8');
    expect(route).toMatch(/const notYet = termProblem\(billingSettingsFromEnv\(\)\);\s+if \(notYet\) return NextResponse\.json\(\{ error: notYet, notAvailable: true \}, \{ status: 409 \}\);\s+const statement = await loadStatement/);
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/termStart: dayOrNull\(env\.BILLING_TERM_START\),\s+termEnd: dayOrNull\(env\.BILLING_TERM_END\),/);
  });
});

describe('recordLiveToday', () => {
  const NOW = new Date('2026-12-05T10:00:00Z');
  function db(retailers: any[], users: any[], months: any[] = []) {
    const writes: any = { months: [], first: [] };
    return { writes, months, from: (t: string) => {
      const q: any = {
        select: () => q, not: () => q, eq: () => q, in: () => q, is: () => q,
        update: (p: any) => { writes.first.push(p); return q; },
        upsert: async (rows: any[]) => { writes.months.push(...rows); for (const r of rows) { const i = months.findIndex((m) => m.month === r.month && m.retailer_id === r.retailer_id); if (i >= 0) months[i] = r; else months.push(r); } return { error: null }; },
        then: (res: any) => res({ data: t === 'retailers' ? retailers : t === 'users' ? users : months, error: null }),
      };
      return q;
    } };
  }
  const user = (id: string, o: any = {}) => ({ id, google_refresh_token: 'v1.x', token_status: 'valid', auto_post_enabled: true, auto_reply_enabled: false, profiles: [{ google_location_name: 'locations/1' }], ...o });
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

  it('a shop with nothing switched on, or paused, IS counted: billable is connected, verified and reachable, whatever is switched on', async () => {
    const d = db(
      [retailer('posts'), retailer('nothing'), retailer('paused'), retailer('lost'), retailer('unverified', { connection_status: 'waiting_google' })],
      [user('u-posts'), user('u-nothing', { auto_post_enabled: false, auto_reply_enabled: false }), user('u-paused', { automation_paused_at: '2026-12-04T09:00:00Z' }), user('u-lost', { token_status: 'invalid', auto_post_enabled: true }), user('u-unverified')],
    );
    const r = await recordLiveToday(d, NOW);
    expect(r).toMatchObject({ live: 3, marked: 3 });
    expect(d.writes.months.map((m: any) => m.retailer_id).sort()).toEqual(['nothing', 'paused', 'posts']);
  });
  it('the statement file says what live means', () => {
    expect(statementCsv(buildStatement('2026-12', [], { pricePence: null, capPence: null }, '2027-01-05'))).toContain('Live means connected to a verified listing we can reach. It does not depend on what the shop has switched on.');
  });
  it('reads the switches with the account, so the count cannot be made without them', () => {
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/managed_by_user_id, \$\{STATUS_USER_COLUMNS\}/);
    // One definition: the count asks shopStatus and nothing else.
    expect(src.match(/shopStatus\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/auto_post_enabled|auto_reply_enabled/);
  });

  it('does not count a shop that is no longer on the funder\'s list', () => {
    expect(readFileSync(new URL('./billing.ts', import.meta.url), 'utf8')).toMatch(/\.not\('user_id', 'is', null\)[\s\S]{0,120}\.is\('delisted_at', null\)/);
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
