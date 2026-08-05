import { describe, it, expect } from 'vitest';
import { retentionDecision, partitionForRetention, RETENTION_GRACE_DAYS } from './retailer-retention';

// This is the code that deletes real records about real businesses, so the
// cases below are weighted towards proving it does NOT delete rather than that
// it does. Every ambiguous input must resolve to "keep".

const NOW = new Date('2026-08-05T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

describe('retentionDecision', () => {
  it('deletes a record delisted longer ago than the grace period', () => {
    const d = retentionDecision({ id: 'a', delisted_at: daysAgo(200) }, NOW);
    expect(d.action).toBe('delete');
    expect(d).toMatchObject({ ageDays: 200 });
  });

  it('keeps a record delisted inside the grace period', () => {
    expect(retentionDecision({ id: 'a', delisted_at: daysAgo(100) }, NOW).action).toBe('keep');
  });

  it('keeps a record still listed', () => {
    expect(retentionDecision({ id: 'a', delisted_at: null }, NOW).action).toBe('keep');
    expect(retentionDecision({ id: 'a' }, NOW).action).toBe('keep');
  });

  it('NEVER deletes a record claimed by a connected account, however old', () => {
    // The one rule that must not be reorderable. A retailer who connected their
    // account has a dashboard and a score history hanging off this row; deleting
    // it because they dropped off a supplier's store locator would take a
    // working account down with them.
    const d = retentionDecision({ id: 'a', user_id: 'u1', delisted_at: daysAgo(9999) }, NOW);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('connected account');
  });

  it('keeps a record with an unparseable delisted_at rather than guessing', () => {
    const d = retentionDecision({ id: 'a', delisted_at: 'not-a-date' }, NOW);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('unparseable');
  });

  it('keeps a record whose delisted_at is in the future', () => {
    // Clock skew or a bad write. Never taken as licence to delete.
    const future = new Date(NOW.getTime() + 86400000).toISOString();
    const d = retentionDecision({ id: 'a', delisted_at: future }, NOW);
    expect(d.action).toBe('keep');
    expect(d.reason).toContain('future');
  });

  it('is exactly-at-the-boundary inclusive, and one day short is not', () => {
    expect(retentionDecision({ id: 'a', delisted_at: daysAgo(RETENTION_GRACE_DAYS) }, NOW).action).toBe('delete');
    expect(retentionDecision({ id: 'a', delisted_at: daysAgo(RETENTION_GRACE_DAYS - 1) }, NOW).action).toBe('keep');
  });

  it('handles a null row rather than throwing', () => {
    expect(retentionDecision(null, NOW).action).toBe('keep');
    expect(retentionDecision(undefined, NOW).action).toBe('keep');
  });

  it('honours a custom grace period', () => {
    expect(retentionDecision({ id: 'a', delisted_at: daysAgo(40) }, NOW, 30).action).toBe('delete');
    expect(retentionDecision({ id: 'a', delisted_at: daysAgo(40) }, NOW, 365).action).toBe('keep');
  });
});

describe('partitionForRetention', () => {
  it('separates deletable from kept and counts both', () => {
    const rows = [
      { id: 'old', delisted_at: daysAgo(300) },
      { id: 'recent', delisted_at: daysAgo(10) },
      { id: 'listed', delisted_at: null },
      { id: 'claimed', user_id: 'u1', delisted_at: daysAgo(300) },
    ];
    const { deletable, kept } = partitionForRetention(rows, NOW);
    expect(deletable.map((d) => d.id)).toEqual(['old']);
    expect(kept).toBe(3);
  });

  it('returns nothing to delete from an empty set', () => {
    const { deletable, kept } = partitionForRetention([], NOW);
    expect(deletable).toEqual([]);
    expect(kept).toBe(0);
  });

  it('carries the reason through, so the log can say why each row went', () => {
    const { deletable } = partitionForRetention([{ id: 'x', delisted_at: daysAgo(400) }], NOW);
    expect(deletable[0].decision.reason).toContain('past the');
  });
});
