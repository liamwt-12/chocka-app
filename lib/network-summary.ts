/**
 * The monthly network summary for the funder's marketing team: one page that
 * says how the network is doing without anybody having to add up a table of
 * shops.
 *
 * It is built from what the console already loads, plus each shop's figures
 * for the last complete month and the one before. Everything on it is either a
 * NETWORK TOTAL (a sum across shops, which is what the privacy notice says the
 * funder sees) or something the console already shows per shop (status, an
 * improvement band, ad dates). It adds no new per-shop raw figure.
 *
 * What it never does: claim a cause. Totals are "what happened across the
 * network", improvement is "against each shop's own starting point", and ads
 * are "change alongside", exactly as elsewhere.
 *
 * Pure: takes loaded data, returns the summary.
 */
import { MIN_BASE_FOR_PERCENT } from './ad-comparison';
import type { MetricTotals } from './metrics';
import type { ConsoleShop } from './console-data';
import type { LeagueEntry } from './league';

/** A month's figures only count for a shop with at least this many days of data in it. */
export const MIN_DAYS_IN_MONTH = 20;
/** For the month-on-month comparison a shop needs all but this many days of BOTH months. */
export const DAYS_SHORT_ALLOWED = 2;
/**
 * No total is shown from fewer shops than this: a "network total" of one or two
 * shops is those shops' own figures. The same margin applies to the shops left
 * out of a comparison, so one shop's figures cannot be had by subtraction.
 */
export const MIN_SHOPS_FOR_TOTALS = 3;

export interface MonthFigures { views: number; calls: number; websiteClicks: number; directions: number }
export interface NetworkLine {
  label: string;
  /** Every shop with a full month of figures. */
  thisMonth: number;
  /** The shops that can be compared: this month, and the month before. Null when there is no comparison. */
  sameShopsThisMonth: number | null;
  lastMonth: number | null;
  /** Per day, so a short month against a long one is not a fall. */
  change: number | null;
}

export interface NetworkSummary {
  /** The last complete month, as "November 2026". */
  monthLabel: string;
  shops: { total: number; live: number; connectedNotLive: number; invited: number; notInvited: number };
  /** Network totals for the month, with the month before where it can be compared like for like. */
  totals: { lines: NetworkLine[]; shopsCounted: number; shopsCompared: number; note: string };
  /** How shops are doing against their own starting point. */
  improvement: { rising: number; steady: number; falling: number; tooEarly: number; medianActionsChange: number | null };
  /** Shops with ads: spend (as text) and what changed alongside. */
  ads: { shops: Array<{ name: string; town: string | null; from: string; spend: string | null; label: string; detail: string; flag: boolean }>; withSpend: number; clearRise: number; noClearChange: number; tooEarlyOrFew: number; flagged: number };
  topMovers: Array<{ name: string; town: string | null; band: string; actionsChange: number | null }>;
  /** Shops that are invited or connected and not live, by reason. No contact details. */
  notLive: { total: number; byReason: Array<{ label: string; count: number }> };
}

export interface ShopMonth { retailerId: string; thisMonth: MetricTotals; lastMonth: MetricTotals }
/** The two months being compared, and whether Google's figures for the later one are all in yet. */
export interface MonthSpan { label: string; days: number; daysBefore: number; complete: boolean }

const figures = (t: MetricTotals): MonthFigures => ({ views: t.views, calls: t.calls, websiteClicks: t.websiteClicks, directions: t.directions });

export function buildNetworkSummary(
  shops: ConsoleShop[],
  league: { ranked: LeagueEntry[] },
  months: ShopMonth[],
  span: MonthSpan | string,
): NetworkSummary {
  const m: MonthSpan = typeof span === 'string' ? { label: span, days: 30, daysBefore: 30, complete: true } : span;
  const monthLabel = m.label;
  const count = (state: string) => shops.filter((s) => s.pilotState === state).length;

  // Totals: every shop with a full month of figures, and never from fewer than
  // three shops. The comparison with the month before uses only shops with
  // (nearly) every day of BOTH months, so a shop that joined part-way cannot
  // make the network look as if it grew; and it is per day, so February
  // against January is not a fall.
  const counted = months.filter((x) => x.thisMonth.daysWithData >= MIN_DAYS_IN_MONTH);
  const showTotals = counted.length >= MIN_SHOPS_FOR_TOTALS;
  const full = counted.filter((x) => x.thisMonth.daysWithData >= m.days - DAYS_SHORT_ALLOWED && x.lastMonth.daysWithData >= m.daysBefore - DAYS_SHORT_ALLOWED);
  const leftOut = counted.length - full.length;
  const comparable = m.complete && full.length >= MIN_SHOPS_FOR_TOTALS && (leftOut === 0 || leftOut >= MIN_SHOPS_FOR_TOTALS);
  const both = comparable ? full : [];
  const sum = (list: ShopMonth[], pick: (x: ShopMonth) => MetricTotals, key: keyof MonthFigures) => list.reduce((t, x) => t + figures(pick(x))[key], 0);
  const LINES: Array<[keyof MonthFigures, string]> = [['views', 'Times shops were seen on Google'], ['calls', 'Calls from listings'], ['websiteClicks', 'Website clicks'], ['directions', 'Direction requests']];
  const lines: NetworkLine[] = !showTotals ? [] : LINES.map(([key, label]) => {
    const now = sum(counted, (x) => x.thisMonth, key);
    if (!both.length) return { label, thisMonth: now, sameShopsThisMonth: null, lastMonth: null, change: null };
    const sameNow = sum(both, (x) => x.thisMonth, key), before = sum(both, (x) => x.lastMonth, key);
    const change = before < MIN_BASE_FOR_PERCENT ? null : Math.round(((sameNow / m.days) / (before / m.daysBefore) - 1) * 100);
    return { label, thisMonth: now, sameShopsThisMonth: sameNow, lastMonth: before, change };
  });
  const note = !counted.length ? 'No shop has a full month of figures yet.'
    : !showTotals ? `Only ${counted.length} shop${counted.length === 1 ? ' has' : 's have'} a full month of figures so far. Totals are shown from ${MIN_SHOPS_FOR_TOTALS} shops, so that a total is never one shop's own figures.`
    : !m.complete ? `From ${counted.length} shops. Google's figures for the last few days of the month are not all in yet, so there is no comparison with the month before until they are.`
    : !both.length ? `From ${counted.length} shops with a full month of figures. No comparison with the month before yet: too few shops have two full months.`
    : both.length === counted.length ? `From ${counted.length} shops. Compared with the month before for the same shops, per day.`
    : `From ${counted.length} shops. The comparison uses the ${both.length} that have two full months, per day, so shops that joined part-way do not look like growth.`;

  const bands = league.ranked.map((e) => e.band as string);
  const changes = league.ranked.map((e) => e.actionsChange).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b);
  const participating = shops.filter((s) => s.participating);
  const median = changes.length ? (changes.length % 2 ? changes[(changes.length - 1) / 2] : Math.round((changes[changes.length / 2 - 1] + changes[changes.length / 2]) / 2)) : null;

  const adShops = participating.filter((s) => s.adStartDate).map((s) => ({ name: s.name, town: s.town, from: s.adStartDate!, spend: s.adSpend, label: s.adChange?.label ?? 'Not worked out', detail: s.adChange?.detail ?? '', flag: !!s.adChange?.flag }));

  const reasons = new Map<string, number>();
  for (const s of shops) if (s.statusNote) reasons.set(s.statusNote.label, (reasons.get(s.statusNote.label) || 0) + 1);

  return {
    monthLabel,
    shops: { total: shops.length, live: count('live'), connectedNotLive: count('connected_not_live'), invited: count('invited') + count('invite_expired'), notInvited: count('not_invited') },
    totals: { lines, shopsCounted: counted.length, shopsCompared: both.length, note },
    improvement: {
      rising: bands.filter((b) => b === 'Strong rise' || b === 'Rising').length,
      steady: bands.filter((b) => b === 'Steady').length,
      falling: bands.filter((b) => b === 'Falling').length,
      tooEarly: participating.length - league.ranked.length,
      medianActionsChange: median,
    },
    ads: {
      shops: adShops,
      withSpend: adShops.filter((a) => a.spend).length,
      clearRise: adShops.filter((a) => a.label === 'Clear rise').length,
      noClearChange: adShops.filter((a) => a.label === 'No clear change' || a.label === 'Fall').length,
      tooEarlyOrFew: adShops.filter((a) => ['Too early to say', 'Not enough history', 'Too few to say', 'Not worked out'].includes(a.label)).length,
      flagged: adShops.filter((a) => a.flag).length,
    },
    topMovers: league.ranked.slice(0, 5).map((e) => ({ name: e.name, town: e.town, band: e.band, actionsChange: e.actionsChange })),
    notLive: { total: Array.from(reasons.values()).reduce((a, b) => a + b, 0), byReason: Array.from(reasons.entries()).map(([label, n]) => ({ label, count: n })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) },
  };
}
