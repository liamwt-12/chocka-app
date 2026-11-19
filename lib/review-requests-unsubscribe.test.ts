import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Every database call is recorded. A GET (what an email scanner does) must
// never reach the write.
const calls: Array<{ table: string; op: string; args: any[] }> = [];
let upsertError: { message: string } | null = null;
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => ({ upsert: async (...args: any[]) => { calls.push({ table, op: 'upsert', args }); return { error: upsertError }; } }) },
}));

import { GET, POST } from '@/app/api/review-requests/unsubscribe/route';
import { unsubscribeUrl, hashEmail } from './review-requests';

const H = () => hashEmail('a@example.invalid');
const req = (url: string, method = 'GET', body?: string) => new NextRequest(url, { method, headers: { 'x-tenant-slug': 'stellar' }, body });
beforeEach(() => { calls.length = 0; upsertError = null; process.env.CANCEL_HASH_SECRET = 'test-secret'; });

describe('unsubscribe link', () => {
  it('GET with a valid link shows a confirm button that POSTs back, and writes nothing', async () => {
    const res = await GET(req(unsubscribeUrl('https://app.example.com', H())));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Stop review requests?');
    expect(html).toContain('<form method="POST" action="/api/review-requests/unsubscribe?t=');
    expect(calls).toEqual([]);
  });
  it('GET or POST with a bad link says so, gives another way, and writes nothing', async () => {
    for (const u of ['https://app.example.com/api/review-requests/unsubscribe', `https://app.example.com/api/review-requests/unsubscribe?t=${H()}.${'0'.repeat(32)}`]) {
      for (const handler of [GET, POST]) {
        const res = await handler(req(u, handler === POST ? 'POST' : 'GET'));
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('privacy@stellarlocal.co.uk');
      }
    }
    expect(calls).toEqual([]);
  });
  it('POST (the button, or a mail client\'s one-click) puts the hash, never the address, on the platform-wide list', async () => {
    const res = await POST(req(unsubscribeUrl('https://app.example.com', H()), 'POST', 'List-Unsubscribe=One-Click'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('You will not be sent any more review requests');
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('review_request_suppressions');
    expect(calls[0].args[0]).toEqual({ email_hash: H(), source: 'link' });
    expect(JSON.stringify(calls)).not.toContain('@');
  });
  it('works whether or not REVIEW_REQUESTS is on', async () => {
    delete process.env.REVIEW_REQUESTS;
    const res = await POST(req(unsubscribeUrl('https://app.example.com', H()), 'POST'));
    expect(res.status).toBe(200);
  });
  it('a failed write says so, rather than claiming it worked', async () => {
    upsertError = { message: 'down' };
    const res = await POST(req(unsubscribeUrl('https://app.example.com', H()), 'POST'));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('could not record');
  });
});
