/**
 * The network league: shops ranked by how much they have IMPROVED since they
 * joined, not by how big they are.
 *
 * A raw-numbers league is won by the biggest shop on the busiest high street
 * every month, whatever anyone does. Ranking by change against each shop's own
 * starting point means a small shop that has grown beats a large one standing
 * still, which is the behaviour the league is meant to reward.
 *
 * MEASURE. Customer actions (calls + website clicks + direction requests) over
 * the latest 28 reportable days, against the 28 days before the shop joined.
 * Views (Search + Maps) are a tie-breaker and shown alongside.
 *
 * WHO IS RANKED. Only shops that have been connected long enough for a full
 * 28-day window after joining, with enough stored days in both windows, and
 * enough actions in the baseline for a percentage to mean anything. Everyone
 * else is listed as "too early" with the reason, never ranked on a guess.
 *
 * OUTPUT carries percentages and bands, never raw call or view counts.
 */
import { totalsFor, addDaysIso, lastReportableDate, type MetricRow } from './metrics';

export const LEAGUE_WINDOW_DAYS = 28;
export const LEAGUE_MIN_DAYS = 24;
export const LEAGUE_MIN_BASE_ACTIONS = 10;

export type ImprovementBand = 'Strong rise' | 'Rising' | 'Steady' | 'Falling';

export function improvementBand(percent: number): ImprovementBand {
  if (percent >= 25) return 'Strong rise';
  if (percent >= 5) return 'Rising';
  if (percent > -5) return 'Steady';
  return 'Falling';
}

export interface LeagueInput { retailerId: string; name: string; town: string | null; activatedOn: string; rows: MetricRow[] }

export interface LeagueEntry {
  rank: number;
  retailerId: string; name: string; town: string | null;
  actionsChange: number; viewsChange: number | null; band: ImprovementBand;
}
export interface LeagueExcluded { retailerId: string; name: string; town: string | null; reason: string }

export function leagueWindows(activatedOn: string, now: Date) {
  const recentTo = lastReportableDate(now);
  return {
    baselineFrom: addDaysIso(activatedOn, -LEAGUE_WINDOW_DAYS),
    baselineTo: addDaysIso(activatedOn, -1),
    recentFrom: addDaysIso(recentTo, -(LEAGUE_WINDOW_DAYS - 1)),
    recentTo,
  };
}

const pct = (before: number, after: number) => Math.round(((after - before) / before) * 100);

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
    const before = totalsFor(s.rows, w.baselineFrom, w.baselineTo);
    const after = totalsFor(s.rows, w.recentFrom, w.recentTo);
    if (before.daysWithData < LEAGUE_MIN_DAYS || after.daysWithData < LEAGUE_MIN_DAYS) {
      excluded.push({ ...base, reason: 'not enough Google figures stored to compare fairly' });
      continue;
    }
    const actionsBefore = before.calls + before.websiteClicks + before.directions;
    const actionsAfter = after.calls + after.websiteClicks + after.directions;
    if (actionsBefore < LEAGUE_MIN_BASE_ACTIONS) {
      excluded.push({ ...base, reason: 'too few customer actions before joining for a percentage to mean anything' });
      continue;
    }
    const actionsChange = pct(actionsBefore, actionsAfter);
    const viewsChange = before.views >= 50 ? pct(before.views, after.views) : null;
    ranked.push({ ...base, actionsChange, viewsChange, band: improvementBand(actionsChange) });
  }
  ranked.sort((a, b) => b.actionsChange - a.actionsChange || (b.viewsChange ?? -Infinity) - (a.viewsChange ?? -Infinity) || a.name.localeCompare(b.name));
  return { ranked: ranked.map((r, i) => ({ rank: i + 1, ...r })), excluded };
}
