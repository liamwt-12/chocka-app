/**
 * Load simulation: 92 shops joining in one week.
 *
 * Reuses the scale-check harness (in-memory database, fake Google, model, email
 * and SMS, virtual clock). Nothing real is touched. Not part of `npm test`.
 *
 *   npx vitest run --config scripts/scale-check/day-one.vitest.config.ts
 *   DAY_ONE_OUT=/tmp/day-one.json npx vitest run --config scripts/scale-check/day-one.vitest.config.ts
 *
 * The figures are written up in docs/scale-check.md ("92 shops in one week").
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { LATENCY, newCounters, classify, type Kind } from './sim';
import * as H from './harness';
import { addReview } from '../dummy-run/fakes';

vi.mock('@/lib/supabase', async () => {
  const h = await import('./harness');
  const s = await import('./sim');
  // The harness's upsert scans the whole table for each row, which is fine for the
  // scheduled jobs but takes minutes for 60 history pulls of ~4,900 rows each.
  // Only the daily_metrics UPSERT is given a keyed index here. It is still counted
  // as one database request and charged the same 45 ms.
  const index = new WeakMap<object, Map<string, any>>();
  return { supabaseAdmin: {
    get storage() { return h.dbProxy.storage; },
    from: (t: string) => {
      const q: any = h.dbProxy.from(t);
      if (t !== 'daily_metrics') return q;
      q.upsert = (rows: any[]) => ({ then: (resolve: any, reject: any) => {
        const sim = h.sim; sim.count.calls.db++; sim.count.dbByTable[t] = (sim.count.dbByTable[t] || 0) + 1;
        return sim.clock.wait(s.LATENCY.db).then(() => {
          let idx = index.get(sim); if (!idx) { idx = new Map(); index.set(sim, idx); }
          const table = (sim.tables.daily_metrics ||= []);
          for (const r of rows) { const k = `${r.profile_id}|${r.date}|${r.metric}`; const ex = idx.get(k); if (ex) Object.assign(ex, r); else { idx.set(k, r); table.push(r); } }
          return { data: null, error: null, count: null };
        }).then(resolve, reject);
      } });
      return q;
    },
  } };
});
// The session cookie is signed and needs UUID ids; the harness seeds ids like "user-1".
// Only the "who is signed in" lookup is replaced. Everything else in the routes is real.
vi.mock('@/lib/session', async (orig) => ({ ...(await orig() as any), getSessionUserId: (req: any) => req.headers.get('x-sim-user') }));

const OUT = process.env.DAY_ONE_OUT || '';
const N = 92;
const DAY = H.DAY;
const out: any = { assumedLatencyMs: LATENCY, jobs: [], drains: [], onboarding: {}, arrivals: {}, faults: {}, weekOne: {} };

// ── Call log: every outside call with its virtual start time ────────────────
interface Call { t: number; end: number; kind: Kind; who: string; url: string; method: string }
let calls: Call[] = [];
let fault: ((url: string, method: string) => number | null) | null = null;
function installLog() {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || 'GET').toUpperCase();
    const kind = classify(url, method);
    if (kind) calls.push({ t: H.sim.clock.now, end: H.sim.clock.now + LATENCY[kind], kind, who: '', url: url.split('?')[0], method });
    const f = fault?.(url, method);
    if (f) {
      if (kind) { H.sim.count.calls[kind]++; await H.sim.clock.wait(LATENCY[kind]); }
      return new Response(JSON.stringify({ error: { code: f, status: f === 429 ? 'RESOURCE_EXHAUSTED' : 'UNAVAILABLE', message: 'simulated' } }), { status: f, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  }) as typeof fetch;
}
const isGoogle = (k: Kind) => k === 'googleToken' || k === 'googleRead' || k === 'googleWrite' || k === 'googleMetrics';
function peakPerMinute(list: Call[], pred: (c: Call) => boolean) {
  const ts = list.filter(pred).map((c) => c.t).sort((a, b) => a - b);
  let best = 0, j = 0;
  for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] >= 60_000) j++; best = Math.max(best, i - j + 1); }
  return best;
}
function peakConcurrent(list: Array<{ t: number; end: number }>) {
  const ev: Array<[number, number]> = [];
  for (const c of list) { ev.push([c.t, 1]); ev.push([c.end, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, best = 0;
  for (const [, d] of ev) { cur += d; best = Math.max(best, cur); }
  return best;
}

// ── Listing shapes ──────────────────────────────────────────────────────────
type Shape = 'healthy' | 'empty20' | 'empty5';
function shapeListing(i: number, shape: Shape) {
  const l = H.world.personas[`s${i}`].listings[0];
  if (shape === 'healthy') {
    l.location.profile = { description: 'A well kept listing. '.repeat(15) };
    l.location.regularHours = { periods: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map((d) => ({ openDay: d, closeDay: d, openTime: '09:00', closeTime: '17:00' })) };
    l.location.serviceItems = Array.from({ length: 8 }, (_, k) => ({ freeFormServiceItem: { label: { displayName: `Service ${k}` } } }));
    l.location.categories.additionalCategories = [{ displayName: 'Carpet store' }, { displayName: 'Flooring contractor' }];
    l.posts.push({ name: `${l.account}/${l.loc}/localPosts/1`, createTime: new Date(Date.now() - 5 * DAY).toISOString(), summary: 'A recent post' });
    for (let k = 0; k < 8; k++) l.media.push({ name: `m${k}`, createTime: new Date(Date.now() - 10 * DAY).toISOString() });
    for (let k = 0; k < 30; k++) addReview(l, `s${i}-ok-${k}`, 'FIVE', 30 + k * 5, 'Lovely job.', 'Rita Replied', true);
    return;
  }
  const unreplied = shape === 'empty20' ? 20 : 5;
  for (let k = 0; k < 10; k++) addReview(l, `s${i}-ok-${k}`, 'FIVE', 300 + k * 5, 'Old and answered.', 'Rita Replied', true);
  for (let k = 0; k < unreplied; k++) addReview(l, `s${i}-un-${k}`, k % 2 ? 'FIVE' : 'FOUR', 20 + k * 9, 'Great fitters, very tidy.', 'Una Unreplied');
  addReview(l, `s${i}-low-new`, 'TWO', 3, 'Not happy with the delay.', 'Larry Low');
  addReview(l, `s${i}-low-old`, 'ONE', 90, 'Poor.', 'Olive Old');
}
function freshJoiner(users: any[], profiles: any[], i: number) {
  const u = users[i - 1], p = profiles[i - 1];
  u.onboarding_step = 'pending'; u.created_at = new Date().toISOString();
  p.metrics_backfilled_at = null; p.metrics_synced_at = null; p.total_auto_posts = 0; p.total_auto_replies = 0; p.streak_weeks = 0; p.created_at = new Date().toISOString();
}

// Handlers are loaded once, up front. Loading one mid-flight is real (not virtual) waiting,
// during which the virtual clock would run on to other shops' queued events.
const handlers: Record<string, any> = {};
async function preload() { for (const r of ['audit', 'audit/previews', 'profile-fix', 'onboarding/reply-drafts']) handlers[r] ||= (await H.mod(`app/api/${r}/route.ts`)).POST; }
async function post(route: string, uid: string, body?: any) {
  await preload();
  const handler = handlers[route];
  const t0 = H.sim.clock.now;
  const res: Response = await handler(new NextRequest(`http://localhost/api/${route}`, { method: 'POST', headers: { 'x-sim-user': uid, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
  const json = await res.json().catch(() => ({}));
  return { t0, seconds: (H.sim.clock.now - t0) / 1000, status: res.status, json };
}
const WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((day, i) => (i < 6 ? { day, open: true, from: '09:00', to: '17:00' } : { day, open: false, from: '', to: '' }));

/** Reply drafts arrive three at a time; the page keeps asking until there are none left. */
async function allDrafts(uid: string) {
  const drafts: any[] = []; const reqs: number[] = [];
  for (let round = 0; round < 12; round++) {
    const r = await post('onboarding/reply-drafts', uid, { have: drafts.map((d) => d.reviewId) });
    reqs.push(r.seconds);
    drafts.push(...(r.json.drafts || []));
    if (!r.json.remaining || !(r.json.drafts || []).length) break;
  }
  return { drafts, reqs };
}
/** What the tick-and-check screen sends: one request per change, then "finish". */
async function applyAll(uid: string, audit: any, previews: any, drafts: any[]) {
  const steps: Array<{ step: string; seconds: number; ok: boolean; message?: string }> = [];
  const requestSeconds: number[] = [];
  const one = async (body: any) => { const r = await post('profile-fix', uid, body); requestSeconds.push(r.seconds); steps.push({ step: body.step, seconds: r.seconds, ok: body.step === 'finish' ? !!r.json.finished : !!r.json.result?.ok, message: r.json.result?.message }); return r; };
  const fixes: string[] = (audit?.audit?.fixes || []).map((f: any) => f.key);
  if (previews?.description) await one({ step: 'description', text: previews.description });
  if (previews?.services?.length) await one({ step: 'services', names: previews.services });
  if (previews?.categories?.length) await one({ step: 'categories', names: previews.categories });
  if (fixes.includes('hours')) await one({ step: 'hours', hours: WEEK }); // the shop's own hours, typed in
  // Replies go five to a request, as the screen sends them; each has its own result.
  const good = drafts.filter((x) => x.text);
  for (let i = 0; i < good.length; i += 5) {
    const r = await post('profile-fix', uid, { step: 'replies', replies: good.slice(i, i + 5).map((d) => ({ reviewId: d.reviewId, text: d.text })) });
    for (const x of r.json.results || []) steps.push({ step: 'reply', seconds: r.seconds / Math.max(1, (r.json.results || []).length), ok: !!x.ok, message: x.message });
    requestSeconds.push(r.seconds);
  }
  if (previews?.lowStarUnreplied) await one({ step: 'lowStar' });
  if (previews?.firstPost) await one({ step: 'firstPost', text: previews.firstPost });
  const fin = await one({ step: 'finish' });
  return { steps, requests: requestSeconds.length, seconds: requestSeconds.reduce((s, x) => s + x, 0), longest: Math.max(...requestSeconds), failed: steps.filter((x) => !x.ok), measured: fin.json.measured?.score ?? null };
}

/** One shop: audit, suggestions and drafts, a person reading, then every change applied and checked. */
async function onboardOne(i: number, thinkMs: number, sessions?: Array<{ t: number; end: number }>) {
  const uid = `user-${i}`;
  const start = H.sim.clock.now;
  const audit = await post('audit', uid);
  const previews = await post('audit/previews', uid);
  const d = await allDrafts(uid);
  await H.sim.clock.wait(thinkMs);
  const fix = await applyAll(uid, audit.json, previews.json.previews, d.drafts);
  sessions?.push({ t: start, end: H.sim.clock.now });
  return { audit, previews, drafts: d, fix, wall: (H.sim.clock.now - start) / 1000 };
}

describe('92 shops in one week', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); });

  // ── 1. Onboarding path, one shop at a time, measured per request ──────────
  for (const shape of ['healthy', 'empty20', 'empty5'] as Shape[]) {
    it(`onboarding path: ${shape}`, async () => {
      const stop = await H.world_(1, (c) => { freshJoiner(c.users, c.profiles, 1); });
      shapeListing(1, shape);
      installLog(); calls = []; fault = null;
      try {
        const uid = 'user-1';
        H.sim.count = newCounters();
        const audit = await post('audit', uid);
        const previews = await post('audit/previews', uid);
        const d = await allDrafts(uid);
        const beforeApply = calls.length;
        const fix = await applyAll(uid, audit.json, previews.json.previews, d.drafts);
        const l = H.world.personas.s1.listings[0];
        out.onboarding[shape] = {
          fixesOffered: audit.json.audit?.fixes?.map((f: any) => f.key),
          auditSeconds: audit.seconds, previewsSeconds: previews.seconds,
          draftRequests: d.reqs.length, longestDraftRequestSeconds: Math.max(0, ...d.reqs), draftsWritten: d.drafts.length,
          applyRequests: fix.requests, changesApplied: fix.steps.length, longestApplyRequestSeconds: fix.longest, applyTotalSeconds: Math.round(fix.seconds * 10) / 10,
          stepsNotDone: fix.failed.map((x) => `${x.step}: ${x.message}`),
          googleCallsTotal: calls.filter((c) => isGoogle(c.kind)).length, googleCallsWhileApplying: calls.slice(beforeApply).filter((c) => isGoogle(c.kind)).length,
          modelCalls: calls.filter((c) => c.kind === 'model').length,
          repliesPublished: l.writes.filter((w) => w.what === 'reply').length,
          scoreBefore: audit.json.audit?.score, scoreMeasuredAfter: fix.measured,
          after: { onboarding_step: H.sim.tables.users[0].onboarding_step, posts: H.sim.tables.scheduled_posts.map((p: any) => p.status), reviewsRecorded: H.sim.tables.reviews.length, pendingReplies: H.sim.tables.review_replies.filter((r: any) => r.status === 'pending').length, changeLog: H.sim.tables.change_log.length },
        };
        expect(audit.status).toBe(200);
      } finally { stop(); }
    });
  }

  // ── 1b. Same empty20 shop, at a slower model (5 s) ────────────────────────
  it('onboarding path: empty20 with the model at 5 s', async () => {
    const was = LATENCY.model; (LATENCY as any).model = 5000;
    const stop = await H.world_(1, (c) => { freshJoiner(c.users, c.profiles, 1); });
    shapeListing(1, 'empty20'); installLog(); calls = []; fault = null;
    try {
      const a = await post('audit', 'user-1'); const p = await post('audit/previews', 'user-1'); const d = await allDrafts('user-1');
      const f = await applyAll('user-1', a.json, p.json.previews, d.drafts);
      out.onboarding.empty20_model5s = { audit: a.seconds, previews: p.seconds, longestDraftRequestSeconds: Math.max(...d.reqs), longestApplyRequestSeconds: f.longest, repliesPublished: H.world.personas.s1.listings[0].writes.filter((w) => w.what === 'reply').length, stepsNotDone: f.failed.length };
    } finally { stop(); (LATENCY as any).model = was; }
  });

  // ── 3. Arrival shapes: Google and model calls per minute ──────────────────
  const mix = (i: number): Shape => (i % 3 === 0 ? 'healthy' : i % 3 === 1 ? 'empty20' : 'empty5');
  const think = (i: number) => 60_000 + ((i * 37) % 120) * 1000; // 60 to 180 s reading the previews (ASSUMED)
  async function arrivals(label: string, n: number, offsetsMs: number[], shapeOf: (i: number) => Shape) {
    const stop = await H.world_(n, (c) => { for (let i = 1; i <= n; i++) freshJoiner(c.users, c.profiles, i); });
    for (let i = 1; i <= n; i++) shapeListing(i, shapeOf(i));
    installLog(); calls = []; fault = null;
    const sessions: Array<{ t: number; end: number }> = [];
    try {
      await preload();
      const t0 = H.sim.clock.now;
      const results = await Promise.all(offsetsMs.map(async (off, k) => { await H.sim.clock.wait(off); return onboardOne(k + 1, think(k + 1), sessions); }));
      const fixes = results.map((r) => r.fix.longest);
      const everyRequest = results.flatMap((r) => [r.audit.seconds, r.previews.seconds, ...r.drafts.reqs, ...r.fix.steps.map((x: any) => x.seconds)]);
      out.arrivals[label] = {
        shops: n, spanMinutes: Math.round((H.sim.clock.now - t0) / 60_000),
        peakConcurrentSessions: peakConcurrent(sessions),
        googleCallsTotal: calls.filter((c) => isGoogle(c.kind)).length,
        googleCallsPerShop: Math.round((calls.filter((c) => isGoogle(c.kind)).length / n) * 10) / 10,
        peakGooglePerMinute: peakPerMinute(calls, (c) => isGoogle(c.kind)),
        peakGoogleWritesPerMinute: peakPerMinute(calls, (c) => c.kind === 'googleWrite'),
        modelCallsTotal: calls.filter((c) => c.kind === 'model').length,
        peakModelPerMinute: peakPerMinute(calls, (c) => c.kind === 'model'),
        peakConcurrentModelCalls: peakConcurrent(calls.filter((c) => c.kind === 'model')),
        requestsOver60s: everyRequest.filter((x) => x > 60).length,
        requestsOver10s: everyRequest.filter((x) => x > 10).length,
        longestSingleRequestSeconds: Math.max(...everyRequest),
        stepsNotDone: results.reduce((n, r) => n + r.fix.failed.length, 0),
        shopsWithEveryStepDone: results.filter((r) => r.fix.failed.length === 0).length,
        wallSecondsMedian: results.map((r) => r.wall).sort((a, b) => a - b)[Math.floor(n / 2)],
        wallSecondsMax: Math.max(...results.map((r) => r.wall)),
        dbRequests: H.sim.count.calls.db,
      };
    } finally { stop(); }
  }
  it('arrivals: spike, 60 shops in 2 hours, front-loaded', async () => {
    const mean = 15 * 60_000, span = 120 * 60_000, n = 60;
    const offs = Array.from({ length: n }, (_, i) => -mean * Math.log(1 - ((i + 0.5) / n) * (1 - Math.exp(-span / mean))));
    await arrivals('spike60in2h_mixed', n, offs, mix);
  });
  it('arrivals: spike, same shape, every shop empty with 20 reviews', async () => {
    const mean = 15 * 60_000, span = 120 * 60_000, n = 60;
    const offs = Array.from({ length: n }, (_, i) => -mean * Math.log(1 - ((i + 0.5) / n) * (1 - Math.exp(-span / mean))));
    await arrivals('spike60in2h_allEmpty20', n, offs, () => 'empty20');
  });
  it('arrivals: 10 shops press go in the same second', async () => {
    await arrivals('tenAtOnce_mixed', 10, Array.from({ length: 10 }, () => 0), mix);
  });
  it('arrivals: even, 92 shops over 5 working days (one day of it: 19 shops over 8 hours)', async () => {
    const n = 19; // 92 / 5 rounded up
    await arrivals('evenOneDay19', n, Array.from({ length: n }, (_, i) => i * (8 * 3_600_000 / n)), mix);
  });

  // ── 3b. A 429 mid-onboarding: which step fails and what is recorded ───────
  const faults: Array<[string, (u: string, m: string) => number | null]> = [
    ['429 on the history (performance) request', (u) => (u.includes('businessprofileperformance') ? 429 : null)],
    ['429 on the first listing read (getLocationFull) in the audit', (u, m) => (m === 'GET' && /businessinformation\.googleapis\.com\/v1\/locations\/\d+$/.test(u.split('?')[0]) ? 429 : null)],
    ['429 on the token refresh', (u) => (u.includes('oauth2.googleapis.com/token') ? 429 : null)],
    ['429 on every listing edit (PATCH)', (_u, m) => (m === 'PATCH' ? 429 : null)],
    ['429 on every review reply (PUT)', (_u, m) => (m === 'PUT' ? 429 : null)],
    ['429 from the model on every call', (u) => (u.includes('api.anthropic.com') ? 429 : null)],
  ];
  for (const [label, rule] of faults) {
    it(`fault: ${label}`, async () => {
      const stop = await H.world_(1, (c) => { freshJoiner(c.users, c.profiles, 1); });
      shapeListing(1, 'empty20'); installLog(); calls = [];
      try {
        // For the PATCH / PUT / first-read cases the fault starts where it would bite; previews are fetched clean.
        const onlyFix = label.includes('PATCH') || label.includes('PUT');
        fault = onlyFix ? null : rule;
        const a = await post('audit', 'user-1');
        const p = a.status === 200 ? await post('audit/previews', 'user-1') : null;
        const d = a.status === 200 ? await allDrafts('user-1') : null;
        fault = rule;
        const f = a.status === 200 ? await applyAll('user-1', a.json, p!.json.previews, d!.drafts) : null;
        out.faults[label] = {
          audit: { status: a.status, code: a.json.code ?? null, seconds: a.seconds },
          previews: p ? { status: p.status, got: Object.entries(p.json.previews || {}).filter(([, v]) => v).map(([k]) => k) } : 'not reached',
          drafts: d ? d.drafts.filter((x) => x.text).length : 'not reached',
          apply: f ? { requests: f.requests, changes: f.steps.length, done: f.steps.filter((x) => x.ok).length, notDone: f.failed.map((x) => `${x.step}: ${x.message}`).slice(0, 4), longestRequestSeconds: f.longest } : 'not reached',
          recorded: { token_status: H.sim.tables.users[0].token_status, onboarding_step: H.sim.tables.users[0].onboarding_step, backfilled: !!H.sim.tables.profiles[0].metrics_backfilled_at, changeLog: H.sim.tables.change_log.reduce((m: any, r: any) => { m[`${r.action}:${r.status}`] = (m[`${r.action}:${r.status}`] || 0) + 1; return m; }, {}) },
          requestsSeenIncludingRetries: calls.length,
        };
      } finally { fault = null; stop(); }
    });
  }

  // ── 4. Scheduled jobs at 92: one run each (same scenarios as the stack's scale check) ──
  const SCENARIOS: H.Scenario[] = [
    { job: 'post-generator', label: 'established shops, every shop gets its weekly post', schedule: 'Fri */5 09-12', setup: (c) => H.seedPublishedPosts(c) },
    { job: 'post-publisher', label: 'a normal 15-minute slice', schedule: '*/15', setup: (c) => { H.seedPublishedPosts(c, 1); H.seedDuePosts(c, H.everyNth(c.profiles, 1 / 12)); } },
    { job: 'post-publisher', label: 'every post due at once', schedule: '*/15', setup: (c) => { H.seedPublishedPosts(c, 1); H.seedDuePosts(c, c.profiles); } },
    { job: 'review-alerts', label: 'quiet day: 1 in 20 has a new review', schedule: '*/15 08-18', setup: (c) => H.seedReviews(c, 1 / 20) },
    { job: 'review-alerts', label: 'busy day: 1 in 5 has a new review', schedule: '*/15 08-18', setup: (c) => H.seedReviews(c, 1 / 5) },
    { job: 'monday-stats', label: 'every shop gets its weekly text', schedule: 'Mon */5 08-10' },
    { job: 'monthly-report', label: 'every shop gets its report', schedule: '1st,2nd */5 08-11', setup: (c) => H.seedMetrics(c) },
    { job: 'onboarding-sequence', label: 'as the harness models it: 1 in 10 with a numeric step', schedule: 'daily 10:00', setup: (c) => { c.users.forEach((u, i) => { if (i % 10 === 0) { u.onboarding_step = 3; u.created_at = new Date(Date.now() - 3 * DAY).toISOString(); } }); } },
    { job: 'metrics-sync', label: 'every shop due its daily resync', schedule: 'hourly :20', setup: (c) => { c.profiles.forEach((p) => { p.metrics_synced_at = new Date(Date.now() - 21 * 3_600_000).toISOString(); }); } },
    { job: 'post-previews', label: 'switched off (default); 92 first posts waiting', schedule: 'hourly :40', setup: (c) => { c.profiles.forEach((p) => c.sim.tables.scheduled_posts.push({ id: `await-${p.id}`, profile_id: p.id, content: 'Waiting.', status: 'awaiting_approval', preview_sent_at: null, scheduled_for: new Date(Date.now() + 12 * 3_600_000).toISOString() })); } },
    { job: 'post-previews', label: 'switched on; all 92 first posts due in the same hour', schedule: 'hourly :40', env: { EARLY_POST_PREVIEW_EMAILS: 'on' }, setup: (c) => { c.profiles.forEach((p) => c.sim.tables.scheduled_posts.push({ id: `await-${p.id}`, profile_id: p.id, content: 'Waiting.', status: 'awaiting_approval', preview_sent_at: null, scheduled_for: new Date(Date.now() + 12 * 3_600_000).toISOString() })); } },
  ];
  for (const s of SCENARIOS) it(`one run at ${N}: ${s.job}: ${s.label}`, async () => { await H.run(s, N); });

  // ── 4b. Week one: every shop is new ───────────────────────────────────────
  /** All N shops finished onboarding in the last 5 days: no published posts, one first post awaiting approval. */
  const weekOne = (c: any) => {
    c.users.forEach((u: any, i: number) => { u.onboarding_step = 'complete'; u.created_at = new Date(Date.now() - ((i % 5) + 0.5) * DAY).toISOString(); });
    c.profiles.forEach((p: any, i: number) => {
      p.total_auto_posts = 0; p.streak_weeks = 0; p.created_at = c.users[i].created_at;
      p.metrics_backfilled_at = c.users[i].created_at; p.metrics_synced_at = new Date(Date.now() - 2 * 3_600_000).toISOString();
      c.sim.tables.scheduled_posts.push({ id: `first-${p.id}`, profile_id: p.id, content: 'First post.', status: 'awaiting_approval', preview_sent_at: null, scheduled_for: new Date(Date.parse(c.users[i].created_at) + DAY).toISOString(), created_at: c.users[i].created_at, photo_id: null });
    });
  };

  it('week one: Friday post writer, two Fridays running, nobody approves', async () => {
    const stop = await H.world_(N, weekOne);
    try {
      const d1 = await H.drain('post-generator', 5, 48, (r) => r.remaining === 0);
      const afterFirst = H.sim.tables.scheduled_posts.filter((p: any) => p.status === 'awaiting_approval').length;
      const emails1 = H.world.emails.length;
      H.advanceMinutes(7 * 24 * 60);
      const d2 = await H.drain('post-generator', 5, 48, (r) => r.remaining === 0);
      const awaiting = H.sim.tables.scheduled_posts.filter((p: any) => p.status === 'awaiting_approval');
      const perShop = new Map<string, number>(); for (const p of awaiting) perShop.set(p.profile_id, (perShop.get(p.profile_id) || 0) + 1);
      const pub = await H.callCron('post-publisher');
      out.weekOne.postGenerator = { firstFriday: { runs: d1.runs, minutes: (d1.runs - 1) * 5, longestRunSeconds: d1.longestRunSeconds, awaitingAfter: afterFirst, emailsSent: emails1 }, secondFriday: { runs: d2.runs, longestRunSeconds: d2.longestRunSeconds }, awaitingTotalAfterTwoFridays: awaiting.length, awaitingPerShop: Array.from(new Set(perShop.values())), emailsSentTotal: H.world.emails.length, modelCalls: H.world.modelCalls.length, publisherAfter: pub.result };
      out.drains.push({ job: 'post-generator (week one, all awaiting approval)', shops: N, runsAvailable: 48, runsUsed: d1.runs, minutesToFinish: (d1.runs - 1) * 5 + Math.ceil(d1.longestRunSeconds / 60), longestRunSeconds: d1.longestRunSeconds, reached: afterFirst - N });
    } finally { stop(); }
  });

  it('established: Friday post writer drain at 92 (with preview emails)', async () => {
    const stop = await H.world_(N, (c) => H.seedPublishedPosts(c));
    try {
      const d = await H.drain('post-generator', 5, 48, (r) => r.remaining === 0);
      out.drains.push({ job: 'post-generator (established shops)', shops: N, runsAvailable: 48, runsUsed: d.runs, minutesToFinish: (d.runs - 1) * 5 + 1, longestRunSeconds: d.longestRunSeconds, reached: H.world.emails.length, emailsPerRun: d.results.map((r: any) => r.generated) });
    } finally { stop(); }
  });

  it('week one: Monday stats text', async () => {
    const stop = await H.world_(N, weekOne);
    try {
      const d = await H.drain('monday-stats', 5, 36, (r) => r.remaining === 0);
      out.weekOne.mondayStats = { sampleText: H.world.sms[0]?.body, texts: H.world.sms.length, textsPerRun: d.results.map((r: any) => r.sent) };
      out.drains.push({ job: 'monday-stats', shops: N, runsAvailable: 36, runsUsed: d.runs, minutesToFinish: (d.runs - 1) * 5 + 1, longestRunSeconds: d.longestRunSeconds, reached: H.world.sms.length, duplicates: H.world.sms.length - H.sim.tables.weekly_stats.length });
    } finally { stop(); }
  });

  for (const [label, fraction] of [['quiet day, 1 in 20', 1 / 20], ['busy day, 1 in 5', 1 / 5]] as const) {
    it(`review check through one working day (${label})`, async () => {
      const stop = await H.world_(N, (c) => H.seedReviews(c, fraction));
      try {
        const d = await H.drain('review-alerts', 15, 44, () => false);
        const fresh = Object.values(H.world.personas).filter((p) => p.listings[0].reviews.some((r) => r.reviewId === 'fresh')).length;
        const replied = Object.values(H.world.personas).filter((p) => p.listings[0].reviews.find((r) => r.reviewId === 'fresh')?.reviewReply).length;
        const firstRunAllAnswered = d.results.findIndex((_: any, k: number) => d.results.slice(0, k + 1).reduce((s: number, r: any) => s + r.processed, 0) >= fresh) + 1;
        out.drains.push({ job: `review-alerts (${label})`, shops: N, runsAvailable: 44, runsUsed: d.runs, longestRunSeconds: d.longestRunSeconds, reached: H.reviewsReadFor.size, newReviews: fresh, answered: replied, runsUntilAllAnswered: firstRunAllAnswered, shopsCheckedPerRun: [Math.min(...d.results.map((r: any) => r.checked)), Math.max(...d.results.map((r: any) => r.checked))], texts: H.world.sms.length });
      } finally { stop(); }
    });
  }

  it('week one: review check the day after a spike (leftover reviews on every listing)', async () => {
    // Every shop: 40 unanswered reviews older than 14 days that onboarding did not reach (over the cap of 20),
    // 1 shop in 5 also has 3 recent unanswered 5-star reviews, 1 in 10 a recent 2-star not queued at onboarding.
    const stop = await H.world_(N, (c) => {
      weekOne(c);
      c.profiles.forEach((p: any, i: number) => {
        const l = c.world.personas[`s${i + 1}`].listings[0];
        for (let k = 0; k < 40; k++) addReview(l, `s${i}-old-${k}`, 'FIVE', 30 + k, 'Old and never answered.', 'Olga Old');
        if (i % 5 === 0) for (let k = 0; k < 3; k++) addReview(l, `s${i}-new-${k}`, 'FIVE', 2 + k, 'Recent and unanswered.', 'Nina New');
        if (i % 10 === 0) addReview(l, `s${i}-low`, 'TWO', 4, 'Recent low star.', 'Larry Low');
      });
    });
    try {
      const d = await H.drain('review-alerts', 15, 44, () => false);
      const all = Object.values(H.world.personas).flatMap((p) => p.listings[0].reviews);
      out.weekOne.reviewCheckAfterSpike = {
        longestRunSeconds: d.longestRunSeconds, shopsReached: H.reviewsReadFor.size,
        oldUnanswered: all.filter((r) => r.reviewId.includes('-old-')).length, oldAnsweredByUs: all.filter((r) => r.reviewId.includes('-old-') && r.reviewReply).length,
        oldRecordedAsSeen: H.sim.tables.reviews.filter((r: any) => String(r.google_review_id).includes('-old-')).length,
        recentUnanswered: all.filter((r) => r.reviewId.includes('-new-')).length, recentAnswered: all.filter((r) => r.reviewId.includes('-new-') && r.reviewReply).length,
        lowStarPendingForApproval: H.sim.tables.review_replies.filter((r: any) => r.status === 'pending').length,
        texts: H.world.sms.length, emails: H.world.emails.length,
        runWhenLastRecentAnswered: d.results.findIndex((_: any, k: number) => d.results.slice(0, k + 1).reduce((s: number, r: any) => s + r.processed, 0) >= 63) + 1,
      };
    } finally { stop(); }
  });

  it('monthly report on the 1st with 92 shops (week-one shops, history present)', async () => {
    const stop = await H.world_(N, (c) => { weekOne(c); H.seedMetrics(c); });
    try {
      const d = await H.drain('monthly-report', 5, 48, (r) => r.remaining === 0);
      const to = H.world.emails.map((e) => e.to);
      out.drains.push({ job: 'monthly-report', shops: N, runsAvailable: 48, runsUsed: d.runs, minutesToFinish: (d.runs - 1) * 5 + 1, longestRunSeconds: d.longestRunSeconds, reached: new Set(to).size, duplicates: to.length - new Set(to).size, emailsPerRun: d.results.map((r: any) => r.sent ?? r.reports ?? null), texts: H.world.sms.length });
      out.weekOne.monthlyReport = { result0: d.results[0], subject: H.world.emails[0]?.subject };
    } finally { stop(); }
  });

  it('post publisher: all 92 first posts approved and due at the same time', async () => {
    const stop = await H.world_(N, (c) => { H.seedDuePosts(c, c.profiles); });
    try {
      const d = await H.drain('post-publisher', 15, 60, (r) => r.published === 0);
      out.drains.push({ job: 'post-publisher (92 due at once)', shops: N, runsAvailable: 96, runsUsed: d.runs - 1, minutesToFinish: (d.runs - 2) * 15 + 1, longestRunSeconds: d.longestRunSeconds, reached: H.sim.tables.scheduled_posts.filter((p: any) => p.status === 'published').length, texts: H.world.sms.length, perRun: d.results.map((r: any) => r.published) });
    } finally { stop(); }
  });

  it('metrics-sync: all 92 history pulls failed at onboarding and are retried hourly', async () => {
    const stop = await H.world_(N, (c) => { weekOne(c); c.profiles.forEach((p: any) => { p.metrics_backfilled_at = null; p.metrics_synced_at = null; }); });
    try {
      const d = await H.drain('metrics-sync', 60, 30, (r) => r.queued - r.synced - r.failed <= 0);
      out.drains.push({ job: 'metrics-sync (92 history backfills)', shops: N, runsAvailable: 24, runsUsed: d.runs, minutesToFinish: (d.runs - 1) * 60 + 1, longestRunSeconds: d.longestRunSeconds, reached: H.sim.tables.profiles.filter((p: any) => p.metrics_backfilled_at).length, perRun: d.results.map((r: any) => r.synced), rows: H.sim.tables.daily_metrics.length });
    } finally { stop(); }
  });

  it('metrics-sync: 30 listings whose history pull always fails, 62 due a normal resync', async () => {
    const stop = await H.world_(N, (c) => { c.profiles.forEach((p: any, i: number) => { if (i < 30) { p.metrics_backfilled_at = null; p.metrics_synced_at = null; } else p.metrics_synced_at = new Date(Date.now() - 21 * 3_600_000).toISOString(); }); });
    installLog(); calls = [];
    fault = (u) => { const m = /locations\/(\d+):fetchMulti/.exec(u); return m && Number(m[1]) - 9000 <= 30 ? 429 : null; };
    try {
      const d = await H.drain('metrics-sync', 60, 24, () => false);
      const resynced = H.sim.tables.profiles.filter((p: any, i: number) => i >= 30 && Date.parse(p.metrics_synced_at) > H.SIM_START).length;
      out.weekOne.metricsSyncStarvation = { runs: d.runs, perRun: d.results.slice(0, 4), healthyListingsResyncedIn24Runs: resynced, ofHealthy: 62, longestRunSeconds: d.longestRunSeconds };
    } finally { fault = null; stop(); }
  });

  it('onboarding-sequence: with the values the app actually writes', async () => {
    const stop = await H.world_(N, (c) => { c.users.forEach((u: any, i: number) => { u.onboarding_step = i % 2 ? 'complete' : 'pending'; u.created_at = new Date(Date.now() - 3_600_000).toISOString(); }); });
    try { const r = await H.callCron('onboarding-sequence'); out.weekOne.onboardingSequenceReal = { ...r, texts: H.world.sms.length, emails: H.world.emails.length }; } finally { stop(); }
  });
  it('onboarding-sequence: if the step were numeric, 60 shops on day 0', async () => {
    const stop = await H.world_(N, (c) => { c.users.forEach((u: any, i: number) => { if (i < 60) { u.onboarding_step = 0; u.created_at = new Date(Date.now() - 3_600_000).toISOString(); } }); });
    try { const r = await H.callCron('onboarding-sequence'); out.weekOne.onboardingSequenceIfNumeric = { ...r, texts: H.world.sms.length, emails: H.world.emails.length }; } finally { stop(); }
  });

  it('writes the results', () => {
    out.jobs = H.rows.map((r) => ({ job: r.job, label: r.label, schedule: r.schedule, shops: r.shops, seconds: r.seconds, perShopMs: r.perShopMs, calls: r.calls, result: r.result, biggestRead: r.biggestRead }));
    if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
    expect(H.rows.length).toBe(SCENARIOS.length);
  });
});
