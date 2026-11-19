import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  holdingReply, requiresPostApproval, approvalsRemaining, earlyPreviewEmailsEnabled,
  postsDueForPreview, replyBreaksRules, AWAITING_APPROVAL,
} from './safe-automation';
import { validateContent } from './ai';
import { postWaitingNotice } from './shop-notices';
import { getTenantBySlug } from './tenant';
import { generatePostActionHash } from './cron';

const writes: any[] = [];
let updateResult: any = { data: [{ id: 'p1' }], error: null };
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => ({
      update: (patch: any) => {
        const filters: any[] = [];
        const q: any = {
          eq: (c: string, v: any) => { filters.push([c, v]); return q; },
          select: async () => { writes.push({ t, patch, filters }); return updateResult; },
        };
        return q;
      },
    }),
  },
}));
import { GET as approveGET, POST as approvePOST } from '@/app/api/posts/approve/route';

beforeEach(() => { writes.length = 0; updateResult = { data: [{ id: 'p1' }], error: null }; process.env.CANCEL_HASH_SECRET = 's'; });
afterEach(() => { delete process.env.EARLY_POST_PREVIEW_EMAILS; });

describe('holding reply for 1 to 3 star reviews', () => {
  it('is fixed wording that regrets without admitting anything', () => {
    const r = holdingReply('Dave Smith');
    expect(r).toBe("Thank you for your feedback, Dave. We're sorry to hear your experience wasn't what you hoped for. We'd like to understand more, so please contact us directly and we'll look into it.");
    expect(replyBreaksRules(r)).toBeNull();
    expect(validateContent(r, 'reply').valid).toBe(true);
  });
  it('drops a missing or odd name rather than printing it', () => {
    expect(holdingReply('')).toMatch(/^Thank you for your feedback\. /);
    expect(holdingReply('<script>')).toMatch(/^Thank you for your feedback\. /);
  });
});

describe('reply rules', () => {
  it.each([
    'Sorry Dave, that was our fault and we will refund you in full.',
    'We have issued a discount voucher for your next order, Dave.',
    'Our insurance will cover this, please contact our solicitor, thanks Dave.',
  ])('rejects: %s', (text) => {
    expect(validateContent(text, 'reply').valid).toBe(false);
  });
  it('still allows a normal warm reply', () => {
    expect(validateContent('Thanks so much Dave, really glad you love the new floor. It was a pleasure working with you.', 'reply').valid).toBe(true);
  });
});

describe('first three posts need approval', () => {
  it('requires approval until three posts are published', () => {
    expect([0, 1, 2, 3, 10].map(requiresPostApproval)).toEqual([true, true, true, false, false]);
    expect([0, 2, 3, 5].map(approvalsRemaining)).toEqual([3, 1, 0, 0]);
  });
});

describe('24-hour preview', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  it('is off by default and only on when set to "on"', () => {
    expect(earlyPreviewEmailsEnabled()).toBe(false);
    process.env.EARLY_POST_PREVIEW_EMAILS = 'true';
    expect(earlyPreviewEmailsEnabled()).toBe(false);
    process.env.EARLY_POST_PREVIEW_EMAILS = 'on';
    expect(earlyPreviewEmailsEnabled()).toBe(true);
  });
  it('picks posts awaiting approval due within 24 hours, once', () => {
    const posts = [
      { id: 'a', status: AWAITING_APPROVAL, scheduled_for: '2026-11-15T09:00:00Z', preview_sent_at: null },
      { id: 'b', status: AWAITING_APPROVAL, scheduled_for: '2026-11-16T09:00:00Z', preview_sent_at: null },
      { id: 'c', status: AWAITING_APPROVAL, scheduled_for: '2026-11-15T09:00:00Z', preview_sent_at: '2026-11-14T09:00:00Z' },
      { id: 'd', status: 'pending_approval', scheduled_for: '2026-11-15T09:00:00Z', preview_sent_at: null },
    ];
    expect(postsDueForPreview(posts, now).map((p) => p.id)).toEqual(['a']);
  });
  it('the notice says nothing is posted if they do nothing', () => {
    const n = postWaitingNotice({ businessName: 'Testwell Flooring', postContent: 'Hello', scheduledFor: '2026-11-16T10:30:00Z', approveUrl: 'https://a', skipUrl: 'https://s', approvalsLeft: 3, tenant: getTenantBySlug('stellar') });
    expect(n.text).toContain('If you do nothing, nothing is posted.');
    expect(n.text).toContain('To approve it (you will be asked to confirm):\nhttps://a');
    expect(n.text).toContain('Monday 16 November');
  });
});

describe('/api/posts/approve', () => {
  const url = (action: 'approve' | 'skip', hash = generatePostActionHash('p1', action)) => `https://app.example/api/posts/approve?id=p1&action=${action}&hash=${hash}`;

  it('GET only shows a confirmation, and writes nothing', async () => {
    const html = await (await approveGET(new NextRequest(url('approve')))).text();
    expect(html).toContain('<form method="POST"');
    expect(writes).toEqual([]);
  });
  it('POST approve makes the post publishable, only if it is still awaiting approval', async () => {
    const html = await (await approvePOST(new NextRequest(url('approve'), { method: 'POST' }))).text();
    expect(html).toContain('Post approved');
    expect(writes[0].patch.status).toBe('pending_approval');
    expect(writes[0].filters).toContainEqual(['status', AWAITING_APPROVAL]);
  });
  it('POST skip cancels it', async () => {
    await approvePOST(new NextRequest(url('skip'), { method: 'POST' }));
    expect(writes[0].patch).toEqual({ status: 'cancelled' });
  });
  it('a link signed for skip cannot approve', async () => {
    const html = await (await approvePOST(new NextRequest(url('approve', generatePostActionHash('p1', 'skip')), { method: 'POST' }))).text();
    expect(html).toContain('Invalid link');
    expect(writes).toEqual([]);
  });
  it('a second tap says it is already handled', async () => {
    updateResult = { data: [], error: null };
    expect(await (await approvePOST(new NextRequest(url('approve'), { method: 'POST' }))).text()).toContain('Already handled');
  });
});

describe('containsPhoneNumber', () => {
  it('finds a UK number however it is spaced or punctuated', async () => {
    const { containsPhoneNumber } = await import('./safe-automation');
    for (const yes of ['Call 07700 900123', '07700-900123', '(0113) 496 0000', '0113.496.0000', '+44 7700 900123', '+44 (0)7700 900123', '0800 123 4567', '0333 000 1234', 'ring us on 01632960001 today']) {
      expect(containsPhoneNumber(yes), yes).toBe(true);
    }
  });
  it('leaves ordinary numbers alone', async () => {
    const { containsPhoneNumber } = await import('./safe-automation');
    for (const no of ['Over 30 years on the high street', 'Open 9 to 5, 6 days a week', 'We fitted 1200 square metres in 2026', 'Unit 4, 10 Mill Lane', 'rated 4.9 from 120 reviews', '']) {
      expect(containsPhoneNumber(no), no).toBe(false);
    }
  });
});
