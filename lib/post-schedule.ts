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
 * TIMEZONE, STATED RATHER THAN IMPLIED
 * `setHours` is server-local, and production runs UTC — so "10:00" is 10:00 UTC,
 * which is 11:00 UK time under BST. That is inherited behaviour from
 * `getNextMonday10am`, not a decision made here, and it is left alone because
 * changing posting times is a product call rather than a scheduling one. It is
 * written down because a UK-facing product whose "10am" drifts by an hour twice
 * a year is the kind of thing that gets discovered by a confused retailer.
 */

/** First minute of the posting window, server-local (UTC in production). */
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

/**
 * The next Monday slot for a profile.
 *
 * The day arithmetic is deliberately identical to the `getNextMonday10am` it
 * replaces — including its "never today" behaviour, where running this ON a
 * Monday schedules for the Monday *after*. That is what gives the retailer the
 * preview email and a chance to cancel before anything is published, so it is a
 * property to preserve rather than an off-by-one to tidy up.
 */
export function nextMondaySlot(profileId: string, now: Date = new Date()): Date {
  const daysUntilMonday = ((8 - now.getDay()) % 7) || 7;
  const slot = new Date(now);
  slot.setDate(now.getDate() + daysUntilMonday);
  slot.setHours(POST_WINDOW_START_HOUR, 0, 0, 0);
  slot.setMinutes(slot.getMinutes() + windowOffsetMinutes(profileId));
  return slot;
}
