/**
 * Scale check: the scheduled jobs, run against 10, 180 and 500 simulated shops.
 *
 *     npx vitest run --config scripts/scale-check/vitest.config.ts
 *
 * Nothing real is touched. The database is in memory (./sim.ts), Google, the
 * model, email and SMS are the fakes from the dummy run, and time is virtual:
 * each kind of call is charged a fixed, stated cost, so the result is how long
 * a run WOULD take, worked out in a few seconds.
 *
 * It runs the real route handlers, so what is counted is what the code does.
 *
 * Not part of `npm test`: the file is not named *.test.ts.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { LATENCY } from './sim';
import { run, rows, drain, world_, sim, world, reviewsReadFor, seedPublishedPosts, seedDuePosts, seedReviews, seedMetrics, everyNth, DAY, type Scenario, type Row } from './harness';

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('./harness')).dbProxy }));

const SIZES = [10, 180, 500];

const SCENARIOS: Scenario[] = [
  { job: 'post-generator', label: 'every shop gets its weekly post', schedule: 'Fridays 09:00', setup: (c) => seedPublishedPosts(c) },
  { job: 'post-publisher', label: 'a normal 15-minute slice (posts are spread over 3 hours)', schedule: 'every 15 minutes', setup: (c) => { seedPublishedPosts(c, 1); seedDuePosts(c, everyNth(c.profiles, 1 / 12)); } },
  { job: 'post-publisher', label: 'worst case: every post due at once (after an outage)', schedule: 'every 15 minutes', setup: (c) => { seedPublishedPosts(c, 1); seedDuePosts(c, c.profiles); } },
  { job: 'review-alerts', label: 'a quiet day: 1 shop in 20 has a new review', schedule: 'daily 09:00', setup: (c) => seedReviews(c, 1 / 20) },
  { job: 'review-alerts', label: 'a busy day: 1 shop in 5 has a new review', schedule: 'daily 09:00', setup: (c) => seedReviews(c, 1 / 5) },
  { job: 'monday-stats', label: 'every shop gets its weekly text', schedule: 'Mondays 08:00' },
  { job: 'monthly-report', label: 'every shop gets its report; no ad dates', schedule: '1st of the month 08:00', setup: (c) => seedMetrics(c) },
  { job: 'monthly-report', label: 'every shop gets its report; 1 shop in 5 has an ad date', schedule: '1st of the month 08:00', setup: (c) => { seedMetrics(c); const start = new Date(Date.now() - 35 * DAY).toISOString().slice(0, 10); c.sim.tables.retailers.forEach((r, i) => { if (i % 5 === 0) r.ad_start_date = start; }); } },
  { job: 'onboarding-sequence', label: '1 shop in 10 is in its first week', schedule: 'daily 10:00', setup: (c) => { c.users.forEach((u, i) => { if (i % 10 === 0) { u.onboarding_step = 3; u.created_at = new Date(Date.now() - 3 * DAY).toISOString(); } }); } },
  { job: 'metrics-sync', label: 'every shop is due (the normal daily state)', schedule: 'hourly, at 20 past', setup: (c) => { c.profiles.forEach((p) => { p.metrics_synced_at = new Date(Date.now() - 21 * 3_600_000).toISOString(); }); } },
  { job: 'post-previews', label: 'switched off (the default)', schedule: 'hourly, at 40 past', setup: (c) => { everyNth(c.profiles, 1 / 10).forEach((p) => c.sim.tables.scheduled_posts.push({ id: `await-${p.id}`, profile_id: p.id, content: 'Waiting.', status: 'awaiting_approval', preview_sent_at: null, scheduled_for: new Date(Date.now() + 12 * 3_600_000).toISOString() })); } },
  { job: 'post-previews', label: 'switched on; 1 shop in 10 has a post waiting', schedule: 'hourly, at 40 past', env: { EARLY_POST_PREVIEW_EMAILS: 'on' }, setup: (c) => { everyNth(c.profiles, 1 / 10).forEach((p) => c.sim.tables.scheduled_posts.push({ id: `await-${p.id}`, profile_id: p.id, content: 'Waiting.', status: 'awaiting_approval', preview_sent_at: null, scheduled_for: new Date(Date.now() + 12 * 3_600_000).toISOString() })); } },
];

describe('scale check', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); });

  for (const s of SCENARIOS) for (const n of SIZES) {
    it(`${s.job}: ${s.label}: ${n} shops`, async () => { await run(s, n); }, 300_000);
  }

  // How many runs, on the new schedules, until every shop has been reached.
  const drains: any[] = [];
  for (const n of SIZES) {
    it(`post-generator, repeated every 5 minutes: ${n} shops`, async () => {
      const stop = await world_(n, (c) => seedPublishedPosts(c));
      try {
        const d = await drain('post-generator', 5, 48, (r) => r.remaining === 0);
        const posts = sim.tables.scheduled_posts.filter((p: any) => p.status !== 'published');
        drains.push({ job: 'post-generator', shops: n, runsAvailable: 48, runsUsed: d.runs, longestRunSeconds: d.longestRunSeconds, reached: posts.length, duplicates: posts.length - new Set(posts.map((p: any) => p.profile_id)).size });
      } finally { stop(); }
    }, 600_000);
    it(`monday-stats, repeated every 5 minutes: ${n} shops`, async () => {
      const stop = await world_(n);
      try {
        const d = await drain('monday-stats', 5, 36, (r) => r.remaining === 0);
        drains.push({ job: 'monday-stats', shops: n, runsAvailable: 36, runsUsed: d.runs, longestRunSeconds: d.longestRunSeconds, reached: world.sms.length, duplicates: world.sms.length - sim.tables.weekly_stats.length });
      } finally { stop(); }
    }, 600_000);
    for (const [label, fraction] of [['quiet day', 1 / 20], ['busy day', 1 / 5]] as const) {
      it(`review-alerts, every half hour for a working day (${label}): ${n} shops`, async () => {
        const stop = await world_(n, (c) => seedReviews(c, fraction));
        try {
          const d = await drain('review-alerts', 30, 22, () => false);
          const replies = Object.values(world.personas).filter((p) => p.listings[0].reviews.find((r) => r.reviewId === 'fresh')?.reviewReply).length;
          const fresh = Object.values(world.personas).filter((p) => p.listings[0].reviews.some((r) => r.reviewId === 'fresh')).length;
          drains.push({ job: `review-alerts (${label})`, shops: n, runsAvailable: 22, runsUsed: d.runs, longestRunSeconds: d.longestRunSeconds, reached: reviewsReadFor.size, newReviews: fresh, newReviewsAnswered: replies, duplicates: world.sms.length - replies });
        } finally { stop(); }
      }, 600_000);
    }
    for (const [label, withAds] of [['no ad dates', false], ['1 shop in 5 has an ad date', true]] as const) {
      it(`monthly-report, repeated every 5 minutes (${label}): ${n} shops`, async () => {
        const stop = await world_(n, (c) => {
          seedMetrics(c);
          if (withAds) { const start = new Date(Date.now() - 35 * DAY).toISOString().slice(0, 10); c.sim.tables.retailers.forEach((r: any, i: number) => { if (i % 5 === 0) r.ad_start_date = start; }); }
        });
        try {
          const d = await drain('monthly-report', 5, 48, (r) => r.remaining === 0);
          const to = world.emails.map((e) => e.to);
          drains.push({ job: `monthly-report (${label})`, shops: n, runsAvailable: 48, runsUsed: d.runs, longestRunSeconds: d.longestRunSeconds, reached: new Set(to).size, duplicates: to.length - new Set(to).size });
        } finally { stop(); }
      }, 600_000);
    }
    it(`post-publisher, every 15 minutes until a full backlog is cleared: ${n} shops`, async () => {
      const stop = await world_(n, (c) => { seedPublishedPosts(c, 1); seedDuePosts(c, c.profiles); });
      try {
        const d = await drain('post-publisher', 15, 60, (r) => r.published === 0);
        drains.push({ job: 'post-publisher (backlog)', shops: n, runsAvailable: 60, runsUsed: d.runs - 1, longestRunSeconds: d.longestRunSeconds, reached: sim.tables.scheduled_posts.filter((p: any) => p.id.startsWith('due-') && p.status === 'published').length, duplicates: 0 });
      } finally { stop(); }
    }, 600_000);
  }

  it('writes the results', () => {
    const out = process.env.SCALE_CHECK_OUT;
    const summary = { assumedLatencyMs: LATENCY, rows, drains };
    if (out) writeFileSync(out, JSON.stringify(summary, null, 1));
    const fmt = (r: Row) => `${r.job.padEnd(20)} ${String(r.shops).padStart(4)} shops  ${String(r.seconds).padStart(8)} s  ${String(r.perShopMs).padStart(6)} ms/shop  db ${String(r.calls.db).padStart(5)}  google ${String(r.calls.googleToken + r.calls.googleRead + r.calls.googleWrite + r.calls.googleMetrics).padStart(5)}  model ${String(r.calls.model).padStart(4)}  msgs ${String(r.calls.email + r.calls.sms).padStart(4)}  ${r.label}  ${JSON.stringify(r.result).slice(0, 70)}`;
    console.log('\n' + rows.map(fmt).join('\n'));
    console.log('\n' + drains.map((d) => JSON.stringify(d)).join('\n'));
    expect(rows.length).toBe(SCENARIOS.length * SIZES.length);
  });
});
