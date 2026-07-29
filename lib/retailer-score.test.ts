import { describe, it, expect } from 'vitest';
import { resolveRetailerScore, BADGE_LABEL, BADGE_DESCRIPTION } from './retailer-score';

const batch = (score: number | null, extra: Record<string, unknown> = {}) => ({
  score,
  band: score === null ? null : 'Strong',
  scored_at: '2026-06-21T12:04:47.808Z',
  match_confidence: 'high',
  ...extra,
});

describe('resolveRetailerScore — precedence', () => {
  it('shows the batch score when there is no live one', () => {
    const r = resolveRetailerScore(batch(82));
    expect(r).toMatchObject({ score: 82, source: 'batch', badge: 'audited' });
    expect(r.scoredAt).toBe('2026-06-21T12:04:47.808Z');
  });

  it('prefers the live score when both exist', () => {
    const r = resolveRetailerScore(batch(82), { score: 61 });
    expect(r).toMatchObject({ score: 61, source: 'live', badge: 'connected' });
  });

  // The regression this guards: `live.score || batch` would drop a real 0 and
  // silently fall back to a stale batch number.
  it('prefers a live score of 0 over a batch score', () => {
    const r = resolveRetailerScore(batch(82), { score: 0 });
    expect(r.score).toBe(0);
    expect(r.source).toBe('live');
  });

  it('returns an empty result when neither exists', () => {
    expect(resolveRetailerScore(batch(null))).toMatchObject({
      score: null, source: null, badge: null,
    });
  });

  it('handles a null or undefined retailer', () => {
    expect(resolveRetailerScore(null).score).toBeNull();
    expect(resolveRetailerScore(undefined).score).toBeNull();
  });
});

describe('resolveRetailerScore — keeping the two measurements apart', () => {
  // The whole point of the module: batch and live are different measurements on
  // the same scale, so nothing may present them as one series.
  it('never blends the two into an average', () => {
    const r = resolveRetailerScore(batch(82), { score: 61 });
    expect(r.score).toBe(61);
    expect(r.score).not.toBe(Math.round((82 + 61) / 2));
  });

  it('exposes the superseded batch score separately rather than as a delta', () => {
    const r = resolveRetailerScore(batch(82), { score: 61 });
    expect(r.supersededBatchScore).toBe(82);
    // No delta/trend field is offered at all — a caller cannot render movement
    // without deliberately computing it and owning that choice.
    expect(r).not.toHaveProperty('delta');
    expect(r).not.toHaveProperty('trend');
  });

  it('drops the batch band when showing a live score', () => {
    // The two use different band vocabularies; carrying one across would
    // mislabel the other.
    const r = resolveRetailerScore(batch(82), { score: 61 });
    expect(r.band).toBeNull();
  });

  it('keeps the batch band when showing a batch score', () => {
    expect(resolveRetailerScore(batch(82)).band).toBe('Strong');
  });
});

describe('resolveRetailerScore — verification flag', () => {
  it('flags a batch score built on an unverified match', () => {
    expect(resolveRetailerScore(batch(78, { match_confidence: 'review' })).needsVerification).toBe(true);
  });

  it('does not flag a high-confidence batch match', () => {
    expect(resolveRetailerScore(batch(78, { match_confidence: 'high' })).needsVerification).toBe(false);
  });

  it('does not flag a live score even if the old scrape match was unverified', () => {
    // Once the retailer connects their own profile, the scrape's guess about
    // which business this was stops being load-bearing.
    const r = resolveRetailerScore(batch(78, { match_confidence: 'review' }), { score: 64 });
    expect(r.needsVerification).toBe(false);
  });
});

describe('badge copy', () => {
  it('has a label and description for both badges', () => {
    for (const b of ['audited', 'connected'] as const) {
      expect(BADGE_LABEL[b]).toBeTruthy();
      expect(BADGE_DESCRIPTION[b]).toBeTruthy();
    }
  });

  it('the connected description warns that the two are not comparable', () => {
    expect(BADGE_DESCRIPTION.connected).toMatch(/not directly comparable/i);
  });
});
