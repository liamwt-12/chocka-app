import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { plainSummaryEnabled, whatWeDid, whatChanged, narrativeHtml, type Did } from './report-narrative';
import { monthlyReportEmail } from './email';

const D = (o: Partial<Did> = {}): Did => ({ postsPublished: 0, repliesPosted: 0, listingChanges: [], repliesWaiting: 0, postsWaiting: 0, postsOn: true, repliesOn: true, ...o });

describe('off by default', () => {
  it('only "on" switches it on, and the job checks before doing any of it', () => {
    expect(plainSummaryEnabled({})).toBe(false);
    expect(plainSummaryEnabled({ MONTHLY_REPORT_PLAIN_SUMMARY: 'on' })).toBe(true);
    expect(readFileSync(new URL('../app/api/cron/monthly-report/route.ts', import.meta.url), 'utf8')).toMatch(/if \(plainSummaryEnabled\(\)\) \{/);
  });
  it('with nothing passed, the email has nothing added: not a line, not a space', () => {
    const base = { businessName: 'Floors A', month: 'November 2026', postsPublished: 2, reviewsReplied: 1, totalViews: 100, totalCalls: 5, totalDirections: 3 };
    const plain = monthlyReportEmail(base);
    expect(monthlyReportEmail({ ...base, narrativeHtml: '' })).toBe(plain);
    const withWords = monthlyReportEmail({ ...base, narrativeHtml: '<div>WORDS</div>' });
    // Take the block back out and what is left is the old email exactly.
    expect(withWords.replace('\n<div>WORDS</div>', '')).toBe(plain);
    expect(plain).toContain('in November 2026.</p>\n');
  });
  it('a failed read leaves the section out rather than saying nothing happened', async () => {
    const { loadNarrativeFacts } = await import('./report-narrative-data');
    const q: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? (r: any) => r({ data: null, error: { message: 'down' } }) : () => q) });
    await expect(loadNarrativeFacts({ from: () => q }, 'p1', '2026-11-01', '2026-12-01')).rejects.toThrow(/could not read the change log: down/);
  });
});

describe('what we did: only what is on record', () => {
  it('says what was published and replied to, with the right plurals', () => {
    expect(whatWeDid(D({ postsPublished: 4, repliesPosted: 1 }))).toEqual(['We published 4 posts on your Google listing.', 'We replied to 1 review.']);
  });
  it('a change to the listing is one the shop approved, said once', () => {
    expect(whatWeDid(D({ postsPublished: 1, listingChanges: ['opening hours', 'Opening hours', 'description'] }))[1]).toBe('You approved changes to your opening hours and description, and we put them on your listing.');
    expect(whatWeDid(D({ postsPublished: 1, listingChanges: ['website'] }))[1]).toBe('You approved changes to your website, and we put it on your listing.');
  });
  it('says what is waiting for the shop', () => {
    expect(whatWeDid(D({ repliesWaiting: 2, postsWaiting: 1 }))).toEqual(['No post went up this month.', '2 replies are waiting on your dashboard for you to approve.', '1 post is waiting on your dashboard for you to approve.']);
  });
  it('is honest when nothing happened', () => {
    expect(whatWeDid(D({ postsOn: false, repliesOn: false }))[0]).toMatch(/both switched off, so we did not post or reply/);
    expect(whatWeDid(D({ postsOn: false }))).toEqual(['Nothing needed doing on your listing this month.']);
    expect(whatWeDid(D())).toEqual(['No post went up this month.']);
  });
});

describe('what changed: both numbers, no cause', () => {
  const now = { views: 1200, calls: 30, websiteClicks: 12, directions: 8 };
  it('gives both numbers; says up or down only on a base of 20 and a move of 10%', () => {
    expect(whatChanged(now, { views: 1000, calls: 20, websiteClicks: 12, directions: 10 })).toEqual([
      'Calls from your listing: 30, up from 20 last month (+50%).',
      'Website clicks: 12, the same as last month.',
      'Requests for directions: 8 (10 last month).', // a small base: just the numbers
      'Times you were seen on Google: 1,200, up from 1,000 last month (+20%).',
    ]);
    expect(whatChanged({ ...now, views: 1050, calls: 15 }, { views: 1000, calls: 30, websiteClicks: 12, directions: 8 })).toEqual(expect.arrayContaining([
      'Times you were seen on Google: 1,050 (1,000 last month).', // +5%: not called a rise
      'Calls from your listing: 15, down from 30 last month (-50%).',
    ]));
  });
  it('a first month has figures and no comparison; no figures, nothing', () => {
    expect(whatChanged(now, null)[0]).toBe('Calls from your listing: 30.');
    expect(whatChanged(null, null)).toEqual([]);
  });
  it('never says why, never mentions money', () => {
    const text = [...whatChanged(now, { views: 1, calls: 1, websiteClicks: 1, directions: 1 }), ...whatWeDid(D({ postsPublished: 3 }))].join(' ') + narrativeHtml(['a'], ['b'], true);
    expect(text).not.toMatch(/because|thanks to|as a result|£|spend|worth/i);
    expect(narrativeHtml(['a'], ['b'], true)).toMatch(/go up and down for many reasons/);
  });
});

describe('the block for the email', () => {
  it('escapes, and is empty when there is nothing to say', () => {
    expect(narrativeHtml([], [], false)).toBe('');
    const html = narrativeHtml(['You updated your <b>hours</b> & more'], [], false);
    expect(html).toContain('&lt;b&gt;hours&lt;/b&gt; &amp; more');
    expect(html).toContain('What we did');
    expect(narrativeHtml([], ['x'], false)).toContain('Your figures this month');
    expect(narrativeHtml([], ['x'], true)).toContain('What changed');
  });
});
