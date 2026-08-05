// ── League ranking and cohort aggregation ───────────────────────────────────
//
// The data layer behind a retailer league and the operator console. Pure — no
// database, no rendering — so the hard-won rules about what these numbers mean
// are testable and cannot be quietly violated by a UI that just wants a number.
//
// FOUR CONSTRAINTS, all from FOLLOWUPS and MATCH_VERIFICATION, all enforced here
// rather than left to whoever writes the page:
//
//   1. NEVER say 180. Three place_id duplicates mean 177 distinct businesses.
//      Both rows stay in the database for traceability, so any count for external
//      consumption must deduplicate.
//   2. Unverifiable rows are EXCLUDED, not zeroed. Seven rows matched a different
//      business and one is permanently closed; carrying them at 0 drags the mean
//      from 75.3 to 72.3 and, worse, publishes a "0" against a real trading
//      business.
//   3. NEVER mix the scales. batch (3 public signals) and live (14 signals over
//      OAuth) are different measurements on the same 0-100 axis. A league that
//      ranks a live 61 above a batch 82 is not measuring anything.
//   4. Date-stamp. A score is a measurement with a time, and the batch ones are
//      2026-06-21 whatever today is.
//
// The API is shaped so that violating any of them takes deliberate effort.

import { type ScoreSource } from './retailer-score';

export interface LeagueEntry {
  id: string;
  name: string | null;
  town?: string | null;
  /** The resolved score — already through resolveRetailerScore, not raw. */
  score: number | null;
  band: string | null;
  source: ScoreSource | null;
  scoredAt: string | null;
  /** Google Places id. Used ONLY to deduplicate; three pairs share one. */
  placeId?: string | null;
  /** 'high' | 'review' | 'not_found' — how well the scrape matched. */
  matchConfidence?: string | null;
  /** Set when a retailer has connected their account. */
  userId?: string | null;
}

export type ExclusionReason =
  | 'no score'
  | 'match not verified'
  | 'duplicate of an earlier row';

export interface RankedEntry extends LeagueEntry {
  /** Competition ranking: ties share a rank and the next rank skips. */
  rank: number;
  /** True when this entry ties with at least one other. */
  tied: boolean;
}

export interface Excluded {
  entry: LeagueEntry;
  reason: ExclusionReason;
}

export interface League {
  scale: ScoreSource;
  ranked: RankedEntry[];
  excluded: Excluded[];
  /** Distinct businesses considered — ranked plus excluded, after dedup. */
  distinctConsidered: number;
}

/**
 * Is this row's score safe to publish next to other people's?
 *
 * `not_found` and `review` both mean the scrape may have scored a DIFFERENT
 * business. Publishing that as this retailer's position in a league attributes a
 * stranger's performance to them, in public, next to their name. Only `high`
 * survives — trust is opt-in, which is the same shape as `needsVerification`.
 */
export function isRankable(e: LeagueEntry): boolean {
  if (e.score === null || e.score === undefined) return false;
  // A live score comes from the retailer's own connected profile, so scrape
  // match confidence is irrelevant to it — there was no matching involved.
  if (e.source === 'live') return true;
  return e.matchConfidence === 'high';
}

/**
 * Rank a cohort, excluding what cannot honestly be ranked.
 *
 * Deduplicates on placeId, keeping the first occurrence: three pairs in the
 * Tarkett list are the same Google profile scored twice, and ranking both would
 * double-count one business and pad the table.
 *
 * THROWS on mixed scales rather than silently producing a meaningless table.
 * That is deliberate: the caller has to decide which measurement it is showing,
 * and the failure should happen in development rather than in front of a
 * retailer.
 */
export function buildLeague(entries: LeagueEntry[]): League {
  const scored = entries.filter((e) => e.score !== null && e.score !== undefined);
  const scales = Array.from(new Set(scored.map((e) => e.source).filter(Boolean))) as ScoreSource[];
  if (scales.length > 1) {
    throw new Error(
      `Refusing to rank across mixed score scales (${scales.join(' + ')}). ` +
        `batch is 3 public signals, live is 14 over OAuth — they are different measurements ` +
        `on the same axis. Split the cohort and rank each, or resolve everything to one scale.`,
    );
  }

  const excluded: Excluded[] = [];
  const seenPlaceIds = new Set<string>();
  const rankable: LeagueEntry[] = [];

  for (const e of entries) {
    if (e.placeId) {
      if (seenPlaceIds.has(e.placeId)) {
        excluded.push({ entry: e, reason: 'duplicate of an earlier row' });
        continue;
      }
      seenPlaceIds.add(e.placeId);
    }
    if (e.score === null || e.score === undefined) {
      excluded.push({ entry: e, reason: 'no score' });
      continue;
    }
    if (!isRankable(e)) {
      excluded.push({ entry: e, reason: 'match not verified' });
      continue;
    }
    rankable.push(e);
  }

  // Descending by score. Name is the tiebreak for a stable order only — it does
  // NOT affect rank, which ties properly below.
  const sorted = rankable.slice().sort((a, b) => {
    if (b.score! !== a.score!) return b.score! - a.score!;
    return (a.name || '').localeCompare(b.name || '');
  });

  const ranked: RankedEntry[] = sorted.map((e, i) => {
    // Competition ranking: equal scores share the lower rank, and the rank after
    // a tie skips. Two firsts are followed by a third, not a second.
    const rank = sorted.findIndex((o) => o.score === e.score) + 1;
    const tied = sorted.filter((o) => o.score === e.score).length > 1;
    return { ...e, rank, tied };
  });

  return {
    scale: (scales[0] as ScoreSource) ?? 'batch',
    ranked,
    excluded,
    distinctConsidered: ranked.length + excluded.filter((x) => x.reason !== 'duplicate of an earlier row').length,
  };
}

export interface CohortStats {
  scale: ScoreSource;
  /** Distinct businesses with a publishable score. */
  n: number;
  mean: number | null;
  median: number | null;
  /** Band → share of n, as a fraction. */
  bandMix: Record<string, number>;
  /** How many were left out, and why — never silently dropped. */
  excluded: Record<ExclusionReason, number>;
  /**
   * The oldest and newest measurement in the set. A cohort statistic without a
   * date is a claim about now, and the batch scores are 2026-06-21 whatever
   * today is — condition 4 of the hard rule.
   */
  measuredFrom: string | null;
  measuredTo: string | null;
}

/**
 * Cohort statistics, computed only over what may honestly be published.
 *
 * Uses the same exclusions as the league, for the same reasons — the mean of a
 * cohort that includes unverified matches is not a statement about Tarkett's
 * network, it is a statement about a scrape.
 */
export function aggregateCohort(entries: LeagueEntry[]): CohortStats {
  const league = buildLeague(entries);
  const scores = league.ranked.map((e) => e.score!).sort((a, b) => a - b);
  const n = scores.length;

  const mean = n ? Math.round((scores.reduce((a, b) => a + b, 0) / n) * 10) / 10 : null;
  const median = n
    ? n % 2
      ? scores[(n - 1) / 2]
      : Math.round(((scores[n / 2 - 1] + scores[n / 2]) / 2) * 10) / 10
    : null;

  const bandMix: Record<string, number> = {};
  for (const e of league.ranked) {
    const b = e.band || '(unbanded)';
    bandMix[b] = (bandMix[b] || 0) + 1;
  }
  for (const b of Object.keys(bandMix)) {
    bandMix[b] = Math.round((bandMix[b] / n) * 1000) / 1000;
  }

  const excluded = { 'no score': 0, 'match not verified': 0, 'duplicate of an earlier row': 0 } as Record<
    ExclusionReason,
    number
  >;
  for (const x of league.excluded) excluded[x.reason]++;

  const dates = league.ranked.map((e) => e.scoredAt).filter(Boolean).sort() as string[];

  return {
    scale: league.scale,
    n,
    mean,
    median,
    bandMix,
    excluded,
    measuredFrom: dates[0] ?? null,
    measuredTo: dates[dates.length - 1] ?? null,
  };
}
