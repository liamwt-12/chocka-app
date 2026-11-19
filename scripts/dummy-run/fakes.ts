/**
 * The outside world, faked, for the staging dummy run.
 *
 * Every outbound request the app makes goes through `installFetchGuard`:
 *
 *   - the STAGING database and storage: allowed through, untouched
 *   - Google (sign-in, Business Profile, performance, places): answered by a
 *     small in-memory Google that remembers what was written to it
 *   - the AI model: answered with canned text, and every prompt recorded
 *   - email (Resend) and SMS (Twilio): recorded and "accepted", never sent
 *   - ANYTHING ELSE: refused, loudly, and counted. So nothing can leave.
 */

export interface FakeReview {
  name: string; reviewId: string; reviewer: { displayName: string }; starRating: string;
  comment: string; createTime: string; updateTime: string; reviewReply?: { comment: string; updateTime: string };
}

export interface FakeListing {
  account: string; loc: string; placeId: string; verified: boolean;
  location: any; original: string;
  reviews: FakeReview[]; posts: any[]; media: any[]; writes: Array<{ what: string; detail?: any }>;
  /** Daily figures double from this date on (a shop whose ads started). */
  upliftFrom: string | null;
}

export interface Persona {
  key: string; email: string; name: string; listings: FakeListing[];
  /** The person left the business-listings box unticked on Google's screen. */
  scopeUnticked?: boolean;
  /** Google has withdrawn our permission (password change, removed in Google). */
  tokenRevoked?: boolean;
}

export const PER_DAY = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 10, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 10,
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 10, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 10,
  CALL_CLICKS: 2, WEBSITE_CLICKS: 3, BUSINESS_DIRECTION_REQUESTS: 1,
} as Record<string, number>;

/** What the fake Google reports for one metric on one day. Deterministic, so the report can be checked exactly. */
export function metricValue(l: FakeListing, metric: string, date: string): number {
  const base = PER_DAY[metric] ?? 0;
  return l.upliftFrom && date >= l.upliftFrom ? base * 2 : base;
}

export function makeListing(n: number, title: string, placeId: string, verified = true, upliftFrom: string | null = null): FakeListing {
  const account = `accounts/${1000 + n}`;
  const loc = `locations/${9000 + n}`;
  const location = {
    name: loc, title,
    storefrontAddress: { addressLines: ['1 Test Street'], locality: 'Testtown', postalCode: 'ZZ1 1ZZ', regionCode: 'GB' },
    phoneNumbers: { primaryPhone: '01632 960001' },
    websiteUri: 'https://shop.invalid',
    categories: { primaryCategory: { displayName: 'Flooring shop', name: 'categories/gcid:flooring_store' }, additionalCategories: [] },
    profile: { description: '' },
    serviceItems: [],
    latlng: { latitude: 53.8, longitude: -1.5 },
    metadata: { placeId, mapsUri: `https://maps.google.com/?cid=1&place_id=${placeId}`, hasVoiceOfMerchant: verified },
  };
  return { account, loc, placeId, verified, location, original: JSON.stringify(location), reviews: [], posts: [], media: [], writes: [], upliftFrom };
}

export function addReview(l: FakeListing, id: string, stars: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE', ageDays: number, comment: string, reviewer = 'Testy McTestface', replied = false) {
  const t = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  l.reviews.unshift({
    name: `${l.account}/${l.loc}/reviews/${id}`, reviewId: id, reviewer: { displayName: reviewer }, starRating: stars, comment, createTime: t, updateTime: t,
    ...(replied ? { reviewReply: { comment: 'Thanks (the shop wrote this itself, before the run)', updateTime: t } } : {}),
  });
}

export interface World {
  personas: Record<string, Persona>;
  modelCalls: Array<{ system: string; user: string; model: string }>;
  emails: Array<{ to: string; subject: string; html: string; /** Set for a plain-text email, which has no HTML part. */ text: string; from: string; replyTo: string | null; headers: Record<string, string> }>;
  sms: Array<{ to: string; body: string }>;
  blocked: string[];
  unhandledGoogle: string[];
  stagingRequests: number;
  googleRequests: number;
}

export function newWorld(): World {
  return { personas: {}, modelCalls: [], emails: [], sms: [], blocked: [], unhandledGoogle: [], stagingRequests: 0, googleRequests: 0 };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const googleError = (status: number, code: string, message: string) => json({ error: { code: status, status: code, message } }, status);

function bodyText(init?: RequestInit): string {
  const b: any = init?.body;
  if (!b) return '';
  if (typeof b === 'string') return b;
  if (b instanceof URLSearchParams) return b.toString();
  return String(b);
}

function personaFromAuth(world: World, init?: RequestInit): Persona | null {
  const h = new Headers(init?.headers as any);
  const m = /^Bearer at-(\w+)$/.exec(h.get('authorization') || '');
  return m ? world.personas[m[1]] ?? null : null;
}

function findListing(world: World, url: string): FakeListing | null {
  const m = /locations\/(\d+)/.exec(url);
  if (!m) return null;
  for (const p of Object.values(world.personas)) for (const l of p.listings) if (l.loc === `locations/${m[1]}`) return l;
  return null;
}

function fakeGoogle(world: World, url: string, init?: RequestInit): Response {
  world.googleRequests++;
  const u = new URL(url);
  const method = (init?.method || 'GET').toUpperCase();
  const path = u.pathname;

  // ── Sign-in ──
  if (u.host === 'oauth2.googleapis.com' && path === '/token') {
    const form = new URLSearchParams(bodyText(init));
    const code = form.get('code');
    const refresh = form.get('refresh_token');
    const key = code?.startsWith('code-') ? code.slice(5) : refresh?.startsWith('rt-') ? refresh.slice(3) : null;
    if (!key || !world.personas[key]) return json({ error: 'invalid_grant' }, 400);
    if (refresh && world.personas[key].tokenRevoked) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    return json({
      access_token: `at-${key}`, expires_in: 3600, token_type: 'Bearer',
      scope: world.personas[key].scopeUnticked ? 'openid email profile' : 'openid email profile https://www.googleapis.com/auth/business.manage',
      ...(code ? { refresh_token: `rt-${key}` } : {}),
    });
  }
  if (u.host === 'oauth2.googleapis.com' && path === '/revoke') return json({});
  if (u.host === 'www.googleapis.com' && path === '/oauth2/v2/userinfo') {
    const p = personaFromAuth(world, init);
    return p ? json({ email: p.email, name: p.name }) : googleError(401, 'UNAUTHENTICATED', 'no token');
  }

  // ── Accounts and listings ──
  if (u.host === 'mybusinessaccountmanagement.googleapis.com') {
    const p = personaFromAuth(world, init);
    if (!p) return googleError(401, 'UNAUTHENTICATED', 'no token');
    if (path === '/v1/accounts') {
      // Everyone has a personal account; it simply holds no listings for a persona with none.
      const accounts = p.listings.length ? Array.from(new Set(p.listings.map((l) => l.account))) : [`accounts/empty-${p.key}`];
      return json({ accounts: accounts.map((name) => ({ name, accountName: p.name, type: 'PERSONAL', role: 'PRIMARY_OWNER' })) });
    }
    if (/\/invitations$/.test(path)) return json({ invitations: [] });
  }

  if (u.host === 'mybusinessbusinessinformation.googleapis.com') {
    const p = personaFromAuth(world, init);
    if (!p) return googleError(401, 'UNAUTHENTICATED', 'no token');
    if (path === '/v1/categories') {
      // Google's own list of categories, looked up by display name.
      const want = (/displayName=(.+)$/.exec(u.searchParams.get('filter') || '') || [])[1]?.trim() || '';
      const known: Record<string, string> = { 'carpet store': 'gcid:carpet_store', 'flooring contractor': 'gcid:flooring_contractor', 'flooring shop': 'gcid:flooring_store' };
      const id = known[want.toLowerCase()];
      return json({ categories: id ? [{ name: `categories/${id}`, displayName: want }] : [] });
    }
    const list = /^\/v1\/(accounts\/[^/]+)\/locations$/.exec(path);
    if (list) return json({ locations: p.listings.filter((l) => l.account === list[1]).map((l) => l.location) });

    const l = findListing(world, path);
    if (!l) return googleError(404, 'NOT_FOUND', 'no such location');
    if (!p.listings.includes(l)) return googleError(403, 'PERMISSION_DENIED', 'not your listing');
    if (path.endsWith(':getGoogleUpdated')) return googleError(404, 'NOT_FOUND', 'no pending Google updates');
    if (path.endsWith('/attributes')) {
      if (method === 'PATCH') { l.writes.push({ what: 'attributes' }); return json(JSON.parse(bodyText(init) || '{}')); }
      return json({ attributes: [] });
    }
    if (method === 'GET') return json(l.location);
    if (method === 'PATCH' && (l as any).refuseWrites) return googleError(403, 'PERMISSION_DENIED', 'The caller does not have permission');
    if (method === 'PATCH') {
      const mask = (u.searchParams.get('updateMask') || '').split(',').map((s) => s.trim().split('.')[0]).filter(Boolean);
      const body = JSON.parse(bodyText(init) || '{}');
      // The real API's rule: a field named in the mask but absent from the body is cleared.
      for (const f of mask) { if (f in body) l.location[f] = body[f]; else delete l.location[f]; }
      l.writes.push({ what: `location:${mask.join(',')}` });
      return json(l.location);
    }
  }

  // ── Reviews, posts, photos (the v4 API) ──
  if (u.host === 'mybusiness.googleapis.com') {
    const p = personaFromAuth(world, init);
    if (!p) return googleError(401, 'UNAUTHENTICATED', 'no token');
    const l = findListing(world, path);
    if (!l) return googleError(404, 'NOT_FOUND', 'no such location');
    if (!p.listings.includes(l)) return googleError(403, 'PERMISSION_DENIED', 'not your listing');

    const reply = /\/reviews\/([^/]+)\/reply$/.exec(path);
    if (reply) {
      const r = l.reviews.find((x) => x.reviewId === reply[1]);
      if (!r) return googleError(404, 'NOT_FOUND', 'no such review');
      if (method === 'PUT') {
        const comment = JSON.parse(bodyText(init)).comment;
        r.reviewReply = { comment, updateTime: new Date().toISOString() };
        l.writes.push({ what: 'reply', detail: { reviewId: r.reviewId, stars: r.starRating, comment } });
        return json(r.reviewReply);
      }
      if (method === 'DELETE') { delete r.reviewReply; l.writes.push({ what: 'reply-deleted', detail: { reviewId: r.reviewId } }); return json({}); }
    }
    if (path.endsWith('/reviews') && method === 'GET') {
      const n = l.reviews.length;
      const avg = n ? l.reviews.reduce((s, r) => s + ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as any)[r.starRating], 0) / n : 0;
      return json({ reviews: l.reviews, averageRating: avg, totalReviewCount: n });
    }
    if (path.endsWith('/localPosts')) {
      if (method === 'GET') return json({ localPosts: l.posts });
      if (method === 'POST') {
        const body = JSON.parse(bodyText(init));
        const post = { name: `${l.account}/${l.loc}/localPosts/${l.posts.length + 1}-${Date.now()}`, createTime: new Date().toISOString(), ...body };
        l.posts.unshift(post);
        l.writes.push({ what: 'post', detail: { summary: body.summary, media: body.media ?? null } });
        return json(post);
      }
    }
    const postDel = /\/localPosts\/[^/]+$/.exec(path);
    if (postDel && method === 'DELETE') {
      const before = l.posts.length;
      l.posts = l.posts.filter((x) => !path.endsWith(x.name.split('/localPosts/')[1]));
      l.writes.push({ what: 'post-deleted' });
      return before === l.posts.length ? googleError(404, 'NOT_FOUND', 'no such post') : json({});
    }
    if (path.endsWith('/media')) {
      if (method === 'GET') return json({ mediaItems: l.media });
      if (method === 'POST') {
        const item = { name: `${l.account}/${l.loc}/media/${l.media.length + 1}`, ...JSON.parse(bodyText(init)) };
        l.media.push(item); l.writes.push({ what: 'listing-photo' });
        return json(item);
      }
    }
  }

  // ── Performance figures ──
  if (u.host === 'businessprofileperformance.googleapis.com') {
    const l = findListing(world, path);
    if (!l) return googleError(404, 'NOT_FOUND', 'no such location');
    const d = (prefix: string) => `${u.searchParams.get(`${prefix}.year`)}-${String(u.searchParams.get(`${prefix}.month`)).padStart(2, '0')}-${String(u.searchParams.get(`${prefix}.day`)).padStart(2, '0')}`;
    const from = d('dailyRange.startDate'), to = d('dailyRange.endDate');
    const metrics = u.searchParams.getAll('dailyMetrics');
    const days: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
    return json({
      multiDailyMetricTimeSeries: [{
        dailyMetricTimeSeries: metrics.map((dailyMetric) => ({
          dailyMetric,
          timeSeries: { datedValues: days.map((day) => { const [year, month, dd] = day.split('-').map(Number); return { date: { year, month, day: dd }, value: String(metricValue(l, dailyMetric, day)) }; }) },
        })),
      }],
    });
  }

  // ── Places ──
  if (u.host === 'places.googleapis.com') {
    if (path.endsWith(':searchText')) return json({ places: [] });
    return json({ displayName: { text: 'ZZ-TEST' }, rating: 4.5, userRatingCount: 5, reviews: [] });
  }

  world.unhandledGoogle.push(`${method} ${u.host}${path}`);
  return googleError(501, 'UNIMPLEMENTED', 'the fake Google does not answer this');
}

let postCounter = 0;
function fakeModel(world: World, init?: RequestInit): Response {
  const body = JSON.parse(bodyText(init) || '{}');
  const system: string = body.system || '';
  const user: string = body.messages?.[0]?.content || '';
  world.modelCalls.push({ system, user, model: body.model });
  const signOff = /End with this sign-off, exactly as written, on its own at the end: (.+)/.exec(system)?.[1]?.trim();
  const tail = signOff ? ` ${signOff}` : '';
  let text: string;
  if (system.includes('Google Business Profile posts')) {
    postCounter++;
    text = `Dummy run post number ${postCounter}. This time of year is a good moment to freshen up a tired hallway with something hard-wearing. Pop in and have a look at what is in the showroom.${tail}`;
  } else if (system.includes('review replies')) {
    const first = /Reviewer: (\S+)/.exec(user)?.[1] || 'there';
    text = `Thanks so much, ${first}. We really appreciate you taking the time to leave a review, and we are glad you were pleased with the job.${tail}`;
  } else if (system.includes('Google Business Profile descriptions')) {
    text = 'We are a dummy-run flooring shop that exists only for testing. We fit carpets, vinyl and laminate for homes across Testtown and the villages around it, and we have done so for a good while. Pop in to the showroom to see samples, or ask us to bring them to you. This description is test data and was written by the dummy run.';
  } else if (system.includes('service lists')) {
    text = JSON.stringify(['Carpet fitting', 'Vinyl flooring', 'Laminate flooring', 'Stair runners', 'Floor preparation', 'Free measuring', 'Underlay supply', 'Commercial flooring']);
  } else if (system.includes('categories')) {
    text = JSON.stringify(['Carpet store', 'Flooring contractor']);
  } else {
    text = 'Dummy run: unrecognised prompt.';
  }
  return json({ content: [{ type: 'text', text }], stop_reason: 'end_turn', model: body.model });
}

const GOOGLE_HOSTS = new Set([
  'oauth2.googleapis.com', 'www.googleapis.com', 'mybusinessaccountmanagement.googleapis.com',
  'mybusinessbusinessinformation.googleapis.com', 'mybusiness.googleapis.com',
  'businessprofileperformance.googleapis.com', 'places.googleapis.com',
]);

export function installFetchGuard(world: World, stagingHost: string): typeof fetch {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).host;
    if (host === stagingHost) { world.stagingRequests++; return realFetch(input, init); }
    if (GOOGLE_HOSTS.has(host)) return fakeGoogle(world, url, init);
    if (host === 'api.anthropic.com') return fakeModel(world, init);
    if (host === 'api.resend.com') {
      const b = JSON.parse(bodyText(init) || '{}');
      world.emails.push({ to: String(b.to), subject: String(b.subject), html: b.html === undefined ? '' : String(b.html), text: b.text === undefined ? '' : String(b.text), from: String(b.from ?? ''), replyTo: b.reply_to === undefined ? null : String(b.reply_to), headers: b.headers && typeof b.headers === 'object' ? b.headers : {} });
      return json({ id: `fake-email-${world.emails.length}` });
    }
    if (host === 'api.twilio.com') {
      const f = new URLSearchParams(bodyText(init));
      world.sms.push({ to: f.get('To') || '', body: f.get('Body') || '' });
      return json({ sid: `SMfake${world.sms.length}` }, 201);
    }
    world.blocked.push(`${(init?.method || 'GET').toUpperCase()} ${host}`);
    throw new Error(`DUMMY RUN: outbound request to ${host} was blocked`);
  }) as typeof fetch;
  return realFetch;
}
