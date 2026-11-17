import { describe, it, expect } from 'vitest';
import { compareAdPeriod, adWindows, comparisonRanges, percentChange, adComparisonEmailSection, MIN_BASE_FOR_PERCENT } from './ad-comparison';
import { addDaysIso, type MetricRow } from './metrics';
import { parseAdStartDate } from './pilot';

const START = '2026-10-05';
const NOW = new Date('2026-11-14T12:00:00Z'); // last reportable day 2026-11-09; after-window ends 2026-11-01

/** Daily rows from `from` for `days` days, with per-metric values (before vs after the start). */
function series(from: string, days: number, before: Record<string, number>, after: Record<string, number>, start = START): MetricRow[] {
  const rows: MetricRow[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(from, i);
    const v = date < start ? before : after;
    for (const [metric, value] of Object.entries(v)) rows.push({ date, metric, value });
  }
  return rows;
}
const shopRows = series(addDaysIso(START, -28), 56, { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 10, CALL_CLICKS: 1, WEBSITE_CLICKS: 2 }, { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 15, CALL_CLICKS: 2, WEBSITE_CLICKS: 2 });
const flat = () => series(addDaysIso(START, -28), 56, { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 10, CALL_CLICKS: 1 }, { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 11, CALL_CLICKS: 1 });

describe('adWindows', () => {
  it('uses four whole weeks either side of the start', () => {
    expect(adWindows(START)).toEqual({ start: START, beforeFrom: '2026-09-07', beforeTo: '2026-10-04', afterFrom: START, afterTo: '2026-11-01', lastYearFrom: '2025-10-06', lastYearTo: '2025-11-02' });
  });
  it('last year\'s window is the same weekdays, 52 weeks earlier', () => {
    const w = adWindows(START);
    const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
    expect(dow(w.lastYearFrom)).toBe(dow(w.afterFrom));
    expect(dow(w.lastYearTo)).toBe(dow(w.afterTo));
  });
  it('the rows to load never overlap, so no day is counted twice', () => {
    expect(comparisonRanges(START)).toEqual([{ from: '2025-10-06', to: '2025-11-02' }, { from: '2026-09-07', to: '2026-11-01' }]);
  });
});

/** The same four weeks a year earlier, at a steady daily value. */
const lastYear = (v: Record<string, number>): MetricRow[] => series('2025-10-06', 28, v, v);

describe('compareAdPeriod: against the same weeks last year', () => {
  // This year: 1 call a day before the ads, 2 a day after. Last year, the same weeks: 2 a day.
  // Against the weeks before that is +100%. Against last year it is no change at all.
  const withHistory = [...lastYear({ BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 15, CALL_CLICKS: 2, WEBSITE_CLICKS: 2 }), ...shopRows];
  const flatWithHistory = () => [...lastYear({ BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 10, CALL_CLICKS: 1 }), ...flat()];

  it('uses last year\'s same weeks when the shop has them, which takes the season out', () => {
    const c = compareAdPeriod(START, withHistory, [], NOW);
    expect(c.status).toBe('ok');
    if (c.status !== 'ok') return;
    expect(c.basis).toBe('last_year');
    expect(c.shop.find((m) => m.key === 'calls')).toMatchObject({ before: 56, after: 56, percent: 0 });
  });
  it('measures the shops with no ads the same way, and leaves out any without last year', () => {
    const c = compareAdPeriod(START, withHistory, [flatWithHistory(), flatWithHistory(), flatWithHistory(), flat()], NOW);
    expect(c.status === 'ok' && c.network?.shops).toBe(3);
    if (c.status !== 'ok') return;
    // 10 a day last year, 11 a day now.
    expect(c.network!.changes.find((m) => m.key === 'views')).toMatchObject({ before: 840, after: 924, percent: 10 });
  });
  it('falls back to the weeks before, and says so, when there is nothing from last year', () => {
    const c = compareAdPeriod(START, shopRows, [flat(), flat(), flat()], NOW);
    expect(c.status === 'ok' && c.basis).toBe('weeks_before');
    const html = adComparisonEmailSection(c);
    expect(html).toContain('We have no figures for your listing from the same weeks last year.');
    expect(adComparisonEmailSection(compareAdPeriod(START, withHistory, [], NOW))).toContain('The same four weeks last year compared with the four weeks from 2026-10-05.');
  });
  it('a few days of last year are not enough: it falls back rather than compare with a part period', () => {
    const thin = [...lastYear({ CALL_CLICKS: 9 }).filter((r) => r.date < '2025-10-16'), ...shopRows];
    const c = compareAdPeriod(START, thin, [], NOW);
    expect(c.status === 'ok' && c.basis).toBe('weeks_before');
  });
});

describe('compareAdPeriod', () => {
  it('compares the shop and the shops without ads over the same weeks', () => {
    const c = compareAdPeriod(START, shopRows, [flat(), flat(), flat()], NOW);
    expect(c.status).toBe('ok');
    if (c.status !== 'ok') return;
    const views = c.shop.find((m) => m.key === 'views')!;
    expect(views).toMatchObject({ before: 280, after: 420, percent: 50 });
    expect(c.shop.find((m) => m.key === 'calls')).toMatchObject({ before: 28, after: 56, percent: 100 });
    expect(c.network!.shops).toBe(3);
    expect(c.network!.changes.find((m) => m.key === 'views')!.percent).toBe(10);
  });

  it('says it is too early, with the date it will be ready, instead of guessing', () => {
    const c = compareAdPeriod('2026-11-01', shopRows, [], NOW);
    expect(c.status).toBe('too_early');
    if (c.status === 'too_early') expect(c.readyOn).toBe('2026-12-03');
  });

  it('says there is not enough history when last year and the weeks before are both missing', () => {
    const onlyAfter = shopRows.filter((r) => r.date >= START);
    const c = compareAdPeriod(START, onlyAfter, [], NOW);
    expect(c.status).toBe('not_enough_history');
  });

  it('leaves out the network comparison with too few complete shops', () => {
    const gappy = flat().filter((r) => r.date > '2026-09-20');
    const c = compareAdPeriod(START, shopRows, [flat(), flat(), gappy], NOW);
    expect(c.status === 'ok' && c.network).toBeNull();
  });
});

describe('percentChange', () => {
  it('gives no percentage on a tiny base', () => {
    expect(percentChange(MIN_BASE_FOR_PERCENT - 1, 30)).toBeNull();
    expect(percentChange(20, 30)).toBe(50);
  });
});

describe('email section wording', () => {
  it('says "change during your ads" and never "results of your ads"', () => {
    for (const c of [
      compareAdPeriod(START, shopRows, [flat(), flat(), flat()], NOW),
      compareAdPeriod(START, shopRows, [], NOW),
      compareAdPeriod('2026-11-01', shopRows, [], NOW),
      compareAdPeriod(START, [], [], NOW),
    ]) {
      const html = adComparisonEmailSection(c);
      expect(html).toContain('Change during your ads');
      expect(html.toLowerCase()).not.toContain('results of your ads');
    }
  });
  it('carries the caveat when figures are shown', () => {
    const html = adComparisonEmailSection(compareAdPeriod(START, shopRows, [flat(), flat(), flat()], NOW));
    expect(html).toContain('not proof of what the ads did');
    expect(html).toContain('3 shops without ads');
  });
});

describe('parseAdStartDate', () => {
  const now = new Date('2026-11-14T00:00:00Z');
  it('accepts a real date, clears on empty, refuses nonsense', () => {
    expect(parseAdStartDate('2026-12-07', now)).toBe('2026-12-07');
    expect(parseAdStartDate('', now)).toBeNull();
    expect(parseAdStartDate(null, now)).toBeNull();
    expect(parseAdStartDate('2026-02-30', now)).toBeUndefined();
    expect(parseAdStartDate('07/12/2026', now)).toBeUndefined();
    expect(parseAdStartDate('2029-01-01', now)).toBeUndefined();
  });
});
