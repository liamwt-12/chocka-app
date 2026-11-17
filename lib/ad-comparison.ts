/**
 * "Change during your ads": the four weeks from a shop's ad start date against
 * THE SAME FOUR WEEKS A YEAR EARLIER, set beside shops with no ads measured the
 * same way.
 *
 * It used to compare with the four weeks just before the ads. Ads tend to
 * start when the season does, so that mostly measured the season. Last year's
 * same weeks take the time of year out (lib/year-on-year.ts). If a shop has
 * no figures from last year, the four weeks before are used instead, and the
 * result says so.
 *
 * WHAT THIS CAN AND CANNOT SAY. It shows what changed while the ads ran, and
 * how that compares with shops that had no ads. It cannot show the ads caused
 * the change: weather, local events and other marketing all move these
 * numbers. Every place that renders this must say so, and must never use the
 * words "results of your ads". (Attribution was declined in writing in July.)
 *
 * WHEN IT SAYS NOTHING. Rather than guess, it returns a reason instead of
 * figures when:
 *   - the after-window is not complete yet (fewer than WINDOW_DAYS reportable days since the start)
 *   - the shop has too little stored history from last year AND from the weeks before
 * and it leaves out the network comparison when fewer than MIN_COMPARISON_SHOPS
 * shops without ads have full data for both windows, on the same basis.
 *
 * Windows are WINDOW_DAYS long (28, so whole weeks and weekdays match):
 *   after      = [start, start + 27]
 *   last year  = the after-window moved back 52 weeks
 *   before     = [start - 28, start - 1]   (the fallback)
 */
import { totalsFor, addDaysIso, lastReportableDate, type MetricRow, type MetricTotals } from './metrics';
import { sameWeeksLastYear, mergeRanges, type Basis, type DayRange } from './year-on-year';

export const WINDOW_DAYS = 28;
/** A window needs at least this many days with stored figures to count. */
export const MIN_DAYS_IN_WINDOW = 24;
export const MIN_COMPARISON_SHOPS = 3;
/** Below this, a percentage is noise (10 calls to 14 is "+40%"), so only the counts are shown. */
export const MIN_BASE_FOR_PERCENT = 20;

export const COMPARED_METRICS: Array<{ key: keyof MetricTotals; label: string }> = [
  { key: 'views', label: 'People who found you on Google' },
  { key: 'searchViews', label: 'of which on Google Search' },
  { key: 'calls', label: 'Calls' },
  { key: 'websiteClicks', label: 'Website clicks' },
  { key: 'directions', label: 'Direction requests' },
];

export interface AdWindows { start: string; beforeFrom: string; beforeTo: string; afterFrom: string; afterTo: string; lastYearFrom: string; lastYearTo: string }

export function adWindows(start: string): AdWindows {
  const afterTo = addDaysIso(start, WINDOW_DAYS - 1);
  const lastYear = sameWeeksLastYear({ from: start, to: afterTo });
  return {
    start,
    beforeFrom: addDaysIso(start, -WINDOW_DAYS),
    beforeTo: addDaysIso(start, -1),
    afterFrom: start,
    afterTo,
    lastYearFrom: lastYear.from,
    lastYearTo: lastYear.to,
  };
}

export interface MetricChange { key: string; label: string; before: number; after: number; percent: number | null }

export type AdComparison =
  /** `basis` says what "before" is: the same four weeks last year, or (with no figures from last year) the four weeks before the ads. */
  | { status: 'ok'; basis: Basis; windows: AdWindows; shop: MetricChange[]; network: { shops: number; changes: MetricChange[] } | null }
  | { status: 'too_early'; windows: AdWindows; readyOn: string; message: string }
  | { status: 'not_enough_history'; windows: AdWindows; message: string };

export function percentChange(before: number, after: number): number | null {
  if (before < MIN_BASE_FOR_PERCENT) return null;
  return Math.round(((after - before) / before) * 100);
}

function changes(before: MetricTotals, after: MetricTotals): MetricChange[] {
  return COMPARED_METRICS.map(({ key, label }) => ({
    key, label, before: before[key] as number, after: after[key] as number, percent: percentChange(before[key] as number, after[key] as number),
  }));
}

/**
 * Pure comparison. `comparisonShops` is one array of stored rows per shop with
 * no ad start date (any shop with gaps in either window is left out).
 */
export function compareAdPeriod(
  start: string,
  shopRows: MetricRow[],
  comparisonShops: MetricRow[][],
  now: Date = new Date(),
): AdComparison {
  const w = adWindows(start);
  const lastDay = lastReportableDate(now);
  if (w.afterTo > lastDay) {
    const readyOn = addDaysIso(w.afterTo, 5);
    return { status: 'too_early', windows: w, readyOn, message: `Your ads started on ${start}. We need four full weeks of Google figures after that date before we can compare, so this will appear from ${readyOn}.` };
  }
  const after = totalsFor(shopRows, w.afterFrom, w.afterTo);
  const lastYear = totalsFor(shopRows, w.lastYearFrom, w.lastYearTo);
  const weeksBefore = totalsFor(shopRows, w.beforeFrom, w.beforeTo);
  // Last year's same weeks if the shop has them; otherwise the weeks before; otherwise nothing.
  const basis: Basis | null = lastYear.daysWithData >= MIN_DAYS_IN_WINDOW ? 'last_year' : weeksBefore.daysWithData >= MIN_DAYS_IN_WINDOW ? 'weeks_before' : null;
  if (after.daysWithData < MIN_DAYS_IN_WINDOW || !basis) {
    return { status: 'not_enough_history', windows: w, message: `Google doesn't have enough figures for your listing, from the same weeks last year or from the four weeks before ${start}, for us to compare fairly, so we've left this out rather than guess.` };
  }
  const before = basis === 'last_year' ? lastYear : weeksBefore;
  const [baseFrom, baseTo] = basis === 'last_year' ? [w.lastYearFrom, w.lastYearTo] : [w.beforeFrom, w.beforeTo];

  // Shops with no ads, measured on the same basis as this shop.
  const usable = comparisonShops
    .map((rows) => ({ b: totalsFor(rows, baseFrom, baseTo), a: totalsFor(rows, w.afterFrom, w.afterTo) }))
    .filter(({ b, a }) => b.daysWithData >= MIN_DAYS_IN_WINDOW && a.daysWithData >= MIN_DAYS_IN_WINDOW);

  let network: { shops: number; changes: MetricChange[] } | null = null;
  if (usable.length >= MIN_COMPARISON_SHOPS) {
    const sum = (k: 'a' | 'b') => usable.reduce((acc, x) => {
      for (const { key } of COMPARED_METRICS) (acc as any)[key] = ((acc as any)[key] || 0) + (x[k][key] as number);
      return acc;
    }, {} as MetricTotals);
    network = { shops: usable.length, changes: changes(sum('b'), sum('a')) };
  }
  return { status: 'ok', basis, windows: w, shop: changes(before, after), network };
}

/** Load the stored rows a comparison needs for one profile. */
export function comparisonRanges(start: string): DayRange[] {
  const w = adWindows(start);
  // Last year's same weeks, and from four weeks before the ads to four weeks after. Never overlapping.
  return mergeRanges([{ from: w.lastYearFrom, to: w.lastYearTo }, { from: w.beforeFrom, to: w.afterTo }]);
}

const fmtPct = (p: number | null) => (p === null ? '' : ` (${p > 0 ? '+' : ''}${p}%)`);

/** The email section. Always labelled as change during the ads, never as results. */
export function adComparisonEmailSection(c: AdComparison): string {
  const head = `<h3 style="font-size: 15px; margin: 0 0 6px;">Change during your ads</h3>`;
  if (c.status !== 'ok') {
    return `<div style="background:#F5F3EF;border-radius:12px;padding:16px;margin-bottom:24px;">${head}<p style="font-size:13px;color:#555;margin:0;">${c.message}</p></div>`;
  }
  const net = new Map((c.network?.changes || []).map((x) => [x.key, x]));
  const rows = c.shop.map((m) => {
    const n = net.get(m.key);
    return `<tr>
      <td style="padding:6px 0;font-size:13px;color:#1A1A1A;">${m.label}</td>
      <td style="padding:6px 0;font-size:13px;text-align:right;font-family:'Courier New',monospace;">${m.before.toLocaleString()} &rarr; ${m.after.toLocaleString()}${fmtPct(m.percent)}</td>
      <td style="padding:6px 0 6px 12px;font-size:12px;text-align:right;color:#999;">${n && n.percent !== null ? `${n.percent > 0 ? '+' : ''}${n.percent}%` : '&ndash;'}</td>
    </tr>`;
  }).join('');
  const netNote = c.network
    ? `The right-hand column is the change across ${c.network.shops} shops without ads, measured the same way.`
    : 'There are not yet enough shops without ads to compare against, so that column is empty.';
  return `<div style="background:#F5F3EF;border-radius:12px;padding:16px;margin-bottom:24px;">${head}
    <p style="font-size:12px;color:#999;margin:0 0 8px;">${c.basis === 'last_year' ? `The same four weeks last year compared with the four weeks from ${c.windows.start}.` : `Four weeks before ${c.windows.start} compared with the four weeks from ${c.windows.start}. (We have no figures for your listing from the same weeks last year.)`}</p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="font-size:12px;color:#777;margin:10px 0 0;">${netNote} This shows what changed while your ads were running. Other things affect these numbers too, such as the time of year, so it is not proof of what the ads did.</p>
  </div>`;
}
