/**
 * The network's rating, and the share of its reviews that have been answered.
 *
 * WHAT A MARKETING TEAM WANTS TO SAY UPWARD: "our dealers average 4.6 from
 * 3,100 reviews, and four in five have an answer." Until now neither could be
 * said: ratings were read for one shop at a time and never kept.
 *
 * THE NOTE. Once a day, when the figures job is already talking to Google for
 * a listing, it reads the listing's reviews and keeps four totals: Google's
 * average rating, Google's count of reviews, how many we could read, and how
 * many of those have an owner's reply. No review text, no reviewer.
 *
 * THE NETWORK FIGURE. Added up across LIVE shops only (a listing nobody has
 * confirmed may not be the shop's), from notes no older than MAX_AGE_DAYS:
 *   rating          every review counted once: the sum of each shop's rating
 *                   times its number of reviews, over all the reviews. A shop
 *                   with 400 reviews weighs more than one with 4, as it would
 *                   if the network were one listing
 *   share answered  reviews with a reply, over reviews read
 * NEVER FROM FEWER THAN THREE SHOPS (the same rule as every other network
 * total: lib/network-summary.ts). A "network rating" of two shops is those
 * two shops' ratings.
 *
 * It says what the figures are. It does not say what moved them.
 *
 * Pure.
 */

/** A note older than this is left out of the network figure. */
export const MAX_AGE_DAYS = 14;
/** The same floor as every other network total. */
export const MIN_SHOPS = 3;

export interface ReviewSnapshot { rating: number | null; count: number; read: number; answered: number }

/**
 * The four totals from what Google returned for one listing. `reviews` is
 * every review we could read; `averageRating` and `totalReviewCount` are
 * Google's own. When Google gives no average (it does not for a listing with
 * no reviews), the rating is worked out from the reviews read, or is null.
 */
export function snapshotFrom(data: { reviews?: any[] | null; averageRating?: number; totalReviewCount?: number } | null | undefined, starsOf: (starRating: string) => number): ReviewSnapshot {
  const reviews = data?.reviews || [];
  const read = reviews.length;
  const answered = reviews.filter((r) => !!r?.reviewReply).length;
  const count = Number.isInteger(data?.totalReviewCount) && (data!.totalReviewCount as number) >= read ? (data!.totalReviewCount as number) : read;
  let rating: number | null = null;
  if (typeof data?.averageRating === 'number' && data.averageRating > 0 && data.averageRating <= 5) rating = Math.round(data.averageRating * 100) / 100;
  else {
    const stars = reviews.map((r) => starsOf(r?.starRating)).filter((n) => n >= 1 && n <= 5);
    if (stars.length) rating = Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 100) / 100;
  }
  return { rating, count, read, answered };
}

/** The columns to write for a snapshot. */
export function snapshotColumns(s: ReviewSnapshot, now: Date): Record<string, unknown> {
  return { review_rating: s.rating, review_count: s.count, reviews_read: s.read, reviews_answered: s.answered, review_snapshot_at: now.toISOString() };
}

export interface ShopReviews {
  live: boolean;
  rating: number | null | undefined;
  count: number | null | undefined;
  read: number | null | undefined;
  answered: number | null | undefined;
  snapshotAt: string | null | undefined;
}

export interface NetworkReviews {
  /** The network's rating to one decimal place, or null when it cannot be given. */
  rating: number | null;
  /** How many reviews that rating is from, and across how many shops. */
  totalReviews: number | null;
  ratedShops: number;
  /** Whole percent of reviews read that have an owner's reply, or null. */
  shareAnswered: number | null;
  answeredShops: number;
  /** Live shops with no recent note, so the reader knows what is missing. */
  shopsWithoutFigures: number;
  note: string;
}

export function networkReviews(shops: ShopReviews[], now: Date = new Date()): NetworkReviews {
  const live = shops.filter((s) => s.live);
  const cutoff = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const fresh = live.filter((s) => !!s.snapshotAt && Date.parse(s.snapshotAt) >= cutoff);
  const rated = fresh.filter((s) => typeof s.rating === 'number' && (s.count || 0) > 0);
  const readable = fresh.filter((s) => (s.read || 0) > 0);

  const totalReviews = rated.reduce((t, s) => t + (s.count as number), 0);
  const rating = rated.length >= MIN_SHOPS ? Math.round((rated.reduce((t, s) => t + (s.rating as number) * (s.count as number), 0) / totalReviews) * 10) / 10 : null;
  const read = readable.reduce((t, s) => t + (s.read as number), 0);
  const answered = readable.reduce((t, s) => t + Math.min(s.answered || 0, s.read as number), 0);
  const shareAnswered = readable.length >= MIN_SHOPS ? Math.round((answered / read) * 100) : null;

  const without = live.length - fresh.length;
  const note = !live.length ? 'No shop is live yet.'
    : rating === null && shareAnswered === null
      ? (fresh.length ? `Only ${rated.length} live shop${rated.length === 1 ? ' has' : 's have'} reviews on record so far. These figures are shown from ${MIN_SHOPS} shops, so that a network figure is never one shop's own.` : 'No review figures have been read for the live shops yet. They are read once a day.')
      : `From ${rated.length} live shop${rated.length === 1 ? '' : 's'} with reviews.${without ? ` ${without} live shop${without === 1 ? ' has' : 's have'} no recent figures and ${without === 1 ? 'is' : 'are'} left out.` : ''} The rating counts every review once, so a shop with many reviews weighs more than one with few.`;
  return { rating, totalReviews: rating === null ? null : totalReviews, ratedShops: rated.length, shareAnswered, answeredShops: readable.length, shopsWithoutFigures: without, note };
}
