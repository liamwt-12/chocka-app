/**
 * Same weeks last year: the one fair comparison this product can make.
 *
 * WHY. Every comparison used to be against the weeks just before: the four
 * weeks before a shop joined, the month before, the four weeks before its ads.
 * A shop that joins in late November then has December measured against
 * November, and what that mostly measures is Christmas. Comparing with the
 * SAME weeks a year earlier takes the time of year out.
 *
 * The figures are already there: the first sync for a listing stores about 18
 * months of Google's daily history (lib/metrics.ts), so a shop has last year's
 * figures from the day it connects.
 *
 * HOW THE WINDOWS LINE UP
 *   a run of weeks    moved back 364 days (52 whole weeks), so Mondays are
 *                     compared with Mondays
 *   a calendar month  the same calendar month a year earlier, compared per
 *                     day, so February in a leap year is not a rise
 *
 * WHEN HISTORY IS SHORT (a listing created within the last year, or one
 * Google holds less history for) there is nothing from last year to compare
 * with. Each caller then falls back to the comparison it used before, says
 * plainly that it has, and never mixes the two in one ranking.
 *
 * THE RULES EVERY COMPARISON SHARES, in one place:
 *   MIN_BASE_ACTIONS   fewer customer actions than this in the earlier period
 *                      and no percentage is given: "too few to say"
 *   MIN_EXTRA_ACTIONS  a rise (or fall) is only called one if it is also at
 *                      least this many actions. 10 to 11 is "+10%" and is one
 *                      phone call
 *
 * Nothing here claims a cause. It says what changed against last year.
 *
 * Pure: dates and sums only.
 */
import { addDaysIso, type MetricTotals } from './metrics';

/** 52 whole weeks, so each day is compared with the same weekday a year earlier. */
export const YEAR_SHIFT_DAYS = 364;
/** Fewer customer actions than this in the earlier period: no percentage, "too few to say". */
export const MIN_BASE_ACTIONS = 10;
/** A rise or fall must also be at least this many actions to be called one. */
export const MIN_EXTRA_ACTIONS = 3;

export type Basis = 'last_year' | 'weeks_before';

export interface DayRange { from: string; to: string }

/** The same run of days, 52 weeks earlier. */
export function sameWeeksLastYear(range: DayRange): DayRange {
  return { from: addDaysIso(range.from, -YEAR_SHIFT_DAYS), to: addDaysIso(range.to, -YEAR_SHIFT_DAYS) };
}

/** The same calendar month a year earlier, from any day in the month ("YYYY-MM-DD"). */
export function sameMonthLastYear(dayInMonth: string): DayRange & { days: number } {
  const y = Number(dayInMonth.slice(0, 4)) - 1, m = Number(dayInMonth.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(days).padStart(2, '0')}`, days };
}

/** Calls, website clicks and direction requests: what a customer actually did. */
export const actionsOf = (t: Pick<MetricTotals, 'calls' | 'websiteClicks' | 'directions'>) => t.calls + t.websiteClicks + t.directions;

export const percentOf = (before: number, after: number) => Math.round(((after - before) / before) * 100);

/**
 * Is a move from `before` to `after` big enough, in actions, to be called a
 * rise or a fall at all? The percentage thresholds are the caller's; this is
 * the floor under them.
 */
export function movedEnough(before: number, after: number): boolean {
  return Math.abs(after - before) >= MIN_EXTRA_ACTIONS;
}

/** How a comparison is described to a reader, by what it was made against. */
export const BASIS_WORDS: Record<Basis, { short: string; against: string }> = {
  last_year: { short: 'same weeks last year', against: 'against the same four weeks last year' },
  weeks_before: { short: 'weeks before', against: 'against the four weeks before (there are no figures from the same weeks last year)' },
};

/** Merge day ranges that overlap or touch, so stored rows are never read (and counted) twice. */
export function mergeRanges(ranges: DayRange[]): DayRange[] {
  const sorted = ranges.filter((r) => r.from <= r.to).slice().sort((a, b) => a.from.localeCompare(b.from));
  const out: DayRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= addDaysIso(last.to, 1)) { if (r.to > last.to) last.to = r.to; } else out.push({ ...r });
  }
  return out;
}
