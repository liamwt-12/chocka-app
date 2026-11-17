import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  handsOffEnabled, isHandsOff, effectiveMode, isPaused, offeredFirst, planChoice, describeMode,
  postNeedsApproval, holdingReplyGoesOut, switchesInForce, leftSincePermission, ACCEPTED_WORDING_VERSIONS, HANDS_OFF_WORDING_VERSION, HANDS_OFF_WORDING, ASK_FIRST_WORDING,
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
    // AI wording is written in one place, for 4 and 5 stars with replies on; the low-star text is holdingReply().
    expect(route.match(/generateReviewReply\(/g)).toHaveLength(1);
    expect(route).toMatch(/if \(plan\.reply === 'ai_publish'\) \{\s*const replyContent = await generateReviewReply\(/);
    expect(route).toMatch(/plan\.reply === 'holding_publish' && await postHoldingReply\(\{[^}]*replyContent: holdingReply\(reviewerName\)/);
  });
  it('pause is honoured even with the switch off', () => {
    expect(isPaused({ automation_paused_at: '2026-12-02T09:00:00Z' })).toBe(true);
    expect(isPaused({ automation_paused_at: null })).toBe(false);
    expect(isPaused(null)).toBe(false);
  });
  it('the jobs check for a pause, and a held listing is still held', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('../app/api/cron/post-generator/route.ts')).toMatch(/switchesInForce\(u\)\.posts && !isPaused\(u\)/);
    expect(src('../app/api/cron/post-generator/route.ts')).toMatch(/postNeedsApproval\(user, publishedCount \|\| 0, APPROVAL_REQUIRED_POSTS\)/);
    const publisher = src('../app/api/cron/post-publisher/route.ts');
    expect(publisher).toMatch(/isPaused\(user\)/);
    // The hold comes first and is untouched: hands-off never lifts it.
    expect(publisher.indexOf('automationHeld(user.retailers)')).toBeGreaterThan(0);
    expect(publisher.indexOf('automationHeld(user.retailers)')).toBeLessThan(publisher.indexOf('isPaused(user)'));
    // The hold itself knows nothing about modes: nothing a shop chooses can lift it.
    const hold = src('./shop-status.ts').split('export function automationHeld')[1];
    expect(hold).not.toMatch(/automation_mode|isHandsOff|switchesInForce|auto_/);
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

describe('the choice is two buttons, and nothing is ticked in advance', () => {
  const ui = readFileSync(new URL('../components/AutomationChoice.tsx', import.meta.url), 'utf8');
  it('has no radio button, tick box or pre-selected option anywhere', () => {
    expect(ui).not.toMatch(/type="radio"|type="checkbox"|checked=|defaultChecked|role="radiogroup"|setPick/);
  });
  it('hands-off is the large button, marked Recommended for the Tarkett tenant; "ask me first" is a smaller one', () => {
    expect(HANDS_OFF_WORDING.button).toBe('Start hands-off');
    expect(ASK_FIRST_WORDING.button).toBe('Ask me first');
    expect(ui).toMatch(/s\.offeredFirst === 'hands_off' && <span[^>]*>Recommended<\/span>/);
    const big = /onClick=\{\(\) => choose\('hands_off'\)\} style=\{\{[^}]*fontSize: (\d+)/.exec(ui)!, small = /onClick=\{\(\) => choose\('ask_first'\)\} style=\{\{[^}]*fontSize: (\d+)/.exec(ui)!;
    expect(Number(big[1])).toBeGreaterThan(Number(small[1]));
    // The permission sentence sits above the hands-off button, so it is read before it is pressed.
    expect(ui.indexOf('{s.handsOff.permission}')).toBeLessThan(ui.indexOf("choose('hands_off')"));
  });
  it('pressing a button is what records the choice, with the wording version that was on the screen', () => {
    expect(ui).toMatch(/mode === 'hands_off' \? \{ mode, wordingVersion: s\.wordingVersion \} : \{ mode \}/);
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

describe('leaving hands-off, or hands-off being switched off, stops what it started', () => {
  it('choosing "ask me first" after hands-off turns both switches off again; for a shop never in hands-off it touches neither', () => {
    const leaving = planChoice({ mode: 'ask_first', currentMode: 'hands_off' }, now, ON);
    expect(leaving.ok && leaving.update).toMatchObject({ automation_mode: 'ask_first', auto_post_enabled: false, auto_reply_enabled: false });
    expect(leaving.ok && 'automation_consent_at' in leaving.update).toBe(false);   // the record of the permission is left as it is
    const never = planChoice({ mode: 'ask_first', currentMode: null }, now, ON);
    expect(never.ok && Object.keys(never.update).sort()).toEqual(['automation_mode', 'automation_mode_chosen_at', 'updated_at']);
  });
  it('switches turned on by a hands-off choice do not count when hands-off is not in force', () => {
    const chose = { ...agreed, auto_post_enabled: true, auto_reply_enabled: true };
    expect(switchesInForce(chose, ON)).toEqual({ posts: true, replies: true });
    expect(switchesInForce(chose, OFF)).toEqual({ posts: false, replies: false });                                  // the switch was turned off
    expect(switchesInForce({ ...chose, automation_consent_version: 'a-withdrawn-draft' }, ON)).toEqual({ posts: false, replies: false });
    // A shop that never chose hands-off keeps exactly what it switched on itself.
    expect(switchesInForce({ auto_post_enabled: true, auto_reply_enabled: false }, OFF)).toEqual({ posts: true, replies: false });
    expect(switchesInForce({ automation_mode: 'ask_first', auto_post_enabled: false, auto_reply_enabled: true }, OFF)).toEqual({ posts: false, replies: true });
    expect(switchesInForce(null, ON)).toEqual({ posts: false, replies: false });
  });
  it('a permission given against wording that is no longer accepted stops counting', () => {
    expect(ACCEPTED_WORDING_VERSIONS).toContain(HANDS_OFF_WORDING_VERSION);
    expect(isHandsOff({ ...agreed, automation_consent_version: 'a-withdrawn-draft' }, ON)).toBe(false);
  });
  it('only a review left after the permission was given counts as "since"', () => {
    expect(leftSincePermission('2026-12-02T09:00:00Z', agreed)).toBe(true);
    expect(leftSincePermission('2026-11-30T09:00:00Z', agreed)).toBe(false);
    expect(leftSincePermission(undefined, agreed)).toBe(false);
    expect(leftSincePermission('2026-12-02T09:00:00Z', { automation_mode: 'hands_off' })).toBe(false);
  });
  it('the publisher puts a post booked under hands-off back to waiting when hands-off is not in force, before anything is sent to Google', () => {
    const publisher = readFileSync(new URL('../app/api/cron/post-publisher/route.ts', import.meta.url), 'utf8');
    const guard = publisher.indexOf("user.automation_mode === 'hands_off' && !isHandsOff(user) && !post.approved_at");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(publisher.indexOf('refreshAccessToken('));
    expect(guard).toBeLessThan(publisher.indexOf('loggedCreatePost('));
    // And the pause and hold checks come before any Google call too.
    for (const check of ['automationHeld(user.retailers)', 'isPaused(user)']) expect(publisher.indexOf(check)).toBeLessThan(publisher.indexOf('refreshAccessToken('));
  });
  it('the preview email is not sent to a paused or held shop', () => {
    expect(readFileSync(new URL('../app/api/cron/post-previews/route.ts', import.meta.url), 'utf8')).toMatch(/if \(isPaused\(user\) \|\| automationHeld\(user\.retailers\)\) continue;/);
  });
});

// ── The route ──
// A stand-in database that keeps the posts and applies each query's own filters, so a wrong filter shows.
const state: { user: any; posts: any[]; profiles: any[]; failUpdate: boolean; failPosts: boolean } = { user: null, posts: [], profiles: [], failUpdate: false, failPosts: false };
vi.mock('@/lib/session', () => ({ getSessionUserId: (req: any) => req.headers.get('x-test-user') }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const tests: Array<(r: any) => boolean> = [];
      let patch: any = null;
      const rows = () => (t === 'users' ? [state.user] : t === 'profiles' ? state.profiles : t === 'scheduled_posts' ? state.posts : []).filter((r) => tests.every((f) => f(r)));
      const run = () => {
        if (patch) {
          if ((t === 'users' && state.failUpdate) || (t === 'scheduled_posts' && state.failPosts)) return { data: null, error: { message: 'db down' } };
          const hit = rows(); for (const r of hit) Object.assign(r, patch);
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        return { data: rows(), error: null };
      };
      const q: any = {
        select: () => q, update: (p: any) => { patch = p; return q; },
        eq: (c: string, v: any) => { tests.push((r) => r[c] === v); return q; },
        in: (c: string, v: any[]) => { tests.push((r) => v.includes(r[c])); return q; },
        is: (c: string, v: any) => { tests.push((r) => (r[c] ?? null) === v); return q; },
        gt: (c: string, v: any) => { tests.push((r) => r[c] > v); return q; },
        lte: (c: string, v: any) => { tests.push((r) => r[c] <= v); return q; },
        single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (res: any) => res(run()),
      };
      return q;
    },
  },
}));
import { GET, POST } from '@/app/api/automation-mode/route';

const req = (body?: unknown, user: string | null = 'u1') => new NextRequest('http://stellar.localhost/api/automation-mode', {
  method: body === undefined ? 'GET' : 'POST', headers: { 'x-tenant-slug': 'stellar', ...(user ? { 'x-test-user': user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const FUTURE = '2999-01-01T10:00:00.000Z', PAST = '2001-01-01T10:00:00.000Z';
const post = (id: string, status: string, scheduled_for: string, o: any = {}) => ({ id, profile_id: 'p1', status, scheduled_for, approved_at: null, ...o });
const statusOf = (id: string) => state.posts.find((p) => p.id === id).status;

describe('/api/automation-mode', () => {
  beforeEach(() => {
    state.user = { id: 'u1', auto_post_enabled: false, auto_reply_enabled: false, automation_mode: null, retailers: [{ connection_status: 'connected' }] };
    state.profiles = [{ id: 'p1', user_id: 'u1' }];
    state.posts = [post('waiting-future', 'awaiting_approval', FUTURE), post('waiting-past', 'awaiting_approval', PAST), post('someone-elses', 'awaiting_approval', FUTURE, { profile_id: 'p9' })];
    state.failUpdate = false; state.failPosts = false;
    process.env.HANDS_OFF_MODE = 'on'; process.env.SESSION_ACCEPT_LEGACY_COOKIE = 'false';
  });
  afterEach(() => { delete process.env.HANDS_OFF_MODE; delete process.env.SESSION_ACCEPT_LEGACY_COOKIE; });
  const choose = () => POST(req({ mode: 'hands_off', wordingVersion: HANDS_OFF_WORDING_VERSION }));

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
  it('records hands-off with the time and wording version, and books the shop\'s own waiting posts', async () => {
    const j = await (await choose()).json();
    expect(j).toMatchObject({ ok: true, mode: 'hands_off', label: 'Hands-off', booked: 1 });
    expect(state.user).toMatchObject({ automation_mode: 'hands_off', automation_consent_version: HANDS_OFF_WORDING_VERSION, auto_post_enabled: true, auto_reply_enabled: true });
    expect(state.user.automation_consent_at).toBeTruthy();
    expect(statusOf('waiting-future')).toBe('pending_approval');
    // Booked by the choice, not approved one by one: no approval date, so it can be told apart later.
    expect(state.posts.find((p) => p.id === 'waiting-future').approved_at).toBeNull();
    // A post whose date has passed is dropped, not published late. Another shop's post is not touched.
    expect(statusOf('waiting-past')).toBe('cancelled');
    expect(statusOf('someone-elses')).toBe('awaiting_approval');
  });
  it('leaving hands-off: both switches go off, and a post that was only booked by the choice waits for the shop again', async () => {
    await choose();
    state.posts.push(post('approved-by-hand', 'pending_approval', FUTURE, { approved_at: '2026-12-01T09:00:00Z' }));
    const j = await (await POST(req({ mode: 'ask_first' }))).json();
    expect(j).toMatchObject({ ok: true, mode: 'ask_first' });
    expect(state.user).toMatchObject({ automation_mode: 'ask_first', auto_post_enabled: false, auto_reply_enabled: false });
    expect(state.user.automation_consent_at).toBeTruthy();                 // the record of what was agreed is kept
    expect(statusOf('waiting-future')).toBe('awaiting_approval');
    expect(statusOf('approved-by-hand')).toBe('pending_approval');         // one the shop approved itself still goes
  });
  it('"ask me first" for a shop that was never in hands-off leaves its switches and posts alone', async () => {
    state.user.auto_reply_enabled = true;
    state.posts.push(post('booked', 'pending_approval', FUTURE));
    await POST(req({ mode: 'ask_first' }));
    expect(state.user).toMatchObject({ automation_mode: 'ask_first', auto_reply_enabled: true });
    expect(statusOf('booked')).toBe('pending_approval');
  });
  it('refuses a choice made against out-of-date wording, and records nothing', async () => {
    const res = await POST(req({ mode: 'hands_off', wordingVersion: 'old' }));
    expect(res.status).toBe(409);
    expect(state.user.automation_mode).toBeNull();
    expect(statusOf('waiting-future')).toBe('awaiting_approval');
  });
  it('refuses to record permission while a forgeable sign-in cookie is still accepted', async () => {
    delete process.env.SESSION_ACCEPT_LEGACY_COOKIE;
    expect((await choose()).status).toBe(409);
    expect(state.user.automation_mode).toBeNull();
    // Asking first, and pausing, are still allowed: neither switches anything on.
    expect((await POST(req({ mode: 'ask_first' }))).status).toBe(200);
  });
  it('with the switch off the choice is refused, but Pause still works', async () => {
    delete process.env.HANDS_OFF_MODE;
    expect((await choose()).status).toBe(404);
    expect(state.user.automation_mode).toBeNull();
    const j = await (await POST(req({ paused: true }))).json();
    expect(j).toMatchObject({ ok: true, paused: true });
    expect(state.user.automation_paused_at).toBeTruthy();
  });
  it('pausing drops every booked post, on every listing row the account has; resuming drops one whose time passed meanwhile', async () => {
    state.profiles.push({ id: 'p2', user_id: 'u1' });
    state.posts.push(post('booked', 'pending_approval', FUTURE), post('booked-second-row', 'pending_approval', FUTURE, { profile_id: 'p2' }), post('theirs', 'pending_approval', FUTURE, { profile_id: 'p9' }));
    const j = await (await POST(req({ paused: true }))).json();
    expect(j).toMatchObject({ paused: true, dropped: 2 });
    expect([statusOf('booked'), statusOf('booked-second-row'), statusOf('theirs')]).toEqual(['cancelled', 'cancelled', 'pending_approval']);
    expect(statusOf('waiting-future')).toBe('awaiting_approval');
    // Approved by hand while paused, and its time has passed: it must not go up the moment the shop resumes.
    state.posts.push(post('overdue', 'pending_approval', PAST), post('still-to-come', 'pending_approval', FUTURE));
    await POST(req({ paused: false }));
    expect(state.user.automation_paused_at).toBeNull();
    expect([statusOf('overdue'), statusOf('still-to-come')]).toEqual(['cancelled', 'pending_approval']);
  });
  it('says so when it could not be saved, including when the posts could not be booked', async () => {
    state.failUpdate = true;
    expect((await POST(req({ mode: 'ask_first' }))).status).toBe(500);
    state.failUpdate = false; state.failPosts = true;
    expect((await choose()).status).toBe(500);
  });
  it('tells a held shop that nothing starts until its listing is checked', async () => {
    state.user.retailers = [{ connection_status: 'check_listing', listing_confirmed_at: null }];
    const j = await (await choose()).json();
    expect(j).toMatchObject({ ok: true, mode: 'hands_off', held: true });
  });
});
