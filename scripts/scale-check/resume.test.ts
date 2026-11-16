/**
 * The scheduled jobs carry on where the last run stopped: nobody is missed and
 * nobody is done twice. Run against simulated shops and a virtual clock
 * (./sim.ts), so it is part of `npm test` and takes about a second.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { drain, world_, sim, world, reviewsReadFor, seedPublishedPosts, seedDuePosts, seedReviews, callCron } from './harness';

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('./harness')).dbProxy }));

/** The scheduler stops waiting at 25 seconds (netlify/shared/run-cron.mts). */
const SCHEDULER_WAITS = 25;

describe('scheduled jobs resume across runs', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); });

  it('post-generator: 40 shops take several runs; each shop gets exactly one post; no run overruns', async () => {
    const stop = await world_(40, (c) => seedPublishedPosts(c));
    try {
      const d = await drain('post-generator', 5, 48, (r) => r.remaining === 0);
      const fresh = sim.tables.scheduled_posts.filter((p: any) => p.status !== 'published');
      expect(d.runs).toBeGreaterThan(1);
      expect(fresh).toHaveLength(40);
      expect(new Set(fresh.map((p: any) => p.profile_id)).size).toBe(40);
      expect(d.longestRunSeconds).toBeLessThan(SCHEDULER_WAITS);
      expect(d.results[0]).toMatchObject({ partial: true });
      expect(d.results[d.results.length - 1]).toMatchObject({ partial: false, remaining: 0 });
      // One more run, with nothing to do: writes nothing and is quick.
      const again = await callCron('post-generator');
      expect(again.result.generated).toBe(0);
      expect(again.seconds).toBeLessThan(1);
    } finally { stop(); }
  });

  it('post-generator: a new shop whose post is waiting for approval is not written another one', async () => {
    const stop = await world_(3, (c) => {
      // No published posts, so each of these shops is in its first three.
    });
    try {
      const first = await callCron('post-generator');
      expect(first.result.generated).toBe(3);
      expect(sim.tables.scheduled_posts.every((p: any) => p.status === 'awaiting_approval')).toBe(true);
      const second = await callCron('post-generator');
      expect(second.result.generated).toBe(0);
      expect(sim.tables.scheduled_posts).toHaveLength(3);
    } finally { stop(); }
  });

  it('monday-stats: 40 shops take several runs; each shop is texted exactly once', async () => {
    const stop = await world_(40);
    try {
      const d = await drain('monday-stats', 5, 36, (r) => r.remaining === 0);
      expect(d.runs).toBeGreaterThan(1);
      expect(world.sms).toHaveLength(40);
      expect(sim.tables.weekly_stats).toHaveLength(40);
      expect(d.longestRunSeconds).toBeLessThan(SCHEDULER_WAITS);
      const again = await callCron('monday-stats');
      expect(again.result.sent).toBe(0);
      expect(world.sms).toHaveLength(40);
    } finally { stop(); }
  });

  it('review-alerts: across a day of half-hourly runs every one of 120 shops is checked, and each new review is answered once', async () => {
    const stop = await world_(120, (c) => seedReviews(c, 1 / 5));
    try {
      const first = await callCron('review-alerts');
      expect(first.result.partial).toBe(true);
      expect(first.result.checked).toBeLessThan(120);
      const d = await drain('review-alerts', 30, 21, () => false);
      expect(reviewsReadFor.size).toBe(120);
      const withNew = Object.values(world.personas).filter((p) => p.listings[0].reviews.some((r) => r.reviewId === 'fresh'));
      expect(withNew.every((p) => p.listings[0].reviews.find((r) => r.reviewId === 'fresh')!.reviewReply)).toBe(true);
      expect(world.sms).toHaveLength(withNew.length); // one "new review" text each, never two
      expect(Math.max(first.seconds, d.longestRunSeconds)).toBeLessThan(SCHEDULER_WAITS);
    } finally { stop(); }
  });

  it('post-publisher: a backlog is cleared over several runs, each post published once, no run overruns', async () => {
    const stop = await world_(50, (c) => { seedPublishedPosts(c, 1); seedDuePosts(c, c.profiles); });
    try {
      const d = await drain('post-publisher', 15, 20, (r) => r.published === 0);
      const posted = Object.values(world.personas).reduce((n, p) => n + p.listings[0].posts.length, 0);
      expect(posted).toBe(50);
      expect(sim.tables.scheduled_posts.filter((p: any) => p.id.startsWith('due-') && p.status === 'published')).toHaveLength(50);
      expect(d.longestRunSeconds).toBeLessThan(SCHEDULER_WAITS);
    } finally { stop(); }
  });
});
