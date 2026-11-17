/**
 * The network league: shops ranked by how much they have IMPROVED, not by how
 * big they are.
 *
 * A raw-numbers league is won by the biggest shop on the busiest high street
 * every month, whatever anyone does. Ranking by change means a small shop that
 * has grown beats a large one standing still, which is the behaviour the
 * league is meant to reward.
 *
 * MEASURE. Customer actions (calls + website clicks + direction requests) over
 * the latest 28 reportable days, against THE SAME 28 DAYS A YEAR EARLIER
 * (lib/year-on-year.ts). It used to be against the 28 days before the shop
 * joined, which for a shop joining in late November measured December against
 * November: mostly Christmas. Views (Search + Maps) are a tie-breaker and
 * shown alongside.
 *
 * WHO IS RANKED. Only shops that have been connected for a full 28-day window,
 * with enough stored days in both windows, and enough actions last year for a
 * percentage to mean anything. Everyone else is listed as not ranked, with the
 * reason, never ranked on a guess.
 *
 * WHEN THERE IS NOTHING FROM LAST YEAR (a listing less than a year old, or
 * one Google holds less history for), the shop is NOT ranked: putting a
 * before-joining figure in the same table as year-on-year figures would rank
 * the time of year. Its change against the four weeks before it joined is
 * shown beside its name instead, labelled as that.
 *
 * A change is only called a rise or a fall if it is also at least
 * MIN_EXTRA_ACTIONS actions; anything smaller is "Steady".
 *
 * OUTPUT carries percentages and bands, never raw call or view counts.
 */
import { totalsFor, addDaysIso, lastReportableDate, type MetricRow } from './metrics';
import { sameWeeksLastYear, mergeRanges, actionsOf, percentOf, movedEnough, MIN_BASE_ACTIONS, type DayRange } from './year-on-year';

export const LEAGUE_WINDOW_DAYS = 28;
export const LEAGUE_MIN_DAYS = 24;
export const LEAGUE_MIN_BASE_ACTIONS = MIN_BASE_ACTIONS;

export type ImprovementBand = 'Strong rise' | 'Rising' | 'Steady' | 'Falling';

export function improvementBand(percent: number): ImprovementBand {
  if (percent >= 25) return 'Strong rise';
  if (percent >= 5) return 'Rising';
  if (percent > -5) return 'Steady';
  return 'Falling';
}

/** The band for a move between two counts: the percentage, unless the move is too few actions to be called one. */
export function bandFor(before: number, after: number): ImprovementBand {
  return movedEnough(before, after) ? improvementBand(percentOf(before, after)) : 'Steady';
}

export interface LeagueInput { retailerId: string; name: string; town: string | null; activatedOn: string; rows: MetricRow[] }

export interface LeagueEntry {
  rank: number;
  retailerId: string; name: string; town: string | null;
  actionsChange: number; viewsChange: number | null; band: ImprovementBand;
}
export interface LeagueExcluded {
  retailerId: string; name: string; town: string | null; reason: string;
  /** Only when there are no figures from last year: the change against the four weeks before joining. Not ranked. */
  beforeJoining?: { actionsChange: number; band: ImprovementBand };
}

export function leagueWindows(activatedOn: string, now: Date) {
  const recentTo = lastReportableDate(now);
  const recentFrom = addDaysIso(recentTo, -(LEAGUE_WINDOW_DAYS - 1));
  const lastYear = sameWeeksLastYear({ from: recentFrom, to: recentTo });
  return {
    baselineFrom: addDaysIso(activatedOn, -LEAGUE_WINDOW_DAYS),
    baselineTo: addDaysIso(activatedOn, -1),
    recentFrom,
    recentTo,
    lastYearFrom: lastYear.from,
    lastYearTo: lastYear.to,
  };
}

/** The stored days a shop's league entry needs: last year's weeks, and from before it joined to now. Never overlapping. */
export function leagueRanges(activatedOn: string, now: Date): DayRange[] {
  const w = leagueWindows(activatedOn, now);
  return mergeRanges([{ from: w.lastYearFrom, to: w.lastYearTo }, { from: w.baselineFrom, to: w.recentTo }]);
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

/** Pure. */
export function buildLeague(shops: LeagueInput[], now: Date = new Date()): { ranked: LeagueEntry[]; excluded: LeagueExcluded[] } {
  const ranked: Omit<LeagueEntry, 'rank'>[] = [];
  const excluded: LeagueExcluded[] = [];
  for (const s of shops) {
    const w = leagueWindows(s.activatedOn, now);
    const base = { retailerId: s.retailerId, name: s.name, town: s.town };
    if (w.recentFrom < s.activatedOn) {
      excluded.push({ ...base, reason: `joined ${s.activatedOn}; needs four full weeks of figures since joining` });
      continue;
    }
    const after = totalsFor(s.rows, w.recentFrom, w.recentTo);
    if (after.daysWithData < LEAGUE_MIN_DAYS) {
      excluded.push({ ...base, reason: 'not enough Google figures stored to compare fairly' });
      continue;
    }
    const actionsAfter = actionsOf(after);
    const lastYear = totalsFor(s.rows, w.lastYearFrom, w.lastYearTo);
    if (lastYear.daysWithData < LEAGUE_MIN_DAYS) {
      // Nothing from last year. Not ranked; the old comparison is shown beside the name if it can be made.
      const before = totalsFor(s.rows, w.baselineFrom, w.baselineTo);
      const actionsBefore = actionsOf(before);
      if (before.daysWithData >= LEAGUE_MIN_DAYS && actionsBefore >= LEAGUE_MIN_BASE_ACTIONS) {
        const change = percentOf(actionsBefore, actionsAfter);
        excluded.push({ ...base, reason: `no figures from the same weeks last year, so it is not ranked. Against the four weeks before it joined: ${signed(change)} (that comparison is affected by the time of year)`, beforeJoining: { actionsChange: change, band: bandFor(actionsBefore, actionsAfter) } });
      } else {
        excluded.push({ ...base, reason: 'no figures from the same weeks last year, so it is not ranked' });
      }
      continue;
    }
    const actionsLastYear = actionsOf(lastYear);
    if (actionsLastYear < LEAGUE_MIN_BASE_ACTIONS) {
      excluded.push({ ...base, reason: 'too few customer actions in the same weeks last year for a percentage to mean anything' });
      continue;
    }
    const actionsChange = percentOf(actionsLastYear, actionsAfter);
    const viewsChange = lastYear.views >= 50 ? percentOf(lastYear.views, after.views) : null;
    ranked.push({ ...base, actionsChange, viewsChange, band: bandFor(actionsLastYear, actionsAfter) });
  }
  ranked.sort((a, b) => b.actionsChange - a.actionsChange || (b.viewsChange ?? -Infinity) - (a.viewsChange ?? -Infinity) || a.name.localeCompare(b.name));
  return { ranked: ranked.map((r, i) => ({ rank: i + 1, ...r })), excluded };
}
