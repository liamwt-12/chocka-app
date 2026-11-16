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
  it('with nothing passed, the email is as it was', () => {
    const base = { businessName: 'Floors A', month: 'November 2026', postsPublished: 2, reviewsReplied: 1, totalViews: 100, totalCalls: 5, totalDirections: 3 };
    expect(monthlyReportEmail({ ...base, narrativeHtml: '' })).toBe(monthlyReportEmail(base));
    expect(monthlyReportEmail({ ...base, narrativeHtml: '<div>WORDS</div>' })).toContain('<div>WORDS</div>');
  });
});

describe('what we did: only what is on record', () => {
  it('says what was published and replied to, with the right plurals', () => {
    expect(whatWeDid(D({ postsPublished: 4, repliesPosted: 1 }))).toEqual(['We published 4 posts on your Google listing.', 'We replied to 1 review.']);
  });
  it('a change the shop chose is the shop\'s, said once', () => {
    expect(whatWeDid(D({ postsPublished: 1, listingChanges: [{ what: 'opening hours', by: 'shop' }, { what: 'Opening hours', by: 'shop' }, { what: 'description', by: 'shop' }] }))[1]).toBe('You updated your opening hours and description, and we put them on your listing.');
    expect(whatWeDid(D({ postsPublished: 1, listingChanges: [{ what: 'website', by: 'shop' }] }))[1]).toBe('You updated your website, and we put it on your listing.');
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
  it('gives this month and last, and a percentage only on a base of 20 or more', () => {
    expect(whatChanged(now, { views: 1000, calls: 20, websiteClicks: 12, directions: 10 })).toEqual([
      'Calls from your listing: 30, up from 20 last month (+50%).',
      'Website clicks: 12, the same as last month.',
      'Requests for directions: 8, down from 10 last month.',
      'Times you were seen on Google: 1,200, up from 1,000 last month (+20%).',
    ]);
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
