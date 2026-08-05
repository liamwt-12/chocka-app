// ── The cohort query behind the league and the operator console ─────────────
//
// One query serves both, because both need the same thing: every retailer in a
// tenant's network, with whichever score may honestly be shown for them.
//
// The pure derivation is separated from the fetch so the interesting part —
// which score wins, what state a retailer is in — is testable without a
// database, and so the query stays a query.
//
// DELIBERATELY NOT MODELLED: invite state. `retailer_invites` distinguishes
// accepted-but-unclaimed from claimed via two separate columns with subtle
// semantics, and the invite flow is on hold pending Tarkett's answer. Guessing
// at that vocabulary now is exactly the rework risk that put the console UI on
// hold, so the console can add it when the flow is settled.

import { resolveRetailerScore } from './retailer-score';
import { type LeagueEntry } from './retailer-league';

/**
 * Where a retailer is in their relationship with the service.
 *
 *   connected — has claimed the record by connecting a Google account
 *   baseline  — exists only as a scraped record; nobody has connected
 *
 * Two states, not five, because those are the two the data can actually
 * distinguish today. See the invite note above.
 */
export type RetailerStatus = 'connected' | 'baseline';

export interface RetailerRow {
  id: string;
  name: string | null;
  town: string | null;
  place_id: string | null;
  score: number | null;
  band: string | null;
  scored_at: string | null;
  match_confidence: string | null;
  user_id: string | null;
  delisted_at: string | null;
  /** Live audit score from the connected profile, when there is one. */
  live_score?: number | null;
  live_scored_at?: string | null;
}

export interface CohortMember extends LeagueEntry {
  status: RetailerStatus;
  /**
   * Absent from the most recent refresh of the source list. Kept as a flag
   * rather than folded into `status`: a delisted retailer who has connected is
   * still a live user, and collapsing the two would hide that.
   */
  delisted: boolean;
  /** The number rests on a scrape match nobody has verified — label it. */
  needsVerification: boolean;
}

/**
 * Turn a raw row into a cohort member, resolving which score applies.
 *
 * Score precedence is NOT decided here — it defers to resolveRetailerScore, so
 * there is exactly one place in the codebase that knows live beats batch and
 * why. Duplicating that rule is how the two drift.
 */
export function toCohortMember(row: RetailerRow): CohortMember {
  const resolved = resolveRetailerScore(
    {
      score: row.score,
      band: row.band,
      scored_at: row.scored_at,
      match_confidence: row.match_confidence,
    },
    row.live_score != null ? { score: row.live_score, scored_at: row.live_scored_at ?? null } : null,
  );

  return {
    id: row.id,
    name: row.name,
    town: row.town,
    score: resolved.score,
    band: resolved.band,
    source: resolved.source,
    scoredAt: resolved.scoredAt,
    placeId: row.place_id,
    matchConfidence: row.match_confidence,
    userId: row.user_id,
    status: row.user_id ? 'connected' : 'baseline',
    delisted: Boolean(row.delisted_at),
    needsVerification: resolved.needsVerification,
  };
}

/**
 * Fetch a tenant's retailer cohort with live scores joined.
 *
 * Tenant-scoped by argument rather than by ambient context: this feeds an
 * operator view that could plausibly be asked for "all tenants", and a filter
 * that is easy to forget is the failure mode the multi-tenancy work keeps
 * running into. Passing null is therefore explicit, not a default.
 */
export async function fetchRetailerCohort(
  supabaseAdmin: any,
  tenantId: string | null,
): Promise<CohortMember[]> {
  let q = supabaseAdmin
    .from('retailers')
    .select('id, name, town, place_id, score, band, scored_at, match_confidence, user_id, delisted_at');
  if (tenantId) q = q.eq('tenant_id', tenantId);

  const { data: retailers, error } = await q;
  if (error) throw error;

  const claimed = (retailers || []).filter((r: RetailerRow) => r.user_id);
  const liveByUser = new Map<string, { score: number | null; scored_at: string | null }>();

  if (claimed.length) {
    // The live score lives on `profiles`, keyed by user. Fetched in one go
    // rather than per retailer — a console listing 180 rows must not become 180
    // round trips.
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('user_id, audit_score, audit_score_after, updated_at')
      .in('user_id', claimed.map((r: RetailerRow) => r.user_id));
    if (pErr) throw pErr;

    for (const p of profiles || []) {
      // audit_score_after is the post-fix re-audit and is the more recent
      // measurement when present.
      const score = p.audit_score_after ?? p.audit_score ?? null;
      liveByUser.set(p.user_id, { score, scored_at: p.updated_at ?? null });
    }
  }

  return (retailers || []).map((r: RetailerRow) => {
    const live = r.user_id ? liveByUser.get(r.user_id) : undefined;
    return toCohortMember({
      ...r,
      live_score: live?.score ?? null,
      live_scored_at: live?.scored_at ?? null,
    });
  });
}

/**
 * Split a cohort by score scale, so each side can be ranked on its own.
 *
 * buildLeague throws on mixed scales by design. This is the intended way to
 * satisfy it: two honest tables rather than one meaningless one.
 */
export function splitByScale(members: CohortMember[]): { batch: CohortMember[]; live: CohortMember[] } {
  return {
    batch: members.filter((m) => m.source === 'batch'),
    live: members.filter((m) => m.source === 'live'),
  };
}
