import { describe, it, expect } from 'vitest';
import {
  nextMondaySlot,
  windowOffsetMinutes,
  hashToUnitInterval,
  POST_WINDOW_MINUTES,
  POST_WINDOW_START_HOUR,
} from './post-schedule';

// The property that matters here is SPREAD: 180 profiles must not land on the
// same timestamp, because that is the burst that breaches the API quota and
// blows the function timeout. The tests are weighted towards proving the spread
// is real and stable rather than towards any particular slot being correct.

// A Friday, so "next Monday" is unambiguous.
const FRIDAY = new Date('2026-08-14T09:00:00');

describe('hashToUnitInterval', () => {
  it('is deterministic for the same key', () => {
    expect(hashToUnitInterval('abc')).toBe(hashToUnitInterval('abc'));
  });

  it('stays inside [0, 1)', () => {
    for (const k of ['', 'a', 'profile-1', 'x'.repeat(500), '🙂']) {
      const v = hashToUnitInterval(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('separates keys that differ by one character', () => {
    expect(hashToUnitInterval('profile-1')).not.toBe(hashToUnitInterval('profile-2'));
  });
});

describe('windowOffsetMinutes', () => {
  it('never falls outside the window', () => {
    for (let i = 0; i < 1000; i++) {
      const o = windowOffsetMinutes(`profile-${i}`);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(POST_WINDOW_MINUTES);
    }
  });

  it('is stable across calls — a post does not move because we asked twice', () => {
    expect(windowOffsetMinutes('abc-123')).toBe(windowOffsetMinutes('abc-123'));
  });
});

describe('nextMondaySlot', () => {
  it('lands on a Monday', () => {
    expect(nextMondaySlot('p1', FRIDAY).getDay()).toBe(1);
  });

  it('schedules the FOLLOWING Monday when run on a Monday', () => {
    // Preserved from getNextMonday10am: this is what leaves time for the preview
    // email to be read and the post cancelled before it publishes.
    const monday = new Date('2026-08-17T09:00:00');
    const slot = nextMondaySlot('p1', monday);
    expect(slot.getDay()).toBe(1);
    expect(slot.getDate()).toBe(24);
  });

  it('starts no earlier than the window start', () => {
    const slot = nextMondaySlot('p1', FRIDAY);
    const minutesPastMidnight = slot.getHours() * 60 + slot.getMinutes();
    expect(minutesPastMidnight).toBeGreaterThanOrEqual(POST_WINDOW_START_HOUR * 60);
  });

  it('ends before the window closes', () => {
    for (let i = 0; i < 500; i++) {
      const slot = nextMondaySlot(`profile-${i}`, FRIDAY);
      const minutesPastMidnight = slot.getHours() * 60 + slot.getMinutes();
      expect(minutesPastMidnight).toBeLessThan(POST_WINDOW_START_HOUR * 60 + POST_WINDOW_MINUTES);
      // Still the same Monday — the window must not roll over into Tuesday.
      expect(slot.getDay()).toBe(1);
    }
  });

  it('gives the same profile the same slot every time', () => {
    const a = nextMondaySlot('stable-id', FRIDAY);
    const b = nextMondaySlot('stable-id', FRIDAY);
    expect(a.toISOString()).toBe(b.toISOString());
  });

  // THE POINT OF THE WHOLE MODULE.
  it('spreads 180 profiles so no minute carries a burst', () => {
    const ids = Array.from({ length: 180 }, (_, i) => `retailer-${i}`);
    const byMinute = new Map<string, number>();
    for (const id of ids) {
      const key = nextMondaySlot(id, FRIDAY).toISOString();
      byMinute.set(key, (byMinute.get(key) || 0) + 1);
    }

    // The old behaviour put all 180 on one timestamp. Anything close to that is
    // the bug coming back.
    const worstMinute = Math.max(...Array.from(byMinute.values()));
    expect(worstMinute).toBeLessThan(10);

    // And they must genuinely use the window, not clump in a corner of it.
    expect(byMinute.size).toBeGreaterThan(POST_WINDOW_MINUTES / 2);
  });

  it('keeps any 15-minute publisher run well inside the quota', () => {
    // post-publisher runs every 15 minutes and costs ~2 Google requests per post
    // (token refresh + create). The quota is 300 requests/minute. This asserts
    // the shape the schedule is designed around: no single publisher run picks
    // up enough posts to matter.
    const ids = Array.from({ length: 180 }, (_, i) => `retailer-${i}`);
    const buckets = new Map<number, number>();
    for (const id of ids) {
      const bucket = Math.floor(windowOffsetMinutes(id) / 15);
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }
    const busiest = Math.max(...Array.from(buckets.values()));
    expect(busiest * 2).toBeLessThan(300);
  });
});
