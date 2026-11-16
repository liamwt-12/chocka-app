import { describe, it, expect, vi } from 'vitest';
import { presenceComparison, livePresenceScore } from './presence-score';
import { monthlyReportEmail } from './email';

describe('presenceComparison', () => {
  it('reports a rise, a fall and no change against activation', () => {
    expect(presenceComparison(82, 64)).toBe('Up 18 points from 64 when we started.');
    expect(presenceComparison(63, 64)).toBe('Down 1 point from 64 when we started.');
    expect(presenceComparison(64, 64)).toBe('The same as when we started (64).');
  });
  it('says so plainly when there is no activation score', () => {
    expect(presenceComparison(70, null)).toMatch(/first presence score/);
    expect(presenceComparison(70, undefined)).toMatch(/first presence score/);
  });
});

describe('monthlyReportEmail', () => {
  const base = { businessName: 'Testwell Flooring', month: 'November 2026', postsPublished: 4, reviewsReplied: 3, totalViews: 1200, totalCalls: 9 };

  it('includes the presence score, the comparison and directions', () => {
    const html = monthlyReportEmail({ ...base, totalDirections: 17, presenceScore: 81, presenceBand: 'Strong', presenceScoreAtStart: 62 });
    expect(html).toContain('Your Google presence score');
    expect(html).toContain('81<span');
    expect(html).toContain('Up 19 points from 62 when we started.');
    expect(html).toContain('Direction Requests');
    expect(html).toContain('17');
  });

  it('still renders, without a score block, when Google could not be reached', () => {
    const html = monthlyReportEmail({ ...base, presenceScore: null });
    expect(html).not.toContain('Your Google presence score');
    expect(html).toContain('Posts Published');
  });
});

describe('livePresenceScore', () => {
  const listing = JSON.stringify({ name: 'locations/1', profile: { description: 'x'.repeat(300) }, regularHours: { periods: [] } });
  const isListing = (u: string) => u.includes('mybusinessbusinessinformation') && !u.includes(':getGoogleUpdated') && !u.includes('/attributes');

  it('scores from the same reads as /api/audit when every part can be read', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (isListing(u)) return new Response(listing, { status: 200 });
      if (u.includes(':getGoogleUpdated')) return new Response('none', { status: 404 }); // optional: a 404 here is normal
      return new Response(JSON.stringify({ attributes: [], mediaItems: [], reviews: [], localPosts: [] }), { status: 200 });
    }) as any;
    const r = await livePresenceScore('t', 'locations/1', 'accounts/9');
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('gives NO score if reviews, photos, posts or attributes cannot be read, rather than a falsely low one', async () => {
    for (const broken of ['/reviews', '/media', '/localPosts', '/attributes']) {
      global.fetch = vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes(broken)) return new Response('unavailable', { status: 503 });
        if (isListing(u)) return new Response(listing, { status: 200 });
        if (u.includes(':getGoogleUpdated')) return new Response('none', { status: 404 });
        return new Response(JSON.stringify({ attributes: [], mediaItems: [], reviews: [], localPosts: [] }), { status: 200 });
      }) as any;
      await expect(livePresenceScore('t', 'locations/1', 'accounts/9')).rejects.toThrow();
    }
  });

  it('throws if the listing itself cannot be read', async () => {
    global.fetch = vi.fn(async () => new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })) as any;
    await expect(livePresenceScore('t', 'locations/1')).rejects.toThrow();
  });
});
