/**
 * Public-audit scoring — Chocka.
 *
 * Scores a business purely from public Google data via the Places API (New),
 * with no OAuth / Business Profile access. This is the engine behind Chocka's
 * public "how visible are you on Google?" audit: given a name + location we
 * find the place, pull its public details, and score it out of 100.
 *
 * The scoring functions are pure and side-effect free so they can be unit
 * tested and reused directly by the web app. The Places client functions read
 * the API key from the same env var the rest of the app uses
 * (GOOGLE_PLACES_API_KEY) — never hardcode it.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not set');
  return key;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlaceCandidate {
  placeId: string;
  name: string;
  formattedAddress: string;
  location?: { latitude: number; longitude: number };
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  rating: number | null;
  reviews: number; // user_ratings_total
  businessStatus: string | null; // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  hasHours: boolean;
  website: string | null;
  photoCount: number;
  phone: string | null;
  formattedAddress: string;
}

export type MatchConfidence = 'high' | 'review' | 'not_found';

export interface ScoreBreakdown {
  rating: number;
  reviews: number;
  completeness: number;
  completenessParts: {
    hasHours: boolean;
    hasWebsite: boolean;
    hasPhotos: boolean; // >= 5
    operational: boolean;
  };
}

export type Band = 'Strong' | 'OK' | 'Needs work' | 'At risk' | 'Invisible';

export interface AuditScore {
  score: number; // 0-100, rounded
  band: Band;
  breakdown: ScoreBreakdown;
  headlineGap: string;
}

// ── Scoring (pure) ───────────────────────────────────────────────────────────

/** Rating: 35 pts, scaled ((rating-3)/2)*35, clamped 0-35, 0 if no rating. */
export function scoreRating(rating: number | null): number {
  if (!rating || rating <= 0) return 0;
  const raw = ((rating - 3) / 2) * 35;
  return Math.max(0, Math.min(35, raw));
}

/** Reviews: 40 pts, banded by user_ratings_total. */
export function scoreReviews(reviews: number): number {
  const n = reviews || 0;
  if (n >= 200) return 40;
  if (n >= 100) return 36;
  if (n >= 50) return 30;
  if (n >= 25) return 24;
  if (n >= 10) return 16;
  if (n >= 1) return 8;
  return 0;
}

/** Completeness: 25 pts split evenly across four public signals. */
export function scoreCompleteness(d: Pick<PlaceDetails, 'hasHours' | 'website' | 'photoCount' | 'businessStatus'>): {
  points: number;
  parts: ScoreBreakdown['completenessParts'];
} {
  const parts = {
    hasHours: d.hasHours,
    hasWebsite: !!d.website,
    hasPhotos: (d.photoCount || 0) >= 5,
    operational: d.businessStatus === 'OPERATIONAL',
  };
  const each = 25 / 4; // 6.25
  const points = Object.values(parts).filter(Boolean).length * each;
  return { points, parts };
}

/** Band a 0-100 score. NOT FOUND places are Invisible regardless of score. */
export function bandFor(score: number, found: boolean): Band {
  if (!found) return 'Invisible';
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'OK';
  if (score >= 40) return 'Needs work';
  return 'At risk';
}

/**
 * The single biggest opportunity, as a human-readable one-liner. Picks the
 * category with the largest point deficit so the headline matches where the
 * score is actually being lost.
 */
export function headlineGapFor(d: PlaceDetails, b: ScoreBreakdown): string {
  const ratingLoss = 35 - b.rating;
  const reviewsLoss = 40 - b.reviews;
  const each = 25 / 4;

  const gaps: { loss: number; msg: string }[] = [];

  if (!d.rating) gaps.push({ loss: 35, msg: 'No star rating yet — not enough reviews to show one' });
  else gaps.push({ loss: ratingLoss, msg: `Rating is ${d.rating.toFixed(1)} — below the 5.0 ceiling` });

  if (d.reviews === 0) gaps.push({ loss: 40, msg: 'No reviews at all — invisible in "best rated" searches' });
  else if (d.reviews >= 100) gaps.push({ loss: reviewsLoss, msg: `${d.reviews} reviews — push past 200 to max the trust signal` });
  else gaps.push({ loss: reviewsLoss, msg: `Only ${d.reviews} review${d.reviews === 1 ? '' : 's'} — needs more to build trust` });

  if (!b.completenessParts.operational) gaps.push({ loss: each, msg: `Business status is ${d.businessStatus || 'unknown'} on Google` });
  if (!b.completenessParts.hasWebsite) gaps.push({ loss: each, msg: 'No website link on the profile' });
  if (!b.completenessParts.hasHours) gaps.push({ loss: each, msg: 'No opening hours set' });
  if (!b.completenessParts.hasPhotos) gaps.push({ loss: each, msg: `Only ${d.photoCount} photo${d.photoCount === 1 ? '' : 's'} — aim for 5+` });

  gaps.sort((a, z) => z.loss - a.loss);
  // If everything is maxed, say so.
  if (gaps[0].loss <= 0) return 'Profile is in great shape — keep reviews coming';
  return gaps[0].msg;
}

/** Score a matched place out of 100, with banding and headline gap. */
export function scorePlace(d: PlaceDetails): AuditScore {
  const rating = scoreRating(d.rating);
  const reviews = scoreReviews(d.reviews);
  const { points: completeness, parts } = scoreCompleteness(d);
  const breakdown: ScoreBreakdown = { rating, reviews, completeness, completenessParts: parts };
  const score = Math.round(rating + reviews + completeness);
  return {
    score,
    band: bandFor(score, true),
    breakdown,
    headlineGap: headlineGapFor(d, breakdown),
  };
}

/** The score we record when no credible place was found. A real result. */
export function invisibleScore(): AuditScore {
  return {
    score: 0,
    band: 'Invisible',
    breakdown: {
      rating: 0,
      reviews: 0,
      completeness: 0,
      completenessParts: { hasHours: false, hasWebsite: false, hasPhotos: false, operational: false },
    },
    headlineGap: 'No Google Business Profile found — invisible on Google Maps & Search',
  };
}

// ── Match confidence (pure) ──────────────────────────────────────────────────

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(ltd|limited|llp|plc|co|company|the|uk|flooring|floors|carpets?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalisePostcode(s: string): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Token Jaccard similarity, 0-1. */
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normaliseName(a).split(' ').filter(Boolean));
  const tb = new Set(normaliseName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

/** Does the candidate's formatted address contain the row's postcode? */
function postcodeMatches(rowPostcode: string, candidateAddress: string): boolean {
  const pc = normalisePostcode(rowPostcode);
  if (!pc) return false;
  return normalisePostcode(candidateAddress).includes(pc);
}

/**
 * Classify how confident we are that `candidate` is `rowName @ rowPostcode`.
 *  - high   : strong name match AND postcode match
 *  - review : one of the two matches (worth a human glance)
 *  - not_found : neither — treat as no credible match
 */
export function classifyMatch(
  rowName: string,
  rowPostcode: string,
  candidate: PlaceCandidate
): MatchConfidence {
  const sim = nameSimilarity(rowName, candidate.name);
  const na = normaliseName(rowName);
  const nb = normaliseName(candidate.name);
  const nameStrong = sim >= 0.6 || (na.length > 0 && (nb.includes(na) || na.includes(nb)));
  const pc = postcodeMatches(rowPostcode, candidate.formattedAddress);

  if (nameStrong && pc) return 'high';
  if (nameStrong || pc) return 'review';
  return 'not_found';
}

// ── Places API (New) client ──────────────────────────────────────────────────

async function placesFetch(url: string, init: RequestInit, fieldMask: string): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': fieldMask,
    },
  });
}

/** One retrying request with exponential backoff on 429/5xx. */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = 800 * Math.pow(2, i);
      console.warn(`[publicAudit] ${label} failed (attempt ${i + 1}/${attempts}): ${(e as Error).message}; retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * Find the best candidate place for "name, postcode", biased to the row's
 * lat/lng. Returns the top candidate (with its match confidence) or null if
 * the API returned nothing.
 */
export async function findPlace(
  name: string,
  postcode: string,
  lat?: number,
  lng?: number
): Promise<{ candidate: PlaceCandidate; confidence: MatchConfidence } | null> {
  const body: Record<string, unknown> = {
    textQuery: `${name}, ${postcode}`,
    languageCode: 'en',
    regionCode: 'GB',
    maxResultCount: 5,
  };
  if (typeof lat === 'number' && typeof lng === 'number') {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 5000 } };
  }

  const data = await withRetry(async () => {
    const res = await placesFetch(
      `${PLACES_BASE}/places:searchText`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'places.id,places.displayName,places.formattedAddress,places.location'
    );
    if (!res.ok) throw new Error(`searchText ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }, `findPlace("${name}")`);

  const places: any[] = data.places || [];
  if (!places.length) return null;

  // Pick the candidate with the best confidence (high > review > not_found),
  // breaking ties by API order (already relevance-ranked).
  const rank: Record<MatchConfidence, number> = { high: 2, review: 1, not_found: 0 };
  let best: { candidate: PlaceCandidate; confidence: MatchConfidence } | null = null;
  for (const p of places) {
    const candidate: PlaceCandidate = {
      placeId: p.id,
      name: p.displayName?.text || '',
      formattedAddress: p.formattedAddress || '',
      location: p.location,
    };
    const confidence = classifyMatch(name, postcode, candidate);
    if (!best || rank[confidence] > rank[best.confidence]) best = { candidate, confidence };
    if (best.confidence === 'high') break;
  }
  return best;
}

/** Pull public details for a matched place_id. */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const mask = [
    'id',
    'displayName',
    'rating',
    'userRatingCount',
    'businessStatus',
    'regularOpeningHours',
    'websiteUri',
    'photos',
    'nationalPhoneNumber',
    'internationalPhoneNumber',
    'formattedAddress',
  ].join(',');

  const p = await withRetry(async () => {
    const res = await placesFetch(`${PLACES_BASE}/places/${placeId}`, { method: 'GET' }, mask);
    if (!res.ok) throw new Error(`details ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }, `getPlaceDetails(${placeId})`);

  return {
    placeId: p.id || placeId,
    name: p.displayName?.text || '',
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviews: p.userRatingCount || 0,
    businessStatus: p.businessStatus || null,
    hasHours: !!(p.regularOpeningHours?.periods?.length || p.regularOpeningHours?.weekdayDescriptions?.length),
    website: p.websiteUri || null,
    photoCount: Array.isArray(p.photos) ? p.photos.length : 0,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || null,
    formattedAddress: p.formattedAddress || '',
  };
}
