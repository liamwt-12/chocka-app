import { describe, it, expect } from 'vitest';
import { buildLeague, aggregateCohort, isRankable, type LeagueEntry } from './retailer-league';
import { toCohortMember, splitByScale, type RetailerRow } from './retailer-cohort';

// These tests are mostly about the FOUR CONSTRAINTS from FOLLOWUPS and
// MATCH_VERIFICATION, not about arithmetic. Getting a mean wrong is a bug;
// publishing a "0" against a real trading business, or ranking a live score
// against a batch one, is a different category of wrong.

// Key PRESENCE, not `??`. `o.score ?? 80` turns an explicit `score: null` back
// into 80, so the null cases would silently test nothing — the same class of bug
// resolveRetailerScore's own comment warns about with `0 ||`. Caught by these
// tests failing, which is the system working.
const pick = <K extends keyof LeagueEntry>(o: Partial<LeagueEntry>, k: K, fallback: LeagueEntry[K]) =>
  (k in o ? o[k] : fallback) as LeagueEntry[K];

const e = (o: Partial<LeagueEntry>): LeagueEntry => ({
  id: pick(o, 'id', 'x'),
  name: pick(o, 'name', 'Shop'),
  score: pick(o, 'score', 80),
  band: pick(o, 'band', 'Strong'),
  source: pick(o, 'source', 'batch'),
  scoredAt: pick(o, 'scoredAt', '2026-06-21T12:00:00Z'),
  placeId: pick(o, 'placeId', undefined),
  matchConfidence: pick(o, 'matchConfidence', 'high'),
  userId: pick(o, 'userId', undefined),
  town: pick(o, 'town', undefined),
});

describe('isRankable', () => {
  it('requires a verified match for a batch score', () => {
    expect(isRankable(e({ matchConfidence: 'high' }))).toBe(true);
    expect(isRankable(e({ matchConfidence: 'review' }))).toBe(false);
    expect(isRankable(e({ matchConfidence: 'not_found' }))).toBe(false);
    expect(isRankable(e({ matchConfidence: null }))).toBe(false);
  });

  it('does not require a match for a live score — nothing was matched', () => {
    // A live score comes from the retailer's own connected profile. Scrape match
    // confidence is simply not a property of it.
    expect(isRankable(e({ source: 'live', matchConfidence: 'not_found' }))).toBe(true);
  });

  it('is false without a score', () => {
    expect(isRankable(e({ score: null }))).toBe(false);
  });
});

describe('buildLeague', () => {
  it('ranks descending', () => {
    const l = buildLeague([e({ id: 'a', score: 70 }), e({ id: 'b', score: 90 }), e({ id: 'c', score: 80 })]);
    expect(l.ranked.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(l.ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('uses competition ranking — ties share a rank and the next one skips', () => {
    const l = buildLeague([
      e({ id: 'a', score: 90, name: 'A' }),
      e({ id: 'b', score: 90, name: 'B' }),
      e({ id: 'c', score: 70 }),
    ]);
    expect(l.ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(l.ranked.map((r) => r.tied)).toEqual([true, true, false]);
  });

  it('EXCLUDES an unverified match rather than ranking it', () => {
    // Constraint 2. Ranking a `review` row publishes a possibly-different
    // business's performance against this retailer's name.
    const l = buildLeague([e({ id: 'ok' }), e({ id: 'unsure', matchConfidence: 'review' })]);
    expect(l.ranked.map((r) => r.id)).toEqual(['ok']);
    expect(l.excluded).toEqual([expect.objectContaining({ reason: 'match not verified' })]);
  });

  it('EXCLUDES an unscored row rather than treating it as zero', () => {
    // Zeroing the 8 unverifiable rows moves the cohort mean from 75.3 to 72.3,
    // and puts a "0" next to a real trading business.
    const l = buildLeague([e({ id: 'ok', score: 80 }), e({ id: 'none', score: null })]);
    expect(l.ranked).toHaveLength(1);
    expect(l.excluded[0].reason).toBe('no score');
  });

  it('deduplicates on placeId — three pairs are the same Google profile twice', () => {
    // Constraint 1. Both rows stay in the database for traceability, but a
    // league that lists both double-counts one business.
    const l = buildLeague([
      e({ id: 'burts-1', name: 'Burts Carpets of Darlington', placeId: 'P1', score: 85 }),
      e({ id: 'burts-2', name: 'Burts of Darlington', placeId: 'P1', score: 85 }),
      e({ id: 'other', placeId: 'P2', score: 70 }),
    ]);
    expect(l.ranked.map((r) => r.id)).toEqual(['burts-1', 'other']);
    expect(l.excluded[0].reason).toBe('duplicate of an earlier row');
  });

  it('THROWS on mixed scales rather than producing a meaningless table', () => {
    // Constraint 3, and the most important test here. batch is 3 public signals,
    // live is 14 over OAuth. A table ranking one against the other is not
    // measuring anything, and it would look completely normal.
    expect(() =>
      buildLeague([e({ id: 'a', source: 'batch' }), e({ id: 'b', source: 'live' })]),
    ).toThrow(/mixed score scales/);
  });

  it('does not throw when only one scale is present', () => {
    expect(() => buildLeague([e({ source: 'live' }), e({ source: 'live' })])).not.toThrow();
  });

  it('handles an empty cohort', () => {
    const l = buildLeague([]);
    expect(l.ranked).toEqual([]);
    expect(l.distinctConsidered).toBe(0);
  });
});

describe('aggregateCohort', () => {
  it('computes mean and median over the publishable rows only', () => {
    const s = aggregateCohort([
      e({ id: 'a', score: 60 }), e({ id: 'b', score: 80 }), e({ id: 'c', score: 100 }),
      e({ id: 'skip', score: 0, matchConfidence: 'not_found' }),
    ]);
    expect(s.n).toBe(3);
    expect(s.mean).toBe(80);
    expect(s.median).toBe(80);
    // The excluded zero would have dragged the mean to 60 — the exact shape of
    // the 75.3 vs 72.3 problem.
    expect(s.excluded['match not verified']).toBe(1);
  });

  it('averages the middle pair for an even count', () => {
    const s = aggregateCohort([e({ id: 'a', score: 70 }), e({ id: 'b', score: 81 })]);
    expect(s.median).toBe(75.5);
  });

  it('reports the band mix as shares', () => {
    const s = aggregateCohort([
      e({ id: 'a', band: 'Strong' }), e({ id: 'b', band: 'Strong' }), e({ id: 'c', band: 'OK' }),
    ]);
    expect(s.bandMix.Strong).toBeCloseTo(0.667, 2);
    expect(s.bandMix.OK).toBeCloseTo(0.333, 2);
  });

  it('carries the measurement dates, so a figure is never undated', () => {
    // Constraint 4: batch scores are 2026-06-21 whatever today is.
    const s = aggregateCohort([
      e({ id: 'a', scoredAt: '2026-06-21T12:00:00Z' }),
      e({ id: 'b', scoredAt: '2026-07-30T09:00:00Z' }),
    ]);
    expect(s.measuredFrom).toBe('2026-06-21T12:00:00Z');
    expect(s.measuredTo).toBe('2026-07-30T09:00:00Z');
  });

  it('returns nulls rather than NaN for an empty cohort', () => {
    const s = aggregateCohort([]);
    expect(s.n).toBe(0);
    expect(s.mean).toBeNull();
    expect(s.median).toBeNull();
  });
});

describe('toCohortMember', () => {
  const row = (o: Partial<RetailerRow>): RetailerRow => ({
    id: 'r1', name: 'Shop', town: 'Leeds', place_id: 'P1', score: 82, band: 'Strong',
    scored_at: '2026-06-21T12:00:00Z', match_confidence: 'high', user_id: null, delisted_at: null,
    ...o,
  });

  it('uses the batch score when nobody has connected', () => {
    const m = toCohortMember(row({}));
    expect(m).toMatchObject({ score: 82, source: 'batch', status: 'baseline' });
  });

  it('lets the live score win once connected', () => {
    const m = toCohortMember(row({ user_id: 'u1', live_score: 61 }));
    expect(m).toMatchObject({ score: 61, source: 'live', status: 'connected' });
    // Band is dropped with a live score — the two vocabularies differ, and
    // carrying the batch band would mislabel the number.
    expect(m.band).toBeNull();
  });

  it('keeps delisted as a flag, not a status', () => {
    // A delisted retailer who has connected is still a live user; collapsing the
    // two into one status would hide that.
    const m = toCohortMember(row({ user_id: 'u1', delisted_at: '2026-01-01T00:00:00Z' }));
    expect(m.status).toBe('connected');
    expect(m.delisted).toBe(true);
  });

  it('flags a batch score resting on an unverified match', () => {
    expect(toCohortMember(row({ match_confidence: 'review' })).needsVerification).toBe(true);
    expect(toCohortMember(row({ match_confidence: 'high' })).needsVerification).toBe(false);
  });
});

describe('splitByScale', () => {
  it('separates the two scales so each can be ranked on its own', () => {
    const members = [
      toCohortMember({ id: 'a', name: 'A', town: null, place_id: null, score: 80, band: 'Strong',
        scored_at: null, match_confidence: 'high', user_id: null, delisted_at: null }),
      toCohortMember({ id: 'b', name: 'B', town: null, place_id: null, score: 80, band: 'Strong',
        scored_at: null, match_confidence: 'high', user_id: 'u1', delisted_at: null, live_score: 61 }),
    ];
    const { batch, live } = splitByScale(members);
    expect(batch.map((m) => m.id)).toEqual(['a']);
    expect(live.map((m) => m.id)).toEqual(['b']);
    // And each side ranks without throwing, which is the point of splitting.
    expect(() => buildLeague(batch)).not.toThrow();
    expect(() => buildLeague(live)).not.toThrow();
  });
});
