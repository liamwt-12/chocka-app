import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Every database call is recorded. The point of these tests is that a GET (what
// an email scanner does) never reaches the database write path at all.
const dbCalls: string[] = [];
vi.mock('@/lib/supabase', () => {
  const chain: any = new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === 'then') return undefined;
      dbCalls.push(prop);
      if (prop === 'single') return async () => ({ data: null, error: null });
      return () => chain;
    },
  });
  return { supabaseAdmin: { from: (t: string) => { dbCalls.push(`from:${t}`); return chain; } } };
});

import { GET as cancelGET, POST as cancelPOST } from '@/app/api/posts/cancel/route';
import { GET as replyGET } from '@/app/api/reviews/auto-reply/route';
import { generateCancelHash, generateReviewHash, linkHashMatches } from './cron';
import { confirmPage } from './result-page';
import { getTenantBySlug } from './tenant';

const POST_ID = '11111111-2222-4333-8444-555555555555';
beforeEach(() => { dbCalls.length = 0; process.env.CANCEL_HASH_SECRET = 'test-secret'; });

describe('cancel link', () => {
  it('GET with a valid link shows a confirm form and touches nothing', async () => {
    const url = `https://app.example/api/posts/cancel?id=${POST_ID}&hash=${generateCancelHash(POST_ID)}`;
    const res = await cancelGET(new NextRequest(url));
    const html = await res.text();
    expect(html).toContain('<form method="POST"');
    expect(html).toContain(`action="/api/posts/cancel?id=${POST_ID}&amp;hash=`);
    expect(dbCalls).toEqual([]);
  });

  it('GET with a bad hash says the link is invalid and touches nothing', async () => {
    const res = await cancelGET(new NextRequest(`https://app.example/api/posts/cancel?id=${POST_ID}&hash=deadbeefdeadbeef`));
    expect(await res.text()).toContain('Invalid link');
    expect(dbCalls).toEqual([]);
  });

  it('POST with a valid link goes on to look the post up', async () => {
    const url = `https://app.example/api/posts/cancel?id=${POST_ID}&hash=${generateCancelHash(POST_ID)}`;
    await cancelPOST(new NextRequest(url, { method: 'POST' }));
    expect(dbCalls).toContain('from:scheduled_posts');
  });
});

describe('review approve link', () => {
  it('GET approve shows a confirm form and touches nothing', async () => {
    const url = `https://app.example/api/reviews/auto-reply?action=approve&review_id=r1&hash=${generateReviewHash('r1')}`;
    const html = await (await replyGET(new NextRequest(url))).text();
    expect(html).toContain('Publish this reply?');
    expect(html).toContain('<form method="POST"');
    expect(dbCalls).toEqual([]);
  });

  it('GET with an unknown action or bad hash is refused', async () => {
    expect(await (await replyGET(new NextRequest(`https://app.example/api/reviews/auto-reply?action=delete&review_id=r1&hash=${generateReviewHash('r1')}`))).text()).toContain('Invalid link');
    expect(await (await replyGET(new NextRequest('https://app.example/api/reviews/auto-reply?action=approve&review_id=r1&hash=0000'))).text()).toContain('Invalid link');
    expect(dbCalls).toEqual([]);
  });
});

describe('helpers', () => {
  it('linkHashMatches is exact', () => {
    expect(linkHashMatches('abc', 'abc')).toBe(true);
    expect(linkHashMatches('abd', 'abc')).toBe(false);
    expect(linkHashMatches(null, 'abc')).toBe(false);
    expect(linkHashMatches('ab', 'abc')).toBe(false);
  });
  it('confirmPage escapes what it is given', () => {
    const html = confirmPage(getTenantBySlug('stellar'), '<x>', 'a"b', 'Go', '/p?a=1&b="2"');
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('action="/p?a=1&amp;b=&quot;2&quot;"');
  });
});
