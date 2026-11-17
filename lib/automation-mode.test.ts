import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  handsOffEnabled, isHandsOff, effectiveMode, isPaused, offeredFirst, planChoice, describeMode,
  postNeedsApproval, holdingReplyGoesOut, HANDS_OFF_WORDING_VERSION, HANDS_OFF_WORDING, ASK_FIRST_WORDING,
} from './automation-mode';
import { APPROVAL_REQUIRED_POSTS, holdingReply, replyBreaksRules } from './safe-automation';
import { getTenantBySlug } from './tenant';
import { holdingReplyPostedEmail } from './email';

const ON = { HANDS_OFF_MODE: 'on' };
const OFF = {};
const agreed = { automation_mode: 'hands_off', automation_consent_at: '2026-12-01T10:00:00Z', automation_consent_version: HANDS_OFF_WORDING_VERSION };
const now = new Date('2026-12-01T10:00:00Z');

describe('hands-off is off unless switched on', () => {
  it('only the exact word "on" turns it on', () => {
    expect(handsOffEnabled({})).toBe(false);
    for (const v of ['true', '1', 'yes', 'off', ' ']) expect(handsOffEnabled({ HANDS_OFF_MODE: v })).toBe(false);
    expect(handsOffEnabled({ HANDS_OFF_MODE: ' ON ' })).toBe(true);
  });
  it('while off, a stored choice of hands-off has no effect at all', () => {
    expect(isHandsOff(agreed, OFF)).toBe(false);
    expect(effectiveMode(agreed, OFF)).toBe('ask_first');
    expect(postNeedsApproval(agreed, 0, APPROVAL_REQUIRED_POSTS, OFF)).toBe(true);
    expect(holdingReplyGoesOut(agreed, OFF)).toBe(false);
    expect(planChoice({ mode: 'hands_off', wordingVersion: HANDS_OFF_WORDING_VERSION }, now, OFF)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('hands-off needs the shop\'s own recorded permission', () => {
  it('is in force only with the choice, the time and the wording version all on record', () => {
    expect(isHandsOff(agreed, ON)).toBe(true);
    expect(isHandsOff({ ...agreed, automation_consent_at: null }, ON)).toBe(false);
    expect(isHandsOff({ ...agreed, automation_consent_version: null }, ON)).toBe(false);
    expect(isHandsOff({ ...agreed, automation_mode: 'ask_first' }, ON)).toBe(false);
    expect(isHandsOff({}, ON)).toBe(false);
    expect(isHandsOff(null, ON)).toBe(false);
  });
  it('a shop that has not chosen is treated as ask me first, whatever the tenant offers first', () => {
    expect(effectiveMode({ automation_mode: null }, ON)).toBe('ask_first');
    expect(describeMode({ automation_mode: null }, ON)).toMatchObject({ mode: 'ask_first', chosen: false, label: 'Ask me first (not chosen yet)' });
  });
  it('the Tarkett tenant offers hands-off first; the other brand does not; neither applies it', () => {
    expect(offeredFirst(getTenantBySlug('stellar').defaultAutomationMode)).toBe('hands_off');
    expect(offeredFirst(getTenantBySlug('chocka').defaultAutomationMode)).toBe('ask_first');
    // Nothing reads the tenant default except to pick which option is shown first.
    const users = ['../app/api/cron/post-generator/route.ts', '../app/api/cron/review-alerts/route.ts', '../app/api/cron/post-publisher/route.ts', '../app/api/auth/callback/google/route.ts', './automation-mode.ts'];
    for (const f of users) expect(readFileSync(new URL(f, import.meta.url), 'utf8')).not.toMatch(/defaultAutomationMode/);
  });
});

describe('recording the choice', () => {
  it('hands-off stores when, and which wording, and turns posts and replies on', () => {
    const r = planChoice({ mode: 'hands_off', wordingVersion: HANDS_OFF_WORDING_VERSION }, now, ON);
    expect(r).toEqual({ ok: true, update: {
      automation_mode: 'hands_off', automation_mode_chosen_at: now.toISOString(),
      automation_consent_at: now.toISOString(), automation_consent_version: HANDS_OFF_WORDING_VERSION,
      auto_post_enabled: true, auto_reply_enabled: true, updated_at: now.toISOString(),
    } });
  });
  it('refuses hands-off without the version of the wording that was on the screen', () => {
    expect(planChoice({ mode: 'hands_off' }, now, ON)).toMatchObject({ ok: false, status: 409 });
    expect(planChoice({ mode: 'hands_off', wordingVersion: 'an-older-one' }, now, ON)).toMatchObject({ ok: false, status: 409 });
  });
  it('ask me first changes the mode only: no switch is touched and the earlier permission record is kept', () => {
    const r = planChoice({ mode: 'ask_first' }, now, ON);
    expect(r.ok && Object.keys(r.update).sort()).toEqual(['automation_mode', 'automation_mode_chosen_at', 'updated_at']);
  });
  it('refuses anything else', () => {
    for (const mode of [undefined, '', 'on', true, 'HANDS_OFF']) expect(planChoice({ mode }, now, ON)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('what hands-off changes, and what it does not', () => {
  it('posts need no approval in hands-off; otherwise the first three still do', () => {
    for (const n of [0, 1, 2, 3, 10]) expect(postNeedsApproval(agreed, n, APPROVAL_REQUIRED_POSTS, ON)).toBe(false);
    expect([0, 1, 2, 3, 4].map((n) => postNeedsApproval({ automation_mode: 'ask_first' }, n, APPROVAL_REQUIRED_POSTS, ON))).toEqual([true, true, true, false, false]);
    expect([0, 2, 3].map((n) => postNeedsApproval(null, n, APPROVAL_REQUIRED_POSTS, ON))).toEqual([true, true, false]);
  });
  it('the holding reply goes out on its own only in hands-off, and never while paused', () => {
    expect(holdingReplyGoesOut(agreed, ON)).toBe(true);
    expect(holdingReplyGoesOut({ ...agreed, automation_paused_at: '2026-12-02T09:00:00Z' }, ON)).toBe(false);
    expect(holdingReplyGoesOut({ automation_mode: 'ask_first' }, ON)).toBe(false);
  });
  it('the reply that goes out is the fixed wording, which breaks none of the reply rules', () => {
    expect(replyBreaksRules(holdingReply('Sam Jones'))).toBeNull();
    const route = readFileSync(new URL('../app/api/cron/review-alerts/route.ts', import.meta.url), 'utf8');
    // AI wording is only ever written for 4 and 5 stars; the low-star text is holdingReply().
    expect(route).toMatch(/rating >= 4\s*\?\s*await generateReviewReply\([\s\S]*?:\s*holdingReply\(reviewerName\)/);
    expect(route).toMatch(/holdingReplyGoesOut\(user\) && await postHoldingReply\(/);
  });
  it('pause is honoured even with the switch off', () => {
    expect(isPaused({ automation_paused_at: '2026-12-02T09:00:00Z' })).toBe(true);
    expect(isPaused({ automation_paused_at: null })).toBe(false);
    expect(isPaused(null)).toBe(false);
  });
  it('the jobs check for a pause, and a held listing is still held', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('../app/api/cron/post-generator/route.ts')).toMatch(/u\.auto_post_enabled && !isPaused\(u\)/);
    expect(src('../app/api/cron/post-generator/route.ts')).toMatch(/postNeedsApproval\(user, publishedCount \|\| 0, APPROVAL_REQUIRED_POSTS\)/);
    const publisher = src('../app/api/cron/post-publisher/route.ts');
    expect(publisher).toMatch(/isPaused\(user\)/);
    // The hold comes first and is untouched: hands-off never lifts it.
    expect(publisher.indexOf('automationHeld(user.retailers)')).toBeGreaterThan(0);
    expect(publisher.indexOf('automationHeld(user.retailers)')).toBeLessThan(publisher.indexOf('isPaused(user)'));
    expect(src('./shop-status.ts')).not.toMatch(/automation_mode|isHandsOff/);
    expect(src('./cron.ts')).toMatch(/automationHeld\(u\.retailers\)/);
  });
});

describe('what Settings and the admin page show', () => {
  it('says hands-off with the date and wording version of the permission', () => {
    expect(describeMode(agreed, ON)).toEqual({ mode: 'hands_off', label: 'Hands-off', chosen: true, paused: false, permissionOn: '2026-12-01T10:00:00Z', wordingVersion: HANDS_OFF_WORDING_VERSION });
  });
  it('shows no permission date for a shop that is not in hands-off', () => {
    expect(describeMode({ ...agreed, automation_mode: 'ask_first' }, ON)).toMatchObject({ mode: 'ask_first', label: 'Ask me first', permissionOn: null });
    expect(describeMode(agreed, OFF)).toMatchObject({ mode: 'ask_first', permissionOn: null });
  });
  it('both pages render it', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('../app/settings/page.tsx')).toMatch(/<AutomationChoice variant="settings"/);
    expect(src('../app/connected/page.tsx')).toMatch(/<AutomationChoice variant="onboarding"/);
    expect(src('../app/api/admin/pilot/route.ts')).toMatch(/working: user \? \{ \.\.\.describeMode\(/);
    expect(src('../app/admin/pilot/page.tsx')).toMatch(/How we work/);
  });
});

describe('the wording', () => {
  it('promises pause and undo, says the shop is told, and makes no claim about results', () => {
    const all = [HANDS_OFF_WORDING.summary, ...HANDS_OFF_WORDING.points, HANDS_OFF_WORDING.permission, ASK_FIRST_WORDING.summary, ...ASK_FIRST_WORDING.points].join(' ');
    expect(all).toMatch(/Pause and Undo are always one tap away/);
    expect(all).toMatch(/we tell you straight away/);
    expect(all).toMatch(/until you tell us to stop/);
    expect(all).not.toMatch(/guarantee|more customers|rank|£/i);
  });
  it('the email that tells the shop escapes what the customer wrote', () => {
    const html = holdingReplyPostedEmail({ businessName: 'Bare <b>Carpets</b>', reviewerName: 'A <script>', rating: 2, comment: 'bad & "slow" <img>', reply: holdingReply('A'), settingsUrl: 'https://example.test/settings', tenant: getTenantBySlug('stellar') });
    expect(html).not.toMatch(/<script>|<img>|<b>Carpets/);
    expect(html).toContain('bad &amp; &quot;slow&quot; &lt;img&gt;');
    expect(html).toContain('we have posted a short, polite reply');
    expect(html).toContain('https://example.test/settings');
  });
});

// ── The route ──
const state: { user: any; writes: any[]; failUpdate: boolean } = { user: null, writes: [], failUpdate: false };
vi.mock('@/lib/session', () => ({ getSessionUserId: (req: any) => req.headers.get('x-test-user') }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const filters: any[] = [];
      const q: any = {
        select: () => q, eq: (c: string, v: any) => { filters.push(['eq', c, v]); return q; }, gt: (c: string, v: any) => { filters.push(['gt', c, v]); return q; }, lte: (c: string, v: any) => { filters.push(['lte', c, v]); return q; },
        single: async () => ({ data: t === 'users' ? state.user : null, error: null }),
        maybeSingle: async () => ({ data: t === 'profiles' ? { id: 'p1' } : null, error: null }),
        update: (patch: any) => {
          const u: any = {
            eq: (c: string, v: any) => { filters.push(['eq', c, v]); return u; }, gt: (c: string, v: any) => { filters.push(['gt', c, v]); return u; }, lte: (c: string, v: any) => { filters.push(['lte', c, v]); return u; },
            select: async () => { state.writes.push({ t, patch, filters }); return { data: [{ id: 'x' }], error: null }; },
            then: (res: any) => { state.writes.push({ t, patch, filters }); if (t === 'users' && !state.failUpdate) Object.assign(state.user, patch); return res({ error: state.failUpdate ? { message: 'db down' } : null }); },
          };
          return u;
        },
      };
      return q;
    },
  },
}));
import { GET, POST } from '@/app/api/automation-mode/route';

const req = (body?: unknown, user: string | null = 'u1') => new NextRequest('http://stellar.localhost/api/automation-mode', {
  method: body === undefined ? 'GET' : 'POST', headers: { 'x-tenant-slug': 'stellar', ...(user ? { 'x-test-user': user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('/api/automation-mode', () => {
  beforeEach(() => { state.user = { id: 'u1', auto_post_enabled: false, auto_reply_enabled: false, automation_mode: null, retailers: [{ connection_status: 'connected' }] }; state.writes = []; state.failUpdate = false; process.env.HANDS_OFF_MODE = 'on'; });
  afterEach(() => { delete process.env.HANDS_OFF_MODE; });

  it('needs a signed-in shop', async () => {
    expect((await GET(req(undefined, null))).status).toBe(401);
    expect((await POST(req({ mode: 'hands_off' }, null))).status).toBe(401);
  });
  it('shows the wording, its version, and hands-off first for the Tarkett tenant', async () => {
    const j = await (await GET(req())).json();
    expect(j).toMatchObject({ enabled: true, mode: 'ask_first', chosen: false, offeredFirst: 'hands_off', wordingVersion: HANDS_OFF_WORDING_VERSION });
    expect(j.handsOff.permission).toContain('Stellar Local');
    expect(j.handsOff.holdingReply).toBe(holdingReply(null));
  });
  it('records hands-off with the time and wording version, and books posts that were waiting', async () => {
    const res = await POST(req({ mode: 'hands_off', wordingVersion: HANDS_OFF_WORDING_VERSION }));
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, mode: 'hands_off', label: 'Hands-off' });
    expect(state.user).toMatchObject({ automation_mode: 'hands_off', automation_consent_version: HANDS_OFF_WORDING_VERSION, auto_post_enabled: true, auto_reply_enabled: true });
    expect(state.user.automation_consent_at).toBeTruthy();
    const posts = state.writes.filter((w) => w.t === 'scheduled_posts');
    expect(posts.map((w) => w.patch.status)).toEqual(['pending_approval', 'cancelled']);
    // Only posts still waiting are touched; a post whose date has passed is dropped, not published late.
    for (const w of posts) expect(w.filters).toContainEqual(['eq', 'status', 'awaiting_approval']);
    expect(posts[0].filters.some((f: any) => f[0] === 'gt' && f[1] === 'scheduled_for')).toBe(true);
    expect(posts[1].filters.some((f: any) => f[0] === 'lte' && f[1] === 'scheduled_for')).toBe(true);
  });
  it('refuses a choice made against out-of-date wording, and records nothing', async () => {
    const res = await POST(req({ mode: 'hands_off', wordingVersion: 'old' }));
    expect(res.status).toBe(409);
    expect(state.writes).toEqual([]);
    expect(state.user.automation_mode).toBeNull();
  });
  it('with the switch off the choice is refused, but Pause still works', async () => {
    delete process.env.HANDS_OFF_MODE;
    expect((await POST(req({ mode: 'hands_off', wordingVersion: HANDS_OFF_WORDING_VERSION }))).status).toBe(404);
    expect(state.writes).toEqual([]);
    const j = await (await POST(req({ paused: true }))).json();
    expect(j).toMatchObject({ ok: true, paused: true });
    expect(state.user.automation_paused_at).toBeTruthy();
  });
  it('pausing drops a booked post; resuming clears the pause', async () => {
    await POST(req({ paused: true }));
    const drop = state.writes.find((w) => w.t === 'scheduled_posts');
    expect(drop.patch).toEqual({ status: 'cancelled' });
    expect(drop.filters).toContainEqual(['eq', 'status', 'pending_approval']);
    state.writes = [];
    await POST(req({ paused: false }));
    expect(state.user.automation_paused_at).toBeNull();
    expect(state.writes.filter((w) => w.t === 'scheduled_posts')).toEqual([]);
  });
  it('says so when it could not be saved', async () => {
    state.failUpdate = true;
    const res = await POST(req({ mode: 'ask_first' }));
    expect(res.status).toBe(500);
  });
  it('tells a held shop that nothing starts until its listing is checked', async () => {
    state.user.retailers = [{ connection_status: 'check_listing', listing_confirmed_at: null }];
    const j = await (await POST(req({ mode: 'hands_off', wordingVersion: HANDS_OFF_WORDING_VERSION }))).json();
    expect(j).toMatchObject({ ok: true, mode: 'hands_off', held: true });
  });
});
