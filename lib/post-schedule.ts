/**
 * When each profile's weekly post goes out.
 *
 * THE PROBLEM THIS EXISTS TO PREVENT
 * `getNextMonday10am()` gave every profile the *same* timestamp — Monday 10:00
 * exactly. At six profiles that is invisible. At the 180 Stellar retailers it is
 * a thundering herd: post-publisher wakes up, finds 180 posts due in the same
 * second, and walks them in a single sequential loop, each iteration costing a
 * token refresh plus a Business Profile write.
 *
 * Two things break at that size, and only one of them is the API quota:
 *
 *   1. RATE. The project's Business Profile quota is 300 requests/minute. 180
 *      posts cost ~360 requests (one refresh + one write each), so a burst that
 *      completes inside a minute breaches it — and post-publisher is not the
 *      only job awake on a Monday morning.
 *   2. WALL CLOCK. A serverless function has a hard timeout measured in tens of
 *      seconds. 180 sequential round-trips to Google does not fit inside one, so
 *      the run dies part-way through and the posts it never reached stay
 *      `pending_approval` with no error attributable to any one of them.
 *
 * Spreading the posts fixes both at once. Publisher runs every 15 minutes and
 * takes whatever is due, so a 3-hour window turns one 180-post run into twelve
 * runs of ~15 — comfortably inside both the quota and the timeout, with no
 * batching logic anywhere.
 *
 * WHY THE OFFSET IS HASHED AND NOT RANDOM
 * A profile must land in the same slot every time this is asked. Random would
 * mean re-running the generator moved a post, two callers disagreed about when
 * a post was due, and the tests could only assert a range. The hash makes the
 * schedule a pure function of the profile id: stable across runs, across
 * processes, and across deploys, and exactly assertable in a test.
 *
 * TIMEZONE: UK TIME (changed 2026-11-14)
 * This used `setHours`, which is server-local, and production runs UTC, so
 * "10:00" was 10:00 UTC: 11:00 in the UK for half the year. The window is now
 * defined in Europe/London wall-clock time, so a post goes out at the same UK
 * time of day all year, across the clock changes. "Next Monday" is also judged
 * on the UK calendar, so a run late on a Sunday evening UK time is not confused
 * by UTC already being on Monday (or the reverse).
 */

/** First minute of the posting window, in UK (Europe/London) time. */
export const POST_TIMEZONE = 'Europe/London';

export const POST_WINDOW_START_HOUR = 10;

/**
 * How wide the window is, in minutes. 180 minutes over 180 retailers averages
 * one post per minute — two orders of magnitude under the 300/min quota, and
 * small enough that every post still lands on a Monday morning.
 */
export const POST_WINDOW_MINUTES = 180;

/**
 * FNV-1a, 32-bit, mapped onto [0, 1).
 *
 * Chosen for being short, dependency-free and deterministic — not for any
 * cryptographic property. Nothing here is a secret; the only requirement is that
 * the same id always produces the same number, on any machine.
 *
 * `Math.imul` and `>>> 0` keep the arithmetic in 32-bit unsigned space, which is
 * what makes the result identical everywhere rather than drifting once the
 * intermediate value exceeds the safe integer range.
 *
 * The finalising mix is not decoration. Profile ids in any one cohort are short
 * and highly similar, and plain FNV-1a leaves too much structure in the high
 * bits for keys like that — which is exactly the half of the word this function
 * then reads when it divides. Without the mix, 180 sequential ids occupied 78 of
 * 180 minutes; with it, ~115, which is what independent placement should give.
 * The clumping was never severe enough to breach the quota, but a jitter
 * function whose whole job is spreading should actually spread.
 */
export function hashToUnitInterval(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // MurmurHash3 finalizer — avalanches the accumulated bits so that similar
  // inputs stop producing similar outputs.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * Minutes past the start of the window for this profile. Always inside
 * [0, POST_WINDOW_MINUTES).
 */
export function windowOffsetMinutes(profileId: string): number {
  return Math.floor(hashToUnitInterval(profileId) * POST_WINDOW_MINUTES);
}

interface WallClock { year: number; month: number; day: number; weekday: number; hour: number; minute: number }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The UK wall-clock reading of an instant. */
export function ukWallClock(instant: Date): WallClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: POST_TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    weekday: WEEKDAYS[get('weekday')], hour: Number(get('hour')), minute: Number(get('minute')),
  };
}

/** Minutes the UK is ahead of UTC at an instant: 0 in winter, 60 in summer. */
function ukOffsetMinutes(instant: Date): number {
  const w = ukWallClock(instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

/**
 * The instant at which UK clocks read the given date and time. Month is 1-12.
 * Checked twice so a date on either side of a clock change is right. (The
 * posting window, 10:00 to 13:00, never falls in the 01:00 to 02:00 gap or
 * overlap, so no wall time here is ambiguous.)
 */
export function ukWallTimeToUtc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive - ukOffsetMinutes(new Date(naive)) * 60000;
  guess = naive - ukOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

/** Add days to a calendar date, without any timezone involved. */
function addDays(year: number, month: number, day: number, days: number) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The next Monday slot for a profile, in UK time.
 *
 * The day arithmetic keeps the "never today" behaviour of the
 * `getNextMonday10am` it replaced: running this ON a Monday (UK calendar)
 * schedules for the Monday *after*. That is what gives the retailer the
 * preview email and a chance to cancel before anything is published, so it is a
 * property to preserve rather than an off-by-one to tidy up.
 */
export function nextMondaySlot(profileId: string, now: Date = new Date()): Date {
  const today = ukWallClock(now);
  const daysUntilMonday = ((8 - today.weekday) % 7) || 7;
  const monday = addDays(today.year, today.month, today.day, daysUntilMonday);
  const start = ukWallTimeToUtc(monday.year, monday.month, monday.day, POST_WINDOW_START_HOUR);
  return new Date(start.getTime() + windowOffsetMinutes(profileId) * 60000);
}

/** Tomorrow (UK calendar) at the given UK hour. Used for the onboarding first post. */
export function ukTomorrowAt(hour: number, now: Date = new Date()): Date {
  const today = ukWallClock(now);
  const t = addDays(today.year, today.month, today.day, 1);
  return ukWallTimeToUtc(t.year, t.month, t.day, hour);
}
