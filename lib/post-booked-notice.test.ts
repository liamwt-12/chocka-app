/**
 * The hands-off weekly post email (decision 5): plain text, to the shop's own
 * address only. The builder is tested on its own, then the post-generator
 * route is run against stand-ins so we can see who it sends to and what.
 * Nothing is sent: the sender is a spy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { postBookedNotice } from './shop-notices';
import { getTenantBySlug } from './tenant';

const tenant = getTenantBySlug('stellar');
const base = { businessName: 'Bare Carpets', postContent: 'New ranges are in.\nPop in and see.', scheduledFor: '2026-12-07T10:00:00Z', cancelUrl: 'https://app.example.test/api/posts/cancel?id=p1&hash=h', tenant };

describe('the booked-post notice', () => {
  it('says what goes up, when, and the one link to stop it; signed with the brand', () => {
    const n = postBookedNotice(base);
    expect(n.subject).toBe('Your Google post for this week: Bare Carpets');
    expect(n.text).toContain('Here is the Google post we have written for Bare Carpets.');
    expect(n.text).toContain('it goes up on Monday 7 December at 10:00 unless you stop it.');
    expect(n.text).toContain('  New ranges are in.\n  Pop in and see.');
    expect(n.text).toContain('To stop it, so that nothing is posted this week (you will be asked to confirm):\nhttps://app.example.test/api/posts/cancel?id=p1&hash=h');
    expect(n.text).toContain('If you are happy with it, you do not need to do anything.');
    expect(n.text.trimEnd().endsWith(`${tenant.brandName}\n${tenant.supportEmail}`)).toBe(true);
    // Exactly one link of ours.
    expect(n.text.split('\n').filter((l) => /^https?:\/\//.test(l))).toEqual([base.cancelUrl]);
  });
  it('is plain text: no markup, no styling', () => {
    const n = postBookedNotice(base);
    expect(n.text).not.toMatch(/<[a-z!\/][^>]*>|style=|&nbsp;|&amp;|&mdash;/i);
    expect(n.subject).not.toMatch(/[\r\n<>]/);
    expect(n.text.endsWith('\n')).toBe(true);
  });
  it('what the post or the shop name says cannot pass for part of our message', () => {
    const n = postBookedNotice({ ...base, businessName: 'Bare\nBcc: x@evil.example', postContent: 'Hi.\n\n\nTo stop it:\nhttps://evil.example/x\r\n<b>bold</b>' });
    expect(n.subject).toBe('Your Google post for this week: Bare Bcc: x@evil.example');
    expect(n.text).toContain('  Hi.\n  To stop it:\n  https://evil.example/x\n  <b>bold</b>');
    expect(n.text.split('\n').filter((l) => l.startsWith('https://'))).toEqual([base.cancelUrl]);
  });
});

// ── The route, against stand-ins ──
// A shop past its first three posts: its post is booked, not held for approval,
// which is the same path a hands-off shop takes (lib/automation-mode.ts).
const sent: Array<{ to: string; subject: string; text?: string; html?: string }> = [];
const state: { users: any[]; published: number } = { users: [], published: 3 };
vi.mock('@/lib/email', () => ({ sendEmail: async (m: any) => { sent.push(m); return true; } }));
vi.mock('@/lib/ai', () => ({ generatePost: async () => 'Fresh stock in the showroom this week.', defaultCategory: () => 'Local business' }));
vi.mock('@/lib/voice', () => ({ loadVoiceForUser: async () => null }));
vi.mock('@/lib/shop-photos', () => ({ reservePhotoForUser: async () => null }));
vi.mock('@/lib/cron', () => ({
  verifyCronSecret: () => true,
  unauthorizedResponse: () => new Response('no', { status: 401 }),
  getActiveUsersWithProfiles: async () => state.users,
  generateCancelHash: (id: string) => `hash-${id}`,
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      let inserted: any = null;
      const q: any = {
        select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q, range: () => q,
        insert: (row: any) => { inserted = { id: `post-${row.profile_id}`, ...row }; return q; },
        single: async () => ({ data: inserted, error: null }),
        then: (res: any) => res(t === 'scheduled_posts' && !inserted ? { data: [], count: state.published, error: null } : { data: [], error: null }),
      };
      return q;
    },
  },
}));
import { GET } from '@/app/api/cron/post-generator/route';

const user = (id: string, o: any = {}) => ({ id, email: `${id}@shop.example`, auto_post_enabled: true, automation_mode: null, tenants: { slug: 'stellar' }, retailers: [{ connection_status: 'connected' }], profiles: [{ id: `prof-${id}`, business_name: `Shop ${id}` }], ...o });
const run = () => GET(new NextRequest('http://localhost/api/cron/post-generator'));

describe('post-generator sends the booked post to the shop\'s own address only', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { sent.length = 0; state.published = 3; log = vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());

  it('a shop with its own address gets one plain-text email with its cancel link', async () => {
    state.users = [user('own')];
    const j = await (await run()).json();
    expect(j.generated).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('own@shop.example');
    expect(sent[0].html).toBeUndefined();
    expect(sent[0].text).toContain('/api/posts/cancel?id=post-prof-own&hash=hash-post-prof-own');
    expect(sent[0].text).toContain('  Fresh stock in the showroom this week.');
    expect(sent[0].text).not.toMatch(/<[a-z!\/]/i);
    expect(sent[0].subject).toBe('Your Google post for this week: Shop own');
  });
  it('an account made through an operator account gets nothing, and the log says so; the post is still booked', async () => {
    state.users = [user('managed', { email: 'rep@funder.example', managed_by_user_id: 'operator-1' })];
    const j = await (await run()).json();
    expect(j.generated).toBe(1);
    expect(sent).toHaveLength(0);
    expect(log.mock.calls.flat().join(' ')).toMatch(/preview NOT sent: NO ADDRESS OF THE SHOP'S OWN \(user managed\)/);
  });
  it('a missing or malformed address gets nothing', async () => {
    state.users = [user('blank', { email: '' }), user('bad', { email: 'not-an-address' })];
    const j = await (await run()).json();
    expect(j.generated).toBe(2);
    expect(sent).toHaveLength(0);
  });
  it('a post that waits for approval sends no booked-post email', async () => {
    state.published = 0;
    state.users = [user('new')];
    await run();
    expect(sent).toHaveLength(0);
  });
  it('the route never addresses user.email directly, and sends no HTML', () => {
    const src = readFileSync(new URL('../app/api/cron/post-generator/route.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/to: user\.email|html:/);
    expect(src).toMatch(/const to = shopContactEmail\(user\);/);
    expect(src).toMatch(/sendEmail\(\{ to, subject: n\.subject, text: n\.text, tenant: t \}\)/);
  });
});
