import { DAILY_METRICS, parseMultiDailyMetrics, totalsFor, isoDate, addDaysIso, type MetricRow } from './metrics';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GBP_API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const GBP_POSTS_BASE = 'https://mybusiness.googleapis.com/v4';

// Account-level roles that grant management of a listing. Used to filter the
// accounts we enumerate down to ones the user can actually act on. This is a
// heuristic — a role-manageable account can still hold a location the user
// lacks per-location rights on, which is caught at read time (403) instead.
const MANAGE_ROLES = new Set(['PRIMARY_OWNER', 'OWNER', 'MANAGER', 'SITE_MANAGER']);

// Error that carries Google's HTTP status and canonical status string
// (e.g. PERMISSION_DENIED) so callers can map failures to honest messages
// instead of a generic crash.
export class GbpError extends Error {
  status: number;
  googleStatus: string | null;
  constructor(message: string, status: number, googleStatus: string | null) {
    super(message);
    this.name = 'GbpError';
    this.status = status;
    this.googleStatus = googleStatus;
  }
}

/**
 * A failed sign-in refresh. `deadGrant` is true only when Google said the
 * stored permission itself is gone (invalid_grant: revoked, expired, password
 * changed). Anything else, a 429 or a 5xx, means Google could not answer just
 * now and the connection is still good. Only a dead grant may ever mark a shop
 * as disconnected; see isDeadGrant.
 */
export class GoogleAuthError extends Error {
  status: number;
  deadGrant: boolean;
  constructor(message: string, status: number, deadGrant: boolean) {
    super(message);
    this.name = 'GoogleAuthError';
    this.status = status;
    this.deadGrant = deadGrant;
  }
}

/** Is this error Google telling us the shop's permission is gone for good? */
export function isDeadGrant(err: unknown): boolean {
  if (err instanceof GoogleAuthError) return err.deadGrant;
  return /invalid_grant/.test(String((err as any)?.message ?? ''));
}

async function gbpError(res: Response, context: string): Promise<GbpError> {
  const text = await res.text();
  let googleStatus: string | null = null;
  try { googleStatus = JSON.parse(text)?.error?.status ?? null; } catch {}
  return new GbpError(`${context}: ${text}`, res.status, googleStatus);
}

export interface Listing {
  accountName: string;     // e.g. "accounts/123"
  accountDisplay: string;  // human name of the account/group, may be ''
  accountType: string;     // PERSONAL | LOCATION_GROUP | ORGANIZATION | ...
  accountRole: string;     // PRIMARY_OWNER | OWNER | MANAGER | SITE_MANAGER
  locationName: string;    // e.g. "locations/456"
  title: string;
  address: string;
  latitude?: number;
  longitude?: number;
  category: string;

  /**
   * Google Places id, parsed out of the location's own `metadata.mapsUri`.
   *
   * FREE. It arrives on the enumeration call every signup already makes, so
   * capturing it costs no extra request and adds no new way for a signup to
   * fail. Absent when Google does not return a mapsUri for the location —
   * treat it as a bonus, never as a guarantee.
   */
  placeId?: string;

  /**
   * Google's own flag for "this account has authority over the listing", which
   * is false for a listing that is not verified yet. Read from `metadata`, which
   * the enumeration already requests, so it costs nothing. Undefined when Google
   * omits it, which is treated as unknown, never as unverified.
   */
  hasVoiceOfMerchant?: boolean;
}

export function formatAddress(address: any): string {
  if (!address) return '';
  const parts = [
    address.addressLines?.join(', '),
    address.locality,
    address.postalCode,
  ].filter(Boolean);
  return parts.join(', ');
}

// `redirectUri` overrides GOOGLE_REDIRECT_URI for callers that know their own
// origin. One deploy serves two hosts, so the env var can only ever hold one of
// them (Chocka's) — Stellar has to pass its own or Google would return its
// retailers to app.chocka.co.uk. Optional so existing callers, and
// scripts/live-matrix.ts (which forces a loopback URI through the env var),
// keep working untouched.
//
// Whatever is used here MUST be passed to exchangeCodeForTokens() as well:
// Google requires the two redirect_uri values to match exactly.
export function getGoogleAuthUrl(state?: string, redirectUri?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri || process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: ['openid','email','profile','https://www.googleapis.com/auth/business.manage'].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    ...(state ? { state } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// `redirectUri` must be the same value passed to getGoogleAuthUrl() for this
// authorisation — Google validates that the two match and rejects the exchange
// otherwise. See the note there.
export async function exchangeCodeForTokens(code: string, redirectUri?: string) {
  const res = await googleFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri || process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await googleFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GoogleAuthError(`Token refresh failed: ${text}`, res.status, /invalid_grant/.test(text));
  }
  const data = await res.json();
  return data.access_token;
}

// ── One door for every request to Google ───────────────────────────────────
// Every call in this file goes through googleFetch, so a "too many requests"
// answer (429) or a bad moment on Google's side (5xx, or a dropped connection)
// is retried with a growing wait before it becomes an outcome anybody sees.
//
// Until now only the listing enumeration retried. Scoring a listing, applying
// a change and refreshing a sign-in did not, so with many shops joining at
// once one refusal failed a step outright, and a refusal on the sign-in refresh
// marked a perfectly good connection as dead.
//
// What is retried:
//   429                     always: Google refused before doing anything
//   5xx, dropped connection only when repeating the request is safe: every
//                           read, PATCH, PUT and DELETE here is idempotent, and
//                           so is the token exchange. A POST that creates a
//                           post or a photo is NOT repeated on these, because
//                           the first attempt may have landed.
// Every other 4xx is a decision Google will make again identically.
//
// COST: at most about 3.5 seconds of waiting, and only on the failure path.
// Google's Retry-After is honoured, capped, so one request cannot sit for long.
let RETRY_DELAYS_MS = [300, 900, 2200];
const RETRY_AFTER_CAP_MS = 4000;

/** Tests only: shorten or remove the waits. Returns the previous value. */
export function setGoogleRetryDelaysForTests(delays: number[]): number[] {
  const before = RETRY_DELAYS_MS;
  RETRY_DELAYS_MS = delays;
  return before;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function retryAfterMs(res: Response, fallback: number): number {
  const raw = res.headers?.get?.('retry-after');
  const secs = raw ? Number(raw) : NaN;
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, RETRY_AFTER_CAP_MS) : fallback;
}

export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  // The token endpoint is a POST but exchanging a refresh token is repeatable.
  const repeatable = method !== 'POST' || url.startsWith(GOOGLE_TOKEN_URL);
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_DELAYS_MS.length;
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // A thrown fetch is a connection-level failure (DNS, TLS, socket).
      if (last || !repeatable) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (res.ok || last) return res;
    const transient = res.status === 429 || (res.status >= 500 && repeatable);
    if (!transient) return res;
    await sleep(retryAfterMs(res, RETRY_DELAYS_MS[attempt]));
  }
}

/** Kept under its old name for the enumeration calls that already used it. */
const fetchRetryingTransient = googleFetch;

export async function getAccounts(accessToken: string) {
  const accounts: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetchRetryingTransient(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await gbpError(res, 'Failed to get accounts');
    const data = await res.json();
    if (data.accounts) accounts.push(...data.accounts);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { accounts };
}

export async function getLocations(accessToken: string, accountName: string) {
  // `metadata` carries mapsUri, which carries the Places id. Requested here
  // rather than resolved later because it rides along on a call that already
  // happens — see Listing.placeId.
  const mask = 'name,title,storefrontAddress,latlng,categories,metadata';
  const locations: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GBP_API_BASE}/${accountName}/locations`);
    url.searchParams.set('readMask', mask);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetchRetryingTransient(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await gbpError(res, 'Failed to get locations');
    const data = await res.json();
    if (data.locations) locations.push(...data.locations);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { locations };
}

// ── Enumerate every listing the user can manage, across all accounts ──
// Replaces the old "accounts[0] × locations[0]" assumption. Walks every
// account with a management role and every location under it, so managers and
// group-managed shops surface instead of silently binding the wrong listing.
/**
 * Pull the Places id out of a location's mapsUri.
 *
 * Same expression the dashboard has used since it started caching
 * `profiles.google_place_id` — kept identical on purpose so the two cannot
 * disagree about what a place id is. Returns undefined rather than '' so an
 * absent id is never mistaken for a resolved-but-empty one.
 */
export function placeIdFromMapsUri(mapsUri?: string | null): string | undefined {
  if (!mapsUri) return undefined;
  const m = mapsUri.match(/place_id[=:]([^&]+)/);
  return m ? m[1] : undefined;
}

export async function getManageableListings(accessToken: string): Promise<Listing[]> {
  const accountsRes = await getAccounts(accessToken);
  const accounts: any[] = accountsRes.accounts || [];
  const listings: Listing[] = [];

  for (const account of accounts) {
    // Drop accounts the user has no management role on (e.g. a personal
    // account they can view but not act on).
    if (!MANAGE_ROLES.has(account.role)) continue;

    // Propagate a locations failure rather than swallow it. A partial
    // enumeration must never be treated as the authoritative complete set —
    // otherwise a transient failure on one account could auto-bind the wrong
    // listing, or make the select re-validation falsely reject a valid choice.
    const locationsRes = await getLocations(accessToken, account.name);

    for (const loc of locationsRes.locations || []) {
      listings.push({
        accountName: account.name,
        accountDisplay: account.accountName || '',
        accountType: account.type || '',
        accountRole: account.role || '',
        locationName: loc.name,
        title: loc.title || '',
        address: formatAddress(loc.storefrontAddress),
        latitude: loc.latlng?.latitude,
        longitude: loc.latlng?.longitude,
        category: loc.categories?.primaryCategory?.displayName || '',
        placeId: loc.metadata?.placeId || placeIdFromMapsUri(loc.metadata?.mapsUri),
        hasVoiceOfMerchant: typeof loc.metadata?.hasVoiceOfMerchant === 'boolean' ? loc.metadata.hasVoiceOfMerchant : undefined,
      });
    }
  }

  return listings;
}

// ── Manager invitations (Route 1 activation) ──
//
// When a rep adds Stellar as a manager in the retailer's own Google screen,
// Google raises an *invitation* against our account. Nothing is manageable
// until it is accepted, so without these two calls the rep flow needs a human
// clicking Accept in the Google UI once per shop.
//
// WHAT DECIDES is not here. `lib/gbp-invitations.ts` holds the rules — most
// importantly that an OWNER invitation is never accepted automatically, because
// we promise the retailer stays the owner. This module only fetches and posts.

/**
 * Invitations pending on one account.
 *
 * Deliberately unfiltered: Google supports `?filter=target_type=...`, but the
 * ones we will NOT accept are exactly the ones somebody needs to see (a rep who
 * picked Owner by mistake is a stuck activation, not noise). Filtering server
 * side would hide them.
 */
export async function listInvitations(accessToken: string, accountName: string) {
  const url = `https://mybusinessaccountmanagement.googleapis.com/v1/${accountName}/invitations`;
  const res = await fetchRetryingTransient(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await gbpError(res, `Failed to list invitations for ${accountName}`);
  const data = await res.json();
  return (data.invitations || []) as any[];
}

/**
 * Every pending invitation across every account this token can see.
 *
 * Unlike getManageableListings, accounts are NOT filtered by MANAGE_ROLES here.
 * An invitation is precisely the state of *not yet* having a role, so filtering
 * on the role we do not have yet would drop the thing we came to find.
 *
 * A failure on one account propagates rather than being swallowed: a partial
 * list read as complete would report a shop as "never invited" when in fact its
 * invitation was sitting there unaccepted.
 */
export async function listAllInvitations(accessToken: string) {
  const { accounts } = await getAccounts(accessToken);
  const all: any[] = [];
  for (const account of accounts || []) {
    if (!account?.name) continue;
    all.push(...(await listInvitations(accessToken, account.name)));
  }
  return all;
}

/**
 * Accept one invitation. `invitationName` is the full resource name,
 * `accounts/{account}/invitations/{invitation}`.
 *
 * Empty request body and empty success body, per the API. Call this only with a
 * name that `invitationDecision` returned `accept` for — the safety rules are
 * there and not here, so bypassing them is a deliberate act rather than an
 * oversight.
 */
export async function acceptInvitation(accessToken: string, invitationName: string) {
  const url = `https://mybusinessaccountmanagement.googleapis.com/v1/${invitationName}:accept`;
  const res = await fetchRetryingTransient(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw await gbpError(res, `Failed to accept invitation ${invitationName}`);
}

// ── NEW: Full location for audit ──

export async function getLocationFull(accessToken: string, locationName: string) {
  const mask = [
    'name','title','storefrontAddress','latlng','categories',
    'phoneNumbers','websiteUri','regularHours','specialHours',
    'profile','serviceItems','serviceArea','openInfo','metadata',
    'labels','moreHours',
  ].join(',');
  const res = await googleFetch(
    `${GBP_API_BASE}/${locationName}?readMask=${mask}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw await gbpError(res, 'Failed to get full location');
  return res.json();
}

export async function getGoogleUpdated(accessToken: string, locationName: string) {
  const mask = 'name,title,phoneNumbers,storefrontAddress,websiteUri,regularHours,categories,profile';
  const res = await googleFetch(
    `${GBP_API_BASE}/${locationName}:getGoogleUpdated?readMask=${mask}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get Google updates: ${await res.text()}`);
  return res.json();
}

export async function getAttributes(accessToken: string, locationName: string) {
  const res = await googleFetch(
    `${GBP_API_BASE}/${locationName}/attributes`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get attributes: ${await res.text()}`);
  return res.json();
}

export async function getMedia(accessToken: string, locationName: string, accountId?: string) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await googleFetch(
    `${GBP_POSTS_BASE}/${v4Path}/media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get media: ${await res.text()}`);
  return res.json();
}

export async function getLocalPosts(accessToken: string, locationName: string, accountId?: string) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await googleFetch(
    `${GBP_POSTS_BASE}/${v4Path}/localPosts`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get posts: ${await res.text()}`);
  return res.json();
}

/**
 * Read exactly the fields named in an update mask, so lib/change-log.ts can
 * snapshot a listing's values immediately before the app changes them. `name`
 * is always added because the API requires a non-empty read mask and it is
 * harmless. Throws GbpError, so a failed snapshot stops the write.
 */
export async function getLocationFields(accessToken: string, locationName: string, fields: string[]) {
  const mask = Array.from(new Set(['name', ...fields])).join(',');
  const res = await googleFetch(
    `${GBP_API_BASE}/${locationName}?readMask=${mask}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw await gbpError(res, 'Failed to snapshot location');
  return res.json();
}

/**
 * Look a category up in Google's own list by its display name ("Carpet store").
 * Google accepts categories only by its id for them, never by name, so a
 * suggested name has to be resolved before it can be written. Returns null if
 * Google has no category with exactly that name.
 *
 * NOT YET SEEN AGAINST REAL GOOGLE: the endpoint and its `filter` are taken
 * from Google's reference for categories.list. If the shape differs, this
 * returns null, the category is left out, and the shop is told so. Nothing is
 * written on a guess.
 */
export async function findCategoryByName(accessToken: string, displayName: string): Promise<{ name: string; displayName: string } | null> {
  const qs = new URLSearchParams({ regionCode: 'GB', languageCode: 'en', view: 'BASIC', pageSize: '20', filter: `displayName=${displayName}` });
  const res = await googleFetch(`${GBP_API_BASE}/categories?${qs}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw await gbpError(res, 'Failed to look up category');
    return null;
  }
  const data = await res.json().catch(() => null);
  const want = displayName.trim().toLowerCase();
  const hit = (data?.categories || []).find((c: any) => String(c?.displayName || '').trim().toLowerCase() === want && typeof c?.name === 'string');
  return hit ? { name: hit.name, displayName: hit.displayName } : null;
}

/** Delete a local post by its full v4 resource name. Used only by the revert script. */
export async function deleteLocalPost(accessToken: string, postName: string) {
  const res = await googleFetch(`${GBP_POSTS_BASE}/${postName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await gbpError(res, 'Failed to delete post');
}

/**
 * Add one photo to the listing itself (its photo gallery), from an address
 * Google can fetch. Only ever called through lib/change-log.ts, and only when
 * SHOP_PHOTOS_TO_LISTING=on (lib/shop-photos.ts).
 */
export async function createLocationMedia(accessToken: string, locationName: string, sourceUrl: string, accountId?: string) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await googleFetch(`${GBP_POSTS_BASE}/${v4Path}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaFormat: 'PHOTO', locationAssociation: { category: 'ADDITIONAL' }, sourceUrl }),
  });
  if (!res.ok) throw await gbpError(res, 'Failed to add photo');
  return res.json();
}

/** Delete a listing photo by its full v4 resource name. Used only by the revert script. */
export async function deleteLocationMedia(accessToken: string, mediaName: string) {
  const res = await googleFetch(`${GBP_POSTS_BASE}/${mediaName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await gbpError(res, 'Failed to delete photo');
}

/** Delete the owner's reply to a review. Used only by the revert script. */
export async function deleteReviewReply(accessToken: string, reviewName: string) {
  const res = await googleFetch(`${GBP_POSTS_BASE}/${reviewName}/reply`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await gbpError(res, 'Failed to delete reply');
}

// ── NEW: Update functions ──

export async function updateLocation(
  accessToken: string, locationName: string,
  updateMask: string, locationData: Record<string, unknown>
) {
  const url = `${GBP_API_BASE}/${locationName}?updateMask=${updateMask}`;
  console.log('[GBP PATCH]', url, JSON.stringify(locationData).slice(0, 200));
  const res = await googleFetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(locationData),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[GBP PATCH ERROR]', res.status, errText.slice(0, 300));
    let googleStatus: string | null = null;
    try { googleStatus = JSON.parse(errText)?.error?.status ?? null; } catch {}
    throw new GbpError(`Update failed (${updateMask}): ${errText}`, res.status, googleStatus);
  }
  return res.json();
}

export async function updateAttributes(
  accessToken: string, locationName: string,
  attributes: Array<{ name: string; values?: unknown[] }>
) {
  const res = await googleFetch(
    `${GBP_API_BASE}/${locationName}/attributes`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${locationName}/attributes`, attributes }),
    }
  );
  if (!res.ok) throw new Error(`Attribute update failed: ${await res.text()}`);
  return res.json();
}

// ── Existing: Posts, reviews, metrics ──

/**
 * `photoUrl` is optional: an address Google can fetch one photo from, attached
 * to the post. Without it the request body is exactly what it always was.
 */
export async function createLocalPost(accessToken: string, locationName: string, content: string, accountId?: string, photoUrl?: string | null) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await googleFetch(`${GBP_POSTS_BASE}/${v4Path}/localPosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      languageCode: 'en-GB', summary: content, topicType: 'STANDARD',
      ...(photoUrl ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: photoUrl }] } : {}),
    }),
  });
  // The status is in the message so the publisher can tell "Google refused
  // this request" (4xx) from "Google is having a bad moment" (429, 5xx).
  if (!res.ok) throw new Error(`Failed to create post (${res.status}): ${await res.text()}`);
  return res.json();
}

/** Google's maximum page size for reviews.list. */
export const REVIEWS_PAGE_SIZE = 50;
/**
 * Safety cap: 40 pages = 2,000 reviews. No flooring retailer is anywhere near it,
 * and it stops a looping nextPageToken from running a cron function out of time.
 * Hitting it is reported as `truncated: true`, never silently.
 */
export const REVIEWS_MAX_PAGES = 40;

/**
 * Every review on a location, across all pages.
 *
 * This used to fetch only the first page, so for any listing with more reviews
 * than one page holds, the rest were invisible: review-alerts never saw them,
 * onboarding never offered to reply to them, and reply-rate stats were computed
 * from a partial set. The response shape is unchanged (`reviews`,
 * `averageRating`, `totalReviewCount`), plus `truncated` if the cap was hit.
 * Google returns newest first, so page one is still what any "latest" view reads.
 */
export async function getReviews(
  accessToken: string,
  locationName: string,
  accountId?: string,
  maxPages: number = REVIEWS_MAX_PAGES,
) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const reviews: any[] = [];
  let averageRating: number | undefined;
  let totalReviewCount: number | undefined;
  let pageToken: string | undefined;
  let truncated = false;

  for (let page = 0; ; page++) {
    if (page >= maxPages) { truncated = true; break; }
    const qs = new URLSearchParams({ pageSize: String(REVIEWS_PAGE_SIZE) });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await googleFetch(
      `${GBP_POSTS_BASE}/${v4Path}/reviews?${qs}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Failed to get reviews: ${await res.text()}`);
    const data = await res.json();
    reviews.push(...(data.reviews || []));
    if (averageRating === undefined) averageRating = data.averageRating;
    if (totalReviewCount === undefined) totalReviewCount = data.totalReviewCount;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  if (truncated) {
    console.warn(`[getReviews] ${locationName}: stopped at ${maxPages} pages (${reviews.length} of ${totalReviewCount ?? '?'} reviews)`);
  }
  return { reviews, averageRating, totalReviewCount, truncated };
}

export async function replyToReview(accessToken: string, reviewName: string, comment: string) {
  const res = await googleFetch(`${GBP_POSTS_BASE}/${reviewName}/reply`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  // GbpError, not a bare Error, so the approval page can tell "you no longer have
  // permission" from "the reviewer deleted it" from "Google is having a moment" —
  // three failures that need three different things from the retailer. Same
  // reasoning as getLocationFull. The message is byte-identical to what this used
  // to throw (`${context}: ${text}`), so the callers that only log are unaffected.
  if (!res.ok) throw await gbpError(res, 'Failed to reply');
  return res.json();
}

/**
 * Last-28-days totals, for the dashboard and the Monday text. "views" is Google
 * Search plus Google Maps impressions; until 2026-11-14 it was Maps only, which
 * left out the Search figure that matters most for "people found you".
 * Monthly and before-and-after figures come from daily_metrics instead (lib/metrics.ts).
 */
export async function getPerformanceMetrics(accessToken: string, locationName: string) {
  const now = new Date();
  const to = isoDate(new Date(now.getTime() - 86400000));
  const from = addDaysIso(to, -27);
  const results = { views: 0, searchViews: 0, mapsViews: 0, calls: 0, directions: 0, websiteClicks: 0 };
  try {
    const t = totalsFor(await fetchDailyMetrics(accessToken, locationName, from, to), from, to);
    Object.assign(results, { views: t.views, searchViews: t.searchViews, mapsViews: t.mapsViews, calls: t.calls, directions: t.directions, websiteClicks: t.websiteClicks });
  } catch (e) {
    // Null, not zeros. A failed read used to come back as all zeros, which the
    // Monday text then reported to the shop as "0 views".
    console.error('[GBP Metrics] failed:', (e as Error).message);
    return null;
  }
  return results;
}

function dateParams(prefix: string, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${prefix}.year=${y}&${prefix}.month=${m}&${prefix}.day=${d}`;
}

/**
 * Every daily metric in DAILY_METRICS for [from, to], in one request
 * (fetchMultiDailyMetricsTimeSeries). If Google refuses a long range with a 400,
 * it retries with 12 months, then 6, so a first sync still gets what history
 * there is rather than nothing.
 */
export async function fetchDailyMetrics(accessToken: string, locationName: string, from: string, to: string): Promise<MetricRow[]> {
  const attempts = [from];
  for (const days of [365, 180]) {
    const shorter = addDaysIso(to, -days);
    if (shorter > from) attempts.push(shorter);
  }
  let lastError = '';
  for (const start of attempts) {
    const metrics = DAILY_METRICS.map((m) => `dailyMetrics=${m}`).join('&');
    const url = `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?${metrics}&${dateParams('dailyRange.startDate', start)}&${dateParams('dailyRange.endDate', to)}`;
    const res = await googleFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) return parseMultiDailyMetrics(await res.json());
    lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 400) break;
  }
  throw new Error(`Failed to fetch daily metrics: ${lastError}`);
}
export function parseStarRating(rating: string): number {
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[rating] || 0;
}

// ── Places API (New) — for reviews without v4 approval ──

export async function getPlaceReviews(placeId: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const res = await googleFetch(
    `https://places.googleapis.com/v1/places/${placeId}?languageCode=en`,
    {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews,websiteUri',
      },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.error('[Places API] Error:', res.status, errText.slice(0, 300));
    throw new Error(`Places API failed: ${errText}`);
  }
  return res.json();
}

// Look up Place ID from business name + address
export async function findPlaceId(businessName: string, address?: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const query = address ? `${businessName} ${address}` : businessName;
  const res = await googleFetch(
    `https://places.googleapis.com/v1/places:searchText`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'en' }),
    }
  );
  if (!res.ok) throw new Error(`Place search failed: ${await res.text()}`);
  const data = await res.json();
  return data.places?.[0]?.id || null;
}
