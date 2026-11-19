import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { billingSettingsFromEnv, planLiveMarks, buildStatement, statementCsv, recordLiveToday, ukDay, monthOf, countsForMonth, lastDayOfMonth, capForMonth, termProblem, loadStatement, StatementNotAvailable, type LiveMonthRow } from './billing';

const row = (id: string, o: Partial<LiveMonthRow> = {}): LiveMonthRow => ({ month: '2026-12', retailer_id: id, tenant_id: 't', name: `Shop ${id}`, town: 'Town', live_days: 10, first_live_on: '2026-12-01', last_live_on: '2026-12-10', ...o });
const shop = (id: string, name = `Shop ${id}`) => ({ retailerId: id, tenantId: 't', name, town: 'Town' });

describe('settings: no price and no cap lives in the code', () => {
  it('unset means counts only and no cap', () => {
    expect(billingSettingsFromEnv({})).toEqual({ pricePence: null, capPence: null, termStart: null, termEnd: null, totalCeilingPence: null, totalCeilingInvalid: false });
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
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 1500, ceilingCreditPence: 0, totalPence: 2500 });
    expect(s.money!.grossPence - s.money!.creditPence).toBe(s.money!.totalPence);
    // Two shops fit wholly inside the cap; the other two are marked.
    expect(s.lines.filter((l) => l.aboveCap).map((l) => l.name)).toEqual(['Carpets C', 'Late D']);
    expect(s.shopsAboveCap).toBe(2);
  });

  it('under the cap, or with no cap, there is no credit', () => {
    expect(st({ pricePence: 1000, capPence: 9000 }).money).toEqual({ grossPence: 4000, creditPence: 0, ceilingCreditPence: 0, totalPence: 4000 });
    expect(st({ pricePence: 1000, capPence: null }).money).toEqual({ grossPence: 4000, creditPence: 0, ceilingCreditPence: 0, totalPence: 4000 });
    expect(st({ pricePence: 1000, capPence: 4000 })).toMatchObject({ shopsAboveCap: 0, money: { creditPence: 0 } });
  });

  it('a cap of nought charges nothing and credits everything', () => {
    expect(st({ pricePence: 1000, capPence: 0 }).money).toEqual({ grossPence: 4000, creditPence: 4000, ceilingCreditPence: 0, totalPence: 0 });
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
    expect(buildStatement('2025-01', rows, { pricePence: 1000, capPence: 500, ...TERM }, AFTER)).toMatchObject({ liveShops: 0, lines: [], money: { grossPence: 0, creditPence: 0, ceilingCreditPence: 0, totalPence: 0 } });
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
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 1500, ceilingCreditPence: 0, totalPence: 2500 });
    expect(s).toMatchObject({ shopsAboveCap: 2, cap: { applies: true } });
    expect(statementCsv(s)).toContain('Credit: above the monthly cap (2 shops),-15.00');
  });

  it('after the term: no cap, no credit line, no shop marked as above it, and it says the term has ended', () => {
    const s = buildStatement('2030-11', march, S, '2030-12-05');
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 0, ceilingCreditPence: 0, totalPence: 4000 });
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
      expect(s.money).toEqual({ grossPence: 4000, creditPence: 0, ceilingCreditPence: 0, totalPence: 4000 });
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
    expect(s.money).toEqual({ grossPence: 4000, creditPence: 0, ceilingCreditPence: 0, totalPence: 4000 });
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

describe('a total ceiling for the term', () => {
  // Every amount and date here is made up, and far from any real one on purpose.
  const PRICE = 777;
  const TERM = { termStart: '2031-01-15', termEnd: '2031-12-31' };
  /** Shops live on the last day of each month given. */
  const liveIn = (months: string[], ids = ['a', 'b', 'c']) => months.flatMap((m) => ids.map((id) => row(id, { month: m, name: `Shop ${id}`, first_live_on: `${m}-01`, last_live_on: lastDayOfMonth(m) })));
  const ROWS = liveIn(['2031-01', '2031-02', '2031-03', '2031-04', '2031-05', '2031-06', '2031-07']);
  const LATER = '2031-08-10';
  const S = (o: any = {}) => ({ pricePence: PRICE, capPence: null, ...TERM, totalCeilingPence: null, ...o });
  const st = (month: string, o: any = {}, rows = ROWS, today = LATER) => buildStatement(month, rows, S(o), today);
  const adds = (s: ReturnType<typeof buildStatement>) => expect(s.money!.grossPence - s.money!.creditPence - s.money!.ceilingCreditPence).toBe(s.money!.totalPence);

  describe('the setting', () => {
    it('is whole pence above nought, with no default: unset is no ceiling', () => {
      expect(billingSettingsFromEnv({})).toMatchObject({ totalCeilingPence: null, totalCeilingInvalid: false });
      expect(billingSettingsFromEnv({ BILLING_TOTAL_CEILING_PENCE: '' })).toMatchObject({ totalCeilingPence: null, totalCeilingInvalid: false });
      expect(billingSettingsFromEnv({ BILLING_TOTAL_CEILING_PENCE: ' 12345 ' })).toMatchObject({ totalCeilingPence: 12345, totalCeilingInvalid: false });
      const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
      expect(src).toMatch(/totalCeilingPence: wholeNumber\(env\.BILLING_TOTAL_CEILING_PENCE, 1\),/);
    });
    it('anything else is not quietly "no ceiling": it is marked invalid and there is no statement', () => {
      for (const bad of ['12.5', '-5', '0', 'abc', '1e3', '0x10', '£123']) {
        const s = billingSettingsFromEnv({ BILLING_TOTAL_CEILING_PENCE: bad, BILLING_TERM_START: TERM.termStart, BILLING_TERM_END: TERM.termEnd });
        expect(s).toMatchObject({ totalCeilingPence: null, totalCeilingInvalid: true });
        expect(termProblem(s)).toBe('No statement can be produced: BILLING_TOTAL_CEILING_PENCE is set but is not a whole number of pence above nought. Correct it, or remove it.');
        expect(() => buildStatement('2031-03', ROWS, s, LATER)).toThrow(StatementNotAvailable);
      }
    });
  });

  describe('set without the term: no statement', () => {
    it('says the ceiling needs the term, and the partial cases name the missing date', () => {
      expect(termProblem({ pricePence: PRICE, capPence: null, totalCeilingPence: 12345 })).toBe('No statement can be produced: a total ceiling is set (BILLING_TOTAL_CEILING_PENCE) but the term it belongs to is not. Set BILLING_TERM_START and BILLING_TERM_END, each a day written YYYY-MM-DD.');
      expect(termProblem({ pricePence: PRICE, capPence: null, totalCeilingPence: 12345, termStart: '2031-01-15' })).toMatch(/BILLING_TERM_END is missing/);
      expect(termProblem({ pricePence: PRICE, capPence: null, totalCeilingPence: 12345, termStart: '2031-12-31', termEnd: '2031-01-15' })).toMatch(/ends before it starts/);
    });
    it('buildStatement refuses too, so a caller cannot get one past it', () => {
      expect(() => buildStatement('2031-03', ROWS, { pricePence: PRICE, capPence: null, totalCeilingPence: 12345 }, LATER)).toThrow(/a total ceiling is set/);
    });
    it('loadStatement refuses before reading anything', async () => {
      let read = false;
      const db = { from: () => { read = true; return {}; } } as any;
      await expect(loadStatement(db, 't', '2031-03', { pricePence: PRICE, capPence: null, totalCeilingPence: 12345 })).rejects.toBeInstanceOf(StatementNotAvailable);
      expect(read).toBe(false);
    });
  });

  it('unset: the statement is exactly as before, and says nothing about a ceiling', () => {
    const s = st('2031-03');
    expect(s.money).toEqual({ grossPence: 3 * PRICE, creditPence: 0, ceilingCreditPence: 0, totalPence: 3 * PRICE });
    expect(s.ceiling).toEqual({ state: 'none', ceilingPence: null, chargedBeforePence: 0, leftAfterPence: null, reachedIn: null, note: null });
    expect(statementCsv(s)).not.toMatch(/ceiling/i);
  });

  it('never reached: every month charges in full and says how much of the ceiling is left', () => {
    const s = st('2031-04', { totalCeilingPence: 99999 });
    expect(s.money).toEqual({ grossPence: 2331, creditPence: 0, ceilingCreditPence: 0, totalPence: 2331 });
    expect(s.ceiling).toMatchObject({ state: 'under', chargedBeforePence: 3 * 2331, leftAfterPence: 99999 - 4 * 2331, reachedIn: null });
    expect(s.ceiling.note).toBe('Total ceiling for the term: £999.99. Charged in earlier months of the term: £69.93. Left after this month: £906.75.');
    const csv = statementCsv(s);
    expect(csv).toContain('Total ceiling for the term: £999.99. Charged in earlier months of the term: £69.93. Left after this month: £906.75.');
    expect(csv).not.toMatch(/Credit: above the total ceiling/);
    expect(csv).toContain('Total,23.31');
    // The first month of the term starts mid-month, and still counts in full: its last day is inside the term.
    expect(st('2031-01', { totalCeilingPence: 99999 }).ceiling).toMatchObject({ state: 'under', chargedBeforePence: 0 });
  });

  it('reached exactly at a month end: that month charges in full with no credit, and the term ends with it', () => {
    const ceiling = 3 * 2331;
    const mar = st('2031-03', { totalCeilingPence: ceiling });
    expect(mar.money).toEqual({ grossPence: 2331, creditPence: 0, ceilingCreditPence: 0, totalPence: 2331 });
    expect(mar.ceiling).toMatchObject({ state: 'reached', reachedIn: '2031-03', chargedBeforePence: 4662, leftAfterPence: 0 });
    expect(mar.ceiling.note).toBe('The total ceiling for the term (£69.93) is reached exactly in March 2031. The term ends with March 2031.');
    expect(statementCsv(mar)).not.toMatch(/Credit: above the total ceiling/);
    const apr = st('2031-04', { totalCeilingPence: ceiling });
    expect(apr.ceiling).toMatchObject({ state: 'after', reachedIn: '2031-03' });
    expect(apr.money!.totalPence).toBe(0);
  });

  it('crossed during a month: only what is left is charged, and the rest is one credit line', () => {
    const o = { totalCeilingPence: 5000 };
    const feb = st('2031-02', o);
    expect(feb.ceiling).toMatchObject({ state: 'under', chargedBeforePence: 2331, leftAfterPence: 338 });
    const mar = st('2031-03', o);
    expect(mar.money).toEqual({ grossPence: 2331, creditPence: 0, ceilingCreditPence: 1993, totalPence: 338 });
    adds(mar);
    expect(mar.ceiling).toMatchObject({ state: 'reached', reachedIn: '2031-03', chargedBeforePence: 4662, leftAfterPence: 0 });
    expect(mar.ceiling.note).toBe('The total ceiling for the term (£50.00) is reached in March 2031. Earlier months of the term charged £46.62, so this month charges only the £3.38 that was left, and the rest is a credit. The term ends with March 2031.');
    const csv = statementCsv(mar);
    expect(csv).toContain('Live shops x 7.77,23.31');
    expect(csv).toContain('Credit: above the total ceiling for the term,-19.93');
    expect(csv).toContain('Total,3.38');
    expect(csv.match(/Credit:/g)).toHaveLength(1);
    // Across the term, exactly the ceiling was charged.
    expect(['2031-01', '2031-02', '2031-03', '2031-04', '2031-05'].reduce((t, m) => t + st(m, o).money!.totalPence, 0)).toBe(5000);
  });

  it('months after it: nothing charged, said plainly, every live shop still listed', () => {
    for (const m of ['2031-04', '2031-07']) {
      const s = st(m, { totalCeilingPence: 5000, capPence: 2000 });
      expect(s.money).toEqual({ grossPence: 0, creditPence: 0, ceilingCreditPence: 0, totalPence: 0 });
      expect(s.ceiling).toMatchObject({ state: 'after', leftAfterPence: 0 });
      expect(s.cap).toEqual({ applies: false, reason: 'after_ceiling', note: null });
      expect(s.liveShops).toBe(3);
      expect(s.lines.map((l) => l.name)).toEqual(['Shop a', 'Shop b', 'Shop c']);
      expect(s.lines.some((l) => l.aboveCap)).toBe(false);
      expect(s.shopsAboveCap).toBe(0);
      const csv = statementCsv(s);
      expect(csv).not.toMatch(/Live shops x|Monthly cap|Credit:/);
      expect(csv).toContain('Total,0.00');
    }
    expect(st('2031-04', { totalCeilingPence: 5000, capPence: 2000 }).ceiling.note).toMatch(/^Nothing is charged for April 2031 under this term: the term ended in /);
    expect(st('2031-07', { totalCeilingPence: 5000 }).ceiling.note).toBe('Nothing is charged for July 2031 under this term: the term ended in March 2031, when the total ceiling for the term (£50.00) was reached.');
    expect(statementCsv(st('2031-07', { totalCeilingPence: 5000 }))).toContain('Nothing is charged for July 2031 under this term: the term ended in March 2031, when the total ceiling for the term (£50.00) was reached.');
  });

  it('a ceiling smaller than one month\'s capped fee: reached in the first month, both credit lines shown', () => {
    const o = { capPence: 2000, totalCeilingPence: 123 };
    const jan = st('2031-01', o);
    expect(jan.money).toEqual({ grossPence: 2331, creditPence: 331, ceilingCreditPence: 1877, totalPence: 123 });
    adds(jan);
    expect(jan.ceiling).toMatchObject({ state: 'reached', reachedIn: '2031-01', chargedBeforePence: 0 });
    const csv = statementCsv(jan);
    expect(csv).toContain('Credit: above the monthly cap (1 shop),-3.31');
    expect(csv).toContain('Credit: above the total ceiling for the term,-18.77');
    expect(csv).toContain('Total,1.23');
    expect(st('2031-02', o).ceiling).toMatchObject({ state: 'after', reachedIn: '2031-01' });
  });

  it('counts what each month charged AFTER the monthly cap, not before it', () => {
    // Capped, each month charges 2000, not 2331. Uncapped, 5000 is crossed in March after 4662; capped, after 4000.
    const o = { capPence: 2000, totalCeilingPence: 5000 };
    expect(st('2031-02', o).ceiling).toMatchObject({ state: 'under', chargedBeforePence: 2000, leftAfterPence: 1000 });
    const mar = st('2031-03', o);
    expect(mar.money).toEqual({ grossPence: 2331, creditPence: 331, ceilingCreditPence: 1000, totalPence: 1000 });
    adds(mar);
    expect(mar.ceiling).toMatchObject({ state: 'reached', chargedBeforePence: 4000 });
    // A cap that is never hit leaves the ceiling arithmetic alone.
    expect(st('2031-03', { capPence: 99999, totalCeilingPence: 5000 }).money).toEqual({ grossPence: 2331, creditPence: 0, ceilingCreditPence: 1993, totalPence: 338 });
  });

  it('a month in which fewer shops were live charges less towards it, from the same record', () => {
    const rows = [...liveIn(['2031-01']), ...liveIn(['2031-02'], ['a']), ...liveIn(['2031-03'])];
    // A shop live earlier in February but not on its last day does not count for February.
    rows.push(row('b', { month: '2031-02', first_live_on: '2031-02-01', last_live_on: '2031-02-20' }));
    expect(st('2031-03', { totalCeilingPence: 99999 }, rows).ceiling).toMatchObject({ state: 'under', chargedBeforePence: 2331 + 777 });
  });

  it('months outside the term: before it, nothing counts towards the ceiling; after BILLING_TERM_END, as before', () => {
    const rows = [...liveIn(['2030-12']), ...ROWS, ...liveIn(['2032-01'])];
    expect(st('2030-12', { totalCeilingPence: 5000 }, rows, '2032-02-10').ceiling).toMatchObject({ state: 'outside_term', note: null });
    expect(st('2031-01', { totalCeilingPence: 5000 }, rows, '2032-02-10').ceiling).toMatchObject({ state: 'under', chargedBeforePence: 0 });
    const after = st('2032-01', { totalCeilingPence: 5000, capPence: 1000 }, rows, '2032-02-10');
    expect(after.ceiling.state).toBe('outside_term');
    expect(after.cap).toMatchObject({ applies: false, reason: 'after_term' });
    expect(after.money).toEqual({ grossPence: 2331, creditPence: 0, ceilingCreditPence: 0, totalPence: 2331 });
  });

  it('with no price set there is nothing to limit: counts only, and nothing said', () => {
    const s = st('2031-05', { pricePence: null, totalCeilingPence: 5000 });
    expect(s.money).toBeNull();
    expect(s.ceiling).toMatchObject({ state: 'no_price', note: null });
  });

  it('the month in progress can be the one that reaches it, provisionally', () => {
    const rows = liveIn(['2031-01', '2031-02']).concat(['a', 'b', 'c'].map((id) => row(id, { month: '2031-03', first_live_on: '2031-03-01', last_live_on: '2031-03-12' })));
    const s = st('2031-03', { totalCeilingPence: 5000 }, rows, '2031-03-12');
    expect(s).toMatchObject({ provisional: true, ceiling: { state: 'reached' }, money: { totalPence: 338, ceilingCreditPence: 1993 } });
  });

  describe('refuses rather than guess when an earlier month cannot be worked out', () => {
    it('no count was taken on the last day of an earlier month', () => {
      const rows = [...liveIn(['2031-01']), ...['a', 'b'].map((id) => row(id, { month: '2031-02', first_live_on: '2031-02-01', last_live_on: '2031-02-27' })), ...liveIn(['2031-03'])];
      expect(() => st('2031-03', { totalCeilingPence: 99999 }, rows)).toThrow(StatementNotAvailable);
      expect(() => st('2031-03', { totalCeilingPence: 99999 }, rows)).toThrow('No statement can be produced for March 2031: the total ceiling for the term needs what every earlier month of the term charged, and no count was taken on the last day of February 2031, so what it charged is not known.');
      // Without a ceiling, the same month's statement is produced as before.
      expect(st('2031-03', {}, rows).money!.totalPence).toBe(2331);
      // If the ceiling was reached before the gap, the gap does not matter.
      expect(st('2031-03', { totalCeilingPence: 2000 }, rows).ceiling).toMatchObject({ state: 'after', reachedIn: '2031-01' });
    });
    it('an earlier month has not ended yet (a month not yet begun)', () => {
      expect(() => st('2031-05', { totalCeilingPence: 99999 }, ROWS, '2031-03-20')).toThrow('No statement can be produced for May 2031 yet: the total ceiling for the term needs what every earlier month of the term charged, and March 2031 has not ended.');
      expect(st('2031-05', { totalCeilingPence: 2000 }, ROWS, '2031-03-20').ceiling).toMatchObject({ state: 'after', reachedIn: '2031-01' });
    });
  });

  it('nothing else decides it', () => {
    const src = readFileSync(new URL('./billing.ts', import.meta.url), 'utf8');
    expect(src.match(/totalCeilingForMonth\(month, rows, settings, today/g)).toHaveLength(1);
    // Earlier months are worked out by the same function as the month itself: its definition, this month, earlier months.
    expect(src.match(/monthStatement\(/g)).toHaveLength(3);
  });

  describe('loadStatement reads every month of the term up to this one', () => {
    function pagedDb(all: LiveMonthRow[]) {
      const reads: any[] = [];
      return { reads, from: () => {
        const f: any = { gte: null, lte: null, eq: [] as any[], range: null };
        const q: any = {
          select: () => q, order: () => q,
          eq: (k: string, v: string) => { f.eq.push([k, v]); return q; },
          gte: (_k: string, v: string) => { f.gte = v; return q; },
          lte: (_k: string, v: string) => { f.lte = v; return q; },
          range: (a: number, b: number) => { f.range = [a, b]; reads.push({ ...f }); return q; },
          then: (res: any) => {
            let d = all.filter((r) => f.eq.every(([k, v]: any) => (r as any)[k] === v) && (f.gte === null || r.month >= f.gte) && (f.lte === null || r.month <= f.lte));
            d = d.sort((x, y) => x.month.localeCompare(y.month) || x.retailer_id.localeCompare(y.retailer_id));
            if (f.range) d = d.slice(f.range[0], f.range[1] + 1);
            return res({ data: d, error: null });
          },
        };
        return q;
      } };
    }
    it('from the first month of the term, a page at a time, and the answer matches the rules', async () => {
      // More rows than one read returns: 1,100 shops in each of three months.
      const ids = Array.from({ length: 1100 }, (_, i) => `s${String(i).padStart(4, '0')}`);
      const rows = liveIn(['2031-01', '2031-02', '2031-03'], ids);
      const settings = S({ pricePence: 7, totalCeilingPence: 12345 });
      const db = pagedDb(rows);
      const mar = await loadStatement(db as any, 't', '2031-03', settings, LATER);
      expect(db.reads[0]).toMatchObject({ gte: '2031-01', lte: '2031-03' });
      expect(db.reads).toHaveLength(4);
      // 7,700 a month: January charges it in full, February reaches the ceiling with 4,645 of it.
      expect(mar.ceiling).toMatchObject({ state: 'after', reachedIn: '2031-02' });
      const feb = await loadStatement(pagedDb(rows) as any, 't', '2031-02', settings, LATER);
      expect(feb.money).toEqual({ grossPence: 7700, creditPence: 0, ceilingCreditPence: 3055, totalPence: 4645 });
    });
    it('without a ceiling it reads just the one month, as before', async () => {
      const db = pagedDb(ROWS);
      const s = await loadStatement(db as any, 't', '2031-03', S(), LATER);
      expect(s.liveShops).toBe(3);
      expect(db.reads).toHaveLength(0); // no paged read: the single-month query
    });
  });

  it('the admin page is told plainly when the ceiling refuses, as it is for the term', () => {
    const route = readFileSync(new URL('../app/api/admin/pilot/route.ts', import.meta.url), 'utf8');
    expect(route).toMatch(/if \(e instanceof StatementNotAvailable\) return e;/);
    expect(route).toMatch(/if \(statement instanceof StatementNotAvailable\) return NextResponse\.json\(\{ error: statement\.message, notAvailable: true \}, \{ status: 409 \}\);/);
  });
});
