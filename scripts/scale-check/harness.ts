/**
 * Shared machinery for the scale check and the resume tests: seed N simulated
 * shops, time every outside call on the virtual clock, and call a scheduled
 * job's real route handler. Nothing real is touched (see ./sim.ts).
 */
import { vi, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Clock, LATENCY, newCounters, fakeDb, classify, type Sim, type Kind } from './sim';
import { newWorld, installFetchGuard, makeListing, addReview, type World } from '../dummy-run/fakes';

const ROOT = resolve(__dirname, '..', '..');
export const DAY = 86_400_000;

export let sim: Sim;
export let world: World;
/** What the app sees as its database: whichever simulated one is current. */
export const dbProxy = { from: (t: string) => fakeDb(sim).from(t), get storage() { return fakeDb(sim).storage; } };
/** Shops whose reviews were read from the fake Google since the last reset. */
export const reviewsReadFor = new Set<string>();

export const mod = (rel: string) => import(/* @vite-ignore */ pathToFileURL(resolve(ROOT, rel)).href) as Promise<any>;

export interface Scenario {
  job: string; label: string; schedule: string;
  /** Extra rows and switches on top of the N standard shops. */
  setup?: (ctx: { n: number; sim: Sim; world: World; users: any[]; profiles: any[] }) => void | Promise<void>;
  env?: Record<string, string>;
}

export interface Row { job: string; label: string; schedule: string; shops: number; seconds: number; perShopMs: number; calls: Record<Kind, number>; dbByTable: Record<string, number>; result: any; unbounded: Record<string, number>; biggestRead: number }
export const rows: Row[] = [];

export async function seed(n: number) {
  process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  process.env.CANCEL_HASH_SECRET = 'scale'; process.env.SESSION_SECRET = 'scale'; process.env.CRON_SECRET = 'scale';
  for (const k of ['ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER']) process.env[k] = 'scale';
  const { encryptSecret, userTokenAad } = await mod('lib/secrets.ts');
  world = newWorld();
  sim = { clock: new Clock(Date.now()), count: newCounters(), tables: {}, idSeq: 0 };
  const users: any[] = [], profiles: any[] = [], retailers: any[] = [];
  for (let i = 1; i <= n; i++) {
    const key = `s${i}`, uid = `user-${i}`, pid = `profile-${i}`;
    const listing = makeListing(i, `Sim Shop ${i}`, `ChIJsim${String(i).padStart(20, '0')}`);
    world.personas[key] = { key, email: `sim+${i}@invalid.example`, name: `Sim ${i}`, listings: [listing] };
    users.push({
      id: uid, email: `sim+${i}@invalid.example`, name: `Sim ${i}`, phone_number: '07700900123', sms_enabled: true,
      google_refresh_token: encryptSecret(`rt-${key}`, userTokenAad(uid)), token_status: 'valid', subscription_status: 'none',
      auto_post_enabled: true, auto_reply_enabled: true, pause_until: null, onboarding_step: 'complete', managed_by_user_id: null,
      created_at: new Date(Date.now() - 90 * DAY).toISOString(), tenant_id: 'tenant-stellar',
    });
    profiles.push({
      id: pid, user_id: uid, business_name: `Sim Shop ${i}`, category: 'Flooring shop', address: '1 Test Street, Testtown',
      google_location_name: listing.loc, google_account_id: listing.account, total_auto_posts: 5, total_auto_replies: 3, streak_weeks: 4,
      metrics_backfilled_at: new Date(Date.now() - 30 * DAY).toISOString(), metrics_synced_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      created_at: new Date(Date.now() - 90 * DAY).toISOString(),
    });
    retailers.push({ id: `retailer-${i}`, user_id: uid, name: `Sim Shop ${i}`, ad_start_date: null, voice_profile: null });
  }
  sim.tables = { users, profiles, retailers, scheduled_posts: [], reviews: [], review_replies: [], sms_log: [], weekly_stats: [], daily_metrics: [], change_log: [], shop_photos: [] };
  return { users, profiles };
}

export function installTimedFetch() {
  installFetchGuard(world, 'nowhere.invalid');
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const kind = classify(url, (init?.method || 'GET').toUpperCase());
    if (!kind) throw new Error(`scale check: request to ${new URL(url).host} is not simulated`);
    sim.count.calls[kind]++;
    if (kind === 'googleRead' && url.endsWith('/reviews?pageSize=50')) { const who = /^Bearer at-(\w+)$/.exec(new Headers(init?.headers as any).get('authorization') || ''); if (who) reviewsReadFor.add(who[1]); }
    await sim.clock.wait(LATENCY[kind]);
    return inner(input, init);
  }) as typeof fetch;
}

export async function run(s: Scenario, n: number) {
  const realFetch = globalThis.fetch;
  for (const k of ['SHOP_PHOTOS', 'EARLY_POST_PREVIEW_EMAILS']) delete process.env[k];
  Object.assign(process.env, s.env || {});
  const { users, profiles } = await seed(n);
  await s.setup?.({ n, sim, world, users, profiles });
  installTimedFetch();
  const quiet = ['log', 'warn', 'error'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  try {
    const handler = (await mod(`app/api/cron/${s.job}/route.ts`)).GET;
    sim.count = newCounters();
    const t0 = sim.clock.now;
    const res: Response = await handler(new NextRequest(`http://localhost/api/cron/${s.job}`, { headers: { authorization: 'Bearer scale' } }));
    const seconds = (sim.clock.now - t0) / 1000;
    const result = await res.json().catch(() => ({ status: res.status }));
    expect(res.status, `${s.job} (${s.label}, ${n} shops) answered ${res.status}: ${JSON.stringify(result).slice(0, 200)}`).toBe(200);
    expect(world.blocked, 'a request tried to leave the simulation').toEqual([]);
    expect(world.unhandledGoogle, 'the fake Google could not answer').toEqual([]);
    rows.push({ job: s.job, label: s.label, schedule: s.schedule, shops: n, seconds: Math.round(seconds * 10) / 10, perShopMs: Math.round((seconds * 1000) / n), calls: { ...sim.count.calls }, dbByTable: { ...sim.count.dbByTable }, result, unbounded: { ...sim.count.unbounded }, biggestRead: sim.count.dbRowsReturnedMax });
  } finally {
    quiet.forEach((q) => q.mockRestore());
    globalThis.fetch = realFetch;
  }
}

// ── What each shop looks like to each job ──────────────────────────────────
export const everyNth = <T,>(list: T[], fraction: number) => list.filter((_, i) => i % Math.round(1 / fraction) === 0);

export function seedPublishedPosts(ctx: { sim: Sim; profiles: any[] }, each = 5) {
  for (const p of ctx.profiles) for (let k = 0; k < each; k++) ctx.sim.tables.scheduled_posts.push({ id: `post-${p.id}-${k}`, profile_id: p.id, content: `Old post ${k}`, status: 'published', scheduled_for: new Date(Date.now() - (k + 2) * 7 * DAY).toISOString(), published_at: new Date(Date.now() - (k + 2) * 7 * DAY).toISOString(), created_at: new Date(Date.now() - (k + 2) * 7 * DAY).toISOString(), photo_id: null });
}
export function seedDuePosts(ctx: { sim: Sim; profiles: any[] }, profiles: any[]) {
  for (const p of profiles) ctx.sim.tables.scheduled_posts.push({ id: `due-${p.id}`, profile_id: p.id, content: 'A post that is due now.', status: 'pending_approval', scheduled_for: new Date(Date.now() - 60_000).toISOString(), created_at: new Date(Date.now() - DAY).toISOString(), photo_id: null });
}
export function seedReviews(ctx: { sim: Sim; world: World; profiles: any[] }, newFraction: number, existing = 30) {
  ctx.profiles.forEach((p, i) => {
    const listing = ctx.world.personas[`s${i + 1}`].listings[0];
    for (let k = 0; k < existing; k++) {
      addReview(listing, `old-${k}`, 'FIVE', 40 + k, 'An old review.', 'Old Reviewer', true);
      ctx.sim.tables.reviews.push({ id: `rev-${p.id}-${k}`, profile_id: p.id, google_review_id: `old-${k}`, rating: 5, review_date: new Date(Date.now() - (40 + k) * DAY).toISOString() });
    }
    if (newFraction > 0 && i % Math.round(1 / newFraction) === 0) addReview(listing, 'fresh', 'FIVE', 1, 'A lovely new review.', 'Nina New');
  });
}
export function seedMetrics(ctx: { sim: Sim; profiles: any[] }, days = 70) {
  const metrics = ['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS'];
  for (const p of ctx.profiles) for (let d = 1; d <= days; d++) { const date = new Date(Date.now() - d * DAY).toISOString().slice(0, 10); for (const m of metrics) ctx.sim.tables.daily_metrics.push({ profile_id: p.id, date, metric: m, value: 5 }); }
}


/** Call one scheduled job's route handler in the current simulated world. Returns its answer and how long it "took". */
export async function callCron(job: string): Promise<{ seconds: number; result: any }> {
  const handler = (await mod(`app/api/cron/${job}/route.ts`)).GET;
  const t0 = sim.clock.now;
  const res: Response = await handler(new NextRequest(`http://localhost/api/cron/${job}`, { headers: { authorization: 'Bearer scale' } }));
  expect(res.status).toBe(200);
  return { seconds: (sim.clock.now - t0) / 1000, result: await res.json() };
}

/** Let virtual time pass between runs, as the schedule would. */
export function advanceMinutes(minutes: number) {
  sim.clock.now += minutes * 60_000;
  vi.setSystemTime(sim.clock.base + sim.clock.now);
}

/**
 * Run a job again and again on its schedule until it reports nothing left (or
 * `maxRuns`). Returns how many runs it took and the longest single run.
 */
export async function drain(job: string, everyMinutes: number, maxRuns: number, isDone: (result: any) => boolean) {
  let runs = 0, longest = 0;
  const results: any[] = [];
  while (runs < maxRuns) {
    const r = await callCron(job);
    runs++; longest = Math.max(longest, r.seconds); results.push(r.result);
    if (isDone(r.result)) break;
    advanceMinutes(Math.max(0, everyMinutes - r.seconds / 60));
  }
  return { runs, longestRunSeconds: Math.round(longest * 10) / 10, results };
}

/** Seed, wire up the fakes and silence the jobs' own logging. Call the returned function when finished. */
export async function world_(n: number, setup?: Scenario['setup'], env: Record<string, string> = {}) {
  const realFetch = globalThis.fetch;
  for (const k of ['SHOP_PHOTOS', 'EARLY_POST_PREVIEW_EMAILS']) delete process.env[k];
  Object.assign(process.env, env);
  const { users, profiles } = await seed(n);
  await setup?.({ n, sim, world, users, profiles });
  installTimedFetch();
  reviewsReadFor.clear();
  const quiet = ['log', 'warn', 'error'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  return () => { quiet.forEach((q) => q.mockRestore()); globalThis.fetch = realFetch; };
}
