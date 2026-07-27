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
  const res = await fetch(GOOGLE_TOKEN_URL, {
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
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

export async function getAccounts(accessToken: string) {
  const accounts: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await gbpError(res, 'Failed to get accounts');
    const data = await res.json();
    if (data.accounts) accounts.push(...data.accounts);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { accounts };
}

export async function getLocations(accessToken: string, accountName: string) {
  const mask = 'name,title,storefrontAddress,latlng,categories';
  const locations: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GBP_API_BASE}/${accountName}/locations`);
    url.searchParams.set('readMask', mask);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
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
      });
    }
  }

  return listings;
}

// ── NEW: Full location for audit ──

export async function getLocationFull(accessToken: string, locationName: string) {
  const mask = [
    'name','title','storefrontAddress','latlng','categories',
    'phoneNumbers','websiteUri','regularHours','specialHours',
    'profile','serviceItems','serviceArea','openInfo','metadata',
    'labels','moreHours',
  ].join(',');
  const res = await fetch(
    `${GBP_API_BASE}/${locationName}?readMask=${mask}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw await gbpError(res, 'Failed to get full location');
  return res.json();
}

export async function getGoogleUpdated(accessToken: string, locationName: string) {
  const mask = 'name,title,phoneNumbers,storefrontAddress,websiteUri,regularHours,categories,profile';
  const res = await fetch(
    `${GBP_API_BASE}/${locationName}:getGoogleUpdated?readMask=${mask}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get Google updates: ${await res.text()}`);
  return res.json();
}

export async function getAttributes(accessToken: string, locationName: string) {
  const res = await fetch(
    `${GBP_API_BASE}/${locationName}/attributes`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get attributes: ${await res.text()}`);
  return res.json();
}

export async function getMedia(accessToken: string, locationName: string, accountId?: string) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await fetch(
    `${GBP_POSTS_BASE}/${v4Path}/media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get media: ${await res.text()}`);
  return res.json();
}

export async function getLocalPosts(accessToken: string, locationName: string, accountId?: string) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await fetch(
    `${GBP_POSTS_BASE}/${v4Path}/localPosts`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get posts: ${await res.text()}`);
  return res.json();
}

// ── NEW: Update functions ──

export async function updateLocation(
  accessToken: string, locationName: string,
  updateMask: string, locationData: Record<string, unknown>
) {
  const url = `${GBP_API_BASE}/${locationName}?updateMask=${updateMask}`;
  console.log('[GBP PATCH]', url, JSON.stringify(locationData).slice(0, 200));
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(locationData),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[GBP PATCH ERROR]', res.status, errText.slice(0, 300));
    throw new Error(`Update failed (${updateMask}): ${errText}`);
  }
  return res.json();
}

export async function updateAttributes(
  accessToken: string, locationName: string,
  attributes: Array<{ name: string; values?: unknown[] }>
) {
  const res = await fetch(
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

export async function createLocalPost(accessToken: string, locationName: string, content: string, accountId?: string) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await fetch(`${GBP_POSTS_BASE}/${v4Path}/localPosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ languageCode: 'en-GB', summary: content, topicType: 'STANDARD' }),
  });
  if (!res.ok) throw new Error(`Failed to create post: ${await res.text()}`);
  return res.json();
}

export async function getReviews(accessToken: string, locationName: string, accountId?: string) {
  const v4Path = accountId ? `${accountId}/${locationName}` : locationName;
  const res = await fetch(
    `${GBP_POSTS_BASE}/${v4Path}/reviews`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get reviews: ${await res.text()}`);
  return res.json();
}

export async function replyToReview(accessToken: string, reviewName: string, comment: string) {
  const res = await fetch(`${GBP_POSTS_BASE}/${reviewName}/reply`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) throw new Error(`Failed to reply: ${await res.text()}`);
  return res.json();
}

export async function getPerformanceMetrics(accessToken: string, locationName: string) {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 28 * 86400000);

  // Fetch each metric separately to avoid the single-object vs array ambiguity
  const metricNames = [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 
    'CALL_CLICKS',
    'WEBSITE_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
  ];

  const results: Record<string, number> = { views: 0, calls: 0, directions: 0, websiteClicks: 0 };

  for (const metric of metricNames) {
    try {
      const url = `https://businessprofileperformance.googleapis.com/v1/${locationName}:getDailyMetricsTimeSeries?dailyMetric=${metric}&dailyRange.start_date.year=${monthAgo.getFullYear()}&dailyRange.start_date.month=${monthAgo.getMonth()+1}&dailyRange.start_date.day=${monthAgo.getDate()}&dailyRange.end_date.year=${now.getFullYear()}&dailyRange.end_date.month=${now.getMonth()+1}&dailyRange.end_date.day=${now.getDate()}`;
      
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) continue;
      
      const data = await res.json();
      
      // timeSeries can be an object or array — handle both
      const seriesData = data.timeSeries;
      const datedValues = Array.isArray(seriesData) 
        ? seriesData.flatMap((s: any) => s.datedValues || [])
        : seriesData?.datedValues || [];
      
      const total = datedValues.reduce((sum: number, d: any) => sum + (parseInt(d.value || '0') || 0), 0);
      
      if (metric === 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS' || metric === 'BUSINESS_IMPRESSIONS_MOBILE_MAPS') results.views += total;
      if (metric === 'CALL_CLICKS') results.calls = total;
      if (metric === 'WEBSITE_CLICKS') results.websiteClicks = total;
      if (metric === 'BUSINESS_DIRECTION_REQUESTS') results.directions = total;
    } catch (e) {
      console.error(`[GBP Metrics] Failed for ${metric}:`, (e as Error).message);
    }
  }

  console.log('[GBP Metrics] Final:', JSON.stringify(results));
  return results;
}

export function parseStarRating(rating: string): number {
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[rating] || 0;
}

// ── Places API (New) — for reviews without v4 approval ──

export async function getPlaceReviews(placeId: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const res = await fetch(
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
  const res = await fetch(
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
