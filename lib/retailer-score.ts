/**
 * Which score to show for a retailer, and how honestly to label it.
 *
 * THE PROBLEM THIS EXISTS TO PREVENT
 * A retailer can have two scores that look comparable and are not:
 *
 *   batch — from the pre-launch scrape (2026-06-21). Public Google Places data
 *           only: star rating, review count, photo count, whether a website is
 *           listed. Scored by tarkett-scraper/lib/publicAudit.ts.
 *   live  — from the 14-signal audit in lib/audit.ts, which runs only after a
 *           retailer connects their Google Business Profile over OAuth. It reads
 *           posts, attributes, review replies, hours and freshness — none of
 *           which the scraper could see.
 *
 * They are different measurements of different things on the same 0-100 scale.
 * A retailer whose batch score was 82 may audit at 61 live, not because anything
 * got worse but because the live audit can see gaps the scrape never could.
 *
 * So: never blend them, never average them, and never draw a trend line between
 * a batch point and a live point as though it showed movement. Show one, say
 * which, and let the difference be visible.
 *
 * PRECEDENCE: live wins when both exist. It sees strictly more, and it is the
 * measurement the retailer can actually act on.
 */

export type ScoreSource = 'batch' | 'live';

/** What the UI shows next to the number so the source is never implicit. */
export type ScoreBadge = 'audited' | 'connected';

export interface RetailerScoreInput {
  /** Batch score from the CSV import. Null if the scrape found nothing. */
  score: number | null;
  band: string | null;
  scored_at: string | null;
  /** 'high' | 'review' | 'not_found' — how well the scrape matched this retailer. */
  match_confidence?: string | null;
}

export interface LiveScoreInput {
  score: number;
  scored_at?: string | null;
}

export interface ResolvedScore {
  score: number | null;
  band: string | null;
  source: ScoreSource | null;
  badge: ScoreBadge | null;
  scoredAt: string | null;
  /**
   * True when a batch score exists but is being superseded by a live one. The UI
   * should NOT render this as a delta or a trend — see the module header. It is
   * here so a caller can say "previously audited at N" as a separate,
   * differently-labelled statement if it wants to.
   */
  supersededBatchScore: number | null;
  /**
   * True when the displayed number rests on a scrape match nobody has verified.
   * 'review' means exactly one of two match tests passed and which one is not
   * recorded, so the row may describe a different business entirely. Callers
   * showing a batch score for such a retailer should qualify it.
   */
  needsVerification: boolean;
}

/** Human-facing label for a badge. Kept here so it cannot drift per component. */
export const BADGE_LABEL: Record<ScoreBadge, string> = {
  audited: 'Audited',
  connected: 'Connected',
};

/**
 * Longer explanation, for a tooltip or caption. Deliberately explicit that the
 * two are not comparable — this is the honesty requirement, not decoration.
 */
export const BADGE_DESCRIPTION: Record<ScoreBadge, string> = {
  audited:
    'Scored from public Google data before launch. Does not include signals that need a connected profile.',
  connected:
    'Scored from the full audit of a connected Google Business Profile. Sees more than the pre-launch scan, so it is not directly comparable to it.',
};

export function resolveRetailerScore(
  retailer: RetailerScoreInput | null | undefined,
  live?: LiveScoreInput | null,
): ResolvedScore {
  const batchScore = retailer?.score ?? null;

  // Live wins outright when present. Note the check is on the live score being a
  // number, not on truthiness: a genuine live score of 0 must still take
  // precedence over a stale batch score, and `0 ||` would silently drop it.
  if (live && typeof live.score === 'number') {
    return {
      score: live.score,
      // Bands come from two different vocabularies — the batch CSV uses
      // Strong/OK/Needs work/At risk/Invisible, and the live audit has its own.
      // Carrying the batch band next to a live score would mislabel it, so it is
      // dropped rather than reused.
      band: null,
      source: 'live',
      badge: 'connected',
      scoredAt: live.scored_at ?? null,
      supersededBatchScore: batchScore,
      // A live score stands on OAuth data for a profile the retailer themselves
      // connected. Whatever the scrape once guessed about matching is no longer
      // load-bearing.
      needsVerification: false,
    };
  }

  if (batchScore === null) {
    return {
      score: null, band: null, source: null, badge: null, scoredAt: null,
      supersededBatchScore: null, needsVerification: false,
    };
  }

  return {
    score: batchScore,
    band: retailer?.band ?? null,
    source: 'batch',
    badge: 'audited',
    scoredAt: retailer?.scored_at ?? null,
    supersededBatchScore: null,
    // Trust is OPT-IN: only an explicit 'high' means "quote this number at the
    // retailer". This was `=== 'review'`, which made every other value —
    // 'not_found', null, and anything a future import invents — read as
    // trustworthy. That was not theoretical: the 8 `not_found` rows carried
    // score 0 and band "Invisible", and `send-invites.ts` gates on
    // `score !== null && !needsVerification`, so 0 sailed through. Had sending
    // been unblocked, 8 real businesses would have been cold-emailed to be told
    // they scored 0 out of 100, badged "Audited" — one of which actually scores
    // 98. Inverted so the failure mode is withholding a good score, not
    // publishing a wrong one.
    needsVerification: retailer?.match_confidence !== 'high',
  };
}
