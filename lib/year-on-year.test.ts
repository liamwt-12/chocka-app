import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sameWeeksLastYear, sameMonthLastYear, mergeRanges, movedEnough, actionsOf, percentOf, hasFigures, YEAR_SHIFT_DAYS, MIN_BASE_ACTIONS, MIN_EXTRA_ACTIONS, BASIS_WORDS } from './year-on-year';
import { whatChanged, chooseComparison, narrativeHtml } from './report-narrative';
import { HISTORY_DAYS } from './metrics';
import { LEAGUE_MIN_BASE_ACTIONS, LEAGUE_WINDOW_DAYS } from './league';
import { MIN_BASE_EVENTS, MIN_EXTRA_EVENTS } from './ad-spend';

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

describe('the same weeks last year', () => {
  it('moves a run of days back 52 whole weeks, so weekdays line up', () => {
    expect(YEAR_SHIFT_DAYS).toBe(364);
    const r = sameWeeksLastYear({ from: '2026-12-07', to: '2027-01-03' });
    expect(r).toEqual({ from: '2025-12-08', to: '2026-01-04' });
    expect(dow(r.from)).toBe(dow('2026-12-07'));
    expect(dow(r.to)).toBe(dow('2027-01-03'));
  });
  it('works across a leap day', () => {
    const r = sameWeeksLastYear({ from: '2028-03-06', to: '2028-04-02' });
    expect(dow(r.from)).toBe(dow('2028-03-06'));
    expect(r.from).toBe('2027-03-08');
  });
  it('the stored history is long enough to hold last year\'s weeks for a shop from the day it connects', () => {
    // The latest four weeks end up to five days ago; last year's start 364 days before that.
    expect(HISTORY_DAYS).toBeGreaterThan(YEAR_SHIFT_DAYS + LEAGUE_WINDOW_DAYS + 5);
  });
});

describe('the same month last year', () => {
  it('is the same calendar month, with its own length', () => {
    expect(sameMonthLastYear('2026-12-01')).toEqual({ from: '2025-12-01', to: '2025-12-31', days: 31 });
    expect(sameMonthLastYear('2028-02-01')).toEqual({ from: '2027-02-01', to: '2027-02-28', days: 28 });
    expect(sameMonthLastYear('2029-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29', days: 29 });
  });
});

describe('ranges are never read twice', () => {
  it('merges ranges that overlap or touch, and leaves separate ones alone', () => {
    expect(mergeRanges([{ from: '2026-09-07', to: '2026-11-01' }, { from: '2025-10-06', to: '2025-11-02' }])).toEqual([{ from: '2025-10-06', to: '2025-11-02' }, { from: '2026-09-07', to: '2026-11-01' }]);
    expect(mergeRanges([{ from: '2026-01-01', to: '2026-01-31' }, { from: '2026-01-20', to: '2026-02-10' }])).toEqual([{ from: '2026-01-01', to: '2026-02-10' }]);
    expect(mergeRanges([{ from: '2026-01-01', to: '2026-01-31' }, { from: '2026-02-01', to: '2026-02-10' }])).toEqual([{ from: '2026-01-01', to: '2026-02-10' }]);
    expect(mergeRanges([{ from: '2026-01-01', to: '2026-03-31' }, { from: '2026-02-01', to: '2026-02-10' }])).toEqual([{ from: '2026-01-01', to: '2026-03-31' }]);
    expect(mergeRanges([{ from: '2026-02-01', to: '2026-01-01' }])).toEqual([]);
  });
});

describe('the rules every comparison shares', () => {
  it('ten actions to give a percentage, three to call it a move: one definition', () => {
    expect([MIN_BASE_ACTIONS, MIN_EXTRA_ACTIONS]).toEqual([10, 3]);
    expect(LEAGUE_MIN_BASE_ACTIONS).toBe(MIN_BASE_ACTIONS);
    expect(MIN_BASE_EVENTS).toBe(MIN_BASE_ACTIONS);
    expect(MIN_EXTRA_EVENTS).toBe(MIN_EXTRA_ACTIONS);
  });
  it('a move of fewer than three actions is not a move, up or down', () => {
    expect([[10, 11], [10, 12], [10, 13], [10, 8], [10, 7], [50, 50]].map(([a, b]) => movedEnough(a, b))).toEqual([false, false, true, false, true, false]);
  });
  it('actions are calls, website clicks and direction requests, never views', () => {
    expect(actionsOf({ calls: 3, websiteClicks: 4, directions: 5, views: 999 } as any)).toBe(12);
    expect(percentOf(40, 50)).toBe(25);
  });
  it('every comparison says what it was made against, and none claims a cause', () => {
    expect(BASIS_WORDS.last_year.against).toBe('against the same four weeks last year');
    expect(BASIS_WORDS.weeks_before.against).toMatch(/no figures from the same weeks last year/);
    for (const f of ['./year-on-year.ts', './league.ts', './ad-comparison.ts', './ad-spend.ts', './network-summary.ts']) {
      const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/because of|thanks to|caused by|as a result of|results of your ads/i);
    }
  });
});

describe('everywhere that used the weeks before now asks for last year', () => {
  it('the league, the ad view, the network summary and the shop report', () => {
    expect(src('./league.ts')).toMatch(/sameWeeksLastYear\(\{ from: recentFrom, to: recentTo \}\)/);
    expect(src('./ad-comparison.ts')).toMatch(/sameWeeksLastYear\(\{ from: start, to: afterTo \}\)/);
    expect(src('./network-summary.ts')).toMatch(/comparableSet\(withLastYear\) \? 'last_year'/);
    expect(src('./console-data.ts')).toMatch(/sameMonthLastYear\(month\.from\)/);
    const report = src('../app/api/cron/monthly-report/route.ts');
    expect(report).toMatch(/sameMonthLastYear\(month\.from\)/);
    expect(report).toMatch(/chooseComparison\(/);
    expect(report).toMatch(/loadMetricRanges\(supabaseAdmin, profile\.id, comparisonRanges\(adStart\)\)/);
  });
  it('the console says so in words, and no longer says "before the shop joined"', () => {
    const page = src('../app/console/console-client.tsx');
    expect(page).toMatch(/same four weeks a year ago/);
    expect(page).toMatch(/same four weeks last year/);
    expect(page).not.toMatch(/four weeks before the shop joined|four weeks before joining|Four weeks before the ads started against four weeks after/);
  });
});

describe('the shop\'s monthly report', () => {
  const now = { views: 1240, calls: 30, websiteClicks: 12, directions: 8 };
  it('compares with the same month last year, in those words', () => {
    expect(whatChanged(now, { views: 1010, calls: 30, websiteClicks: 13, directions: 20 }, 'last_year')).toEqual([
      'Calls from your listing: 30, the same as the same month last year.',
      'Website clicks: 12 (13 in the same month last year).',
      'Requests for directions: 8, down from 20 in the same month last year (-60%).',
      'Times you were seen on Google: 1,240, up from 1,010 in the same month last year (+23%).',
    ]);
  });
  it('still says "last month" when that is what it is compared with', () => {
    expect(whatChanged(now, { views: 1010, calls: 30, websiteClicks: 12, directions: 8 }, 'last_month')[3]).toBe('Times you were seen on Google: 1,240, up from 1,010 last month (+23%).');
    expect(whatChanged(now, { views: 1010, calls: 30, websiteClicks: 12, directions: 8 })[0]).toBe('Calls from your listing: 30, the same as last month.');
  });
  it('picks last year if it is all there, then last month, then nothing', () => {
    const y = { complete: true, figures: 'Y' }, m = { complete: true, figures: 'M' };
    expect(chooseComparison(true, y, m)).toEqual({ comparedWith: 'last_year', before: 'Y' });
    expect(chooseComparison(true, { ...y, complete: false }, m)).toEqual({ comparedWith: 'last_month', before: 'M' });
    expect(chooseComparison(true, { ...y, complete: false }, { ...m, complete: false })).toBeNull();
    // A part month is never compared with a whole one.
    expect(chooseComparison(false, y, m)).toBeNull();
  });
  it('does not call two more calls a rise, or two fewer a fall', () => {
    const lines = whatChanged({ views: 1000, calls: 23, websiteClicks: 12, directions: 18 }, { views: 1000, calls: 21, websiteClicks: 12, directions: 20 }, 'last_year');
    expect(lines[0]).toBe('Calls from your listing: 23 (21 in the same month last year).');
    expect(lines[2]).toBe('Requests for directions: 18 (20 in the same month last year).');
    expect(whatChanged({ views: 1000, calls: 24, websiteClicks: 12, directions: 18 }, { views: 1000, calls: 21, websiteClicks: 12, directions: 20 }, 'last_year')[0]).toMatch(/up from 21 .*\(\+14%\)/);
  });
  it('a period of noughts is not figures, however many days are stored', () => {
    const t = (o: any) => ({ daysWithData: 28, views: 0, calls: 0, websiteClicks: 0, directions: 0, ...o });
    expect(hasFigures(t({}), 28)).toBe(false);
    expect(hasFigures(t({ views: 3 }), 28)).toBe(true);
    expect(hasFigures(t({ views: 300, daysWithData: 27 }), 28)).toBe(false);
  });
  it('never says why', () => {
    const text = whatChanged(now, { views: 500, calls: 10, websiteClicks: 1, directions: 1 }, 'last_year').join(' ') + narrativeHtml(['a'], ['b'], true);
    expect(text).not.toMatch(/because|thanks to|due to|as a result/i);
    expect(narrativeHtml(['a'], ['b'], true)).toMatch(/go up and down for many reasons/);
  });
});
