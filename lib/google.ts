const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GBP_API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const GBP_POSTS_BASE = 'https://mybusiness.googleapis.com/v4';

export function getGoogleAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: ['openid','email','profile','https://www.googleapis.com/auth/business.manage'].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    ...(state ? { state } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
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
  const res = await fetch(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get accounts: ${await res.text()}`);
  return res.json();
}

export async function getLocations(accessToken: string, accountName: string) {
  const mask = 'name,title,storefrontAddress,latlng,categories';
  const res = await fetch(
    `${GBP_API_BASE}/${accountName}/locations?readMask=${mask}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get locations: ${await res.text()}`);
  return res.json();
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
  if (!res.ok) throw new Error(`Failed to get full location: ${await res.text()}`);
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

export async function getMedia(accessToken: string, locationName: string) {
  const res = await fetch(
    `${GBP_POSTS_BASE}/${locationName}/media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to get media: ${await res.text()}`);
  return res.json();
}

export async function getLocalPosts(accessToken: string, locationName: string) {
  const res = await fetch(
    `${GBP_POSTS_BASE}/${locationName}/localPosts`,
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

export async function createLocalPost(accessToken: string, locationName: string, content: string) {
  const res = await fetch(`${GBP_POSTS_BASE}/${locationName}/localPosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ languageCode: 'en-GB', summary: content, topicType: 'STANDARD' }),
  });
  if (!res.ok) throw new Error(`Failed to create post: ${await res.text()}`);
  return res.json();
}

export async function getReviews(accessToken: string, locationName: string) {
  const res = await fetch(
    `${GBP_POSTS_BASE}/${locationName}/reviews`,
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
  // Try the new Performance API first
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const startDate = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth()+1).padStart(2,'0')}-${String(weekAgo.getDate()).padStart(2,'0')}`;
  const endDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // New API: businessprofileperformance
  const newUrl = `https://businessprofileperformance.googleapis.com/v1/${locationName}:getDailyMetricsTimeSeries?dailyMetric=BUSINESS_IMPRESSIONS_DESKTOP_MAPS&dailyMetric=BUSINESS_IMPRESSIONS_MOBILE_MAPS&dailyMetric=CALL_CLICKS&dailyMetric=WEBSITE_CLICKS&dailyMetric=BUSINESS_DIRECTION_REQUESTS&dailyRange.start_date.year=${weekAgo.getFullYear()}&dailyRange.start_date.month=${weekAgo.getMonth()+1}&dailyRange.start_date.day=${weekAgo.getDate()}&dailyRange.end_date.year=${now.getFullYear()}&dailyRange.end_date.month=${now.getMonth()+1}&dailyRange.end_date.day=${now.getDate()}`;

  const res = await fetch(newUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.ok) {
    const data = await res.json();
    console.log('[GBP Metrics] Response keys:', Object.keys(data));
    console.log('[GBP Metrics] Raw:', JSON.stringify(data).slice(0, 500));
    const metrics: Record<string, number> = { views: 0, searches: 0, calls: 0, directions: 0, websiteClicks: 0 };
    const timeSeries = data.timeSeries || data.dailyMetricTimeSeries || [];
    if (Array.isArray(timeSeries)) {
      for (const series of timeSeries) {
        const metric = series.dailyMetric;
        const subMetrics = series.dailyMetricTimeSeries?.dailySubEntityMetrics || series.dailySubEntityMetrics || [];
        const items = Array.isArray(subMetrics) ? subMetrics : [];
        const total = items.reduce((sum: number, day: any) => {
          const val = day.dayMetrics?.metric_value || day.metric_value || '0';
          return sum + (parseInt(val) || 0);
        }, 0);
        if (metric === 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS' || metric === 'BUSINESS_IMPRESSIONS_MOBILE_MAPS') metrics.views += total;
        if (metric === 'CALL_CLICKS') metrics.calls = total;
        if (metric === 'WEBSITE_CLICKS') metrics.websiteClicks = total;
        if (metric === 'BUSINESS_DIRECTION_REQUESTS') metrics.directions = total;
      }
    }
    return { locationMetrics: [{ metricValues: [
      { metric: 'QUERIES_DIRECT', dimensionalValues: [{ value: String(metrics.views) }] },
      { metric: 'QUERIES_INDIRECT', dimensionalValues: [{ value: '0' }] },
      { metric: 'ACTIONS_PHONE', dimensionalValues: [{ value: String(metrics.calls) }] },
      { metric: 'ACTIONS_DRIVING_DIRECTIONS', dimensionalValues: [{ value: String(metrics.directions) }] },
      { metric: 'ACTIONS_WEBSITE', dimensionalValues: [{ value: String(metrics.websiteClicks) }] },
    ] }] };
  }

  // Fallback: try old v4 API
  console.log('[GBP] New metrics API failed, trying v4 fallback');
  const fallbackRes = await fetch(`${GBP_POSTS_BASE}/${locationName}:reportInsights`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locationNames: [locationName],
      basicRequest: {
        metricRequests: [
          { metric: 'QUERIES_DIRECT' },{ metric: 'QUERIES_INDIRECT' },
          { metric: 'ACTIONS_PHONE' },{ metric: 'ACTIONS_DRIVING_DIRECTIONS' },
          { metric: 'ACTIONS_WEBSITE' },
        ],
        timeRange: { startTime: weekAgo.toISOString(), endTime: now.toISOString() },
      },
    }),
  });
  if (!fallbackRes.ok) {
    console.error('[GBP] Both metrics APIs failed:', await fallbackRes.text().catch(() => 'unknown'));
    return null;
  }
  return fallbackRes.json();
}

export function parseStarRating(rating: string): number {
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[rating] || 0;
}
