/**
 * Dummy run on STAGING: the real route handlers and the real database, with
 * Google, the AI model, email and SMS all faked (./fakes.ts).
 *
 * Do not run this directly. Use the launcher, which checks the target, proves
 * staging is empty first, and proves it is unchanged afterwards:
 *
 *     /usr/local/bin/python3.14 scripts/dummy-run/run.py
 *
 * Everything it creates is labelled: shops are named "ZZ-TEST …", people are
 * dummy-run+…@invalid.example (a domain that cannot receive mail), and the one
 * phone number is in Ofcom's reserved-for-drama range. All of it is deleted at
 * the end, whether the run passes or not.
 *
 * It is NOT part of `npm test`: the file name does not end in .test.ts, and it
 * refuses to start without the launcher's environment.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { newWorld, installFetchGuard, makeListing, addReview, metricValue, PER_DAY, type FakeListing, type Persona } from './fakes';

const ROOT = resolve(__dirname, '..', '..');
const STAGING_HOST = process.env.DUMMY_RUN_STAGING_HOST || '';
const ORIGIN = 'http://stellar.localhost:3000';
const TEST_PREFIX = 'ZZ-TEST ';
const EMAIL = (k: string) => `dummy-run+${k}@invalid.example`;
const FUNDER_EMAIL = 'dummy-run+funder@invalid.example';
const PHONE = '07700900123'; // Ofcom's reserved range: not a real number
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const AD_START = iso(new Date(Date.now() - 35 * DAY));
const PID = (k: string) => `ChIJdummyrun${k.toUpperCase().repeat(15)}`.slice(0, 27);
const LOW_NEW = 'LOWSTAR-MARKER-NEW the fitter never turned up and nobody rang me';
const LOW_ONBOARD = 'LOWSTAR-MARKER-ONBOARD arrived late and left a mess on the stairs';
const LOW_OLD = 'LOWSTAR-MARKER-OLD this was months ago and I am still cross';

const world = newWorld();
let realFetch: typeof fetch;
let db: any;

// ── Results ────────────────────────────────────────────────────────────────
interface StepResult { area: string; name: string; ok: boolean; detail: string }
const results: StepResult[] = [];
const notes: string[] = [];
async function step(area: string, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) || '';
    results.push({ area, name, ok: true, detail });
  } catch (err: any) {
    results.push({ area, name, ok: false, detail: String(err?.message || err).split('\n').slice(0, 6).join(' | ').slice(0, 700) });
  }
}

// ── Calling the app ────────────────────────────────────────────────────────
const mod = (rel: string) => import(/* @vite-ignore */ pathToFileURL(resolve(ROOT, rel)).href) as Promise<any>;
const route = (name: string) => mod(`app/api/${name}/route.ts`);

function request(path: string, opts: { method?: string; body?: any; cookie?: string; headers?: Record<string, string>; form?: Record<string, string>; formData?: FormData } = {}) {
  const headers: Record<string, string> = { host: 'stellar.localhost:3000', 'x-tenant-slug': 'stellar', ...(opts.headers || {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: any;
  if (opts.formData) body = opts.formData;
  else if (opts.form) { body = new URLSearchParams(opts.form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['content-type'] = 'application/json'; }
  return new NextRequest(`${ORIGIN}${path}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body } as any);
}

async function call(name: string, method: string, path: string, opts: Parameters<typeof request>[1] = {}) {
  const handler = (await route(name))[method];
  if (!handler) throw new Error(`no ${method} handler on /api/${name}`);
  const res: Response = await handler(request(path, { ...opts, method }), { params: {} });
  const text = await res.clone().text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* an HTML page or a redirect */ }
  return { res, status: res.status, data, text, location: res.headers.get('location') };
}

const admin = (name: 'admin/pilot' | 'admin/photos', body: any) =>
  call(name, 'POST', `/api/${name}`, { body, headers: { authorization: `Bearer ${process.env.ADMIN_PASSWORD}` } });
const cron = (name: string, qs = '') =>
  call(`cron/${name}`, 'GET', `/api/cron/${name}${qs}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

function need(cond: any, message: string): asserts cond { if (!cond) throw new Error(message); }
/** JSON with keys in a fixed order, so two equal objects compare equal whatever order their keys arrive in. */
const canon = (v: any): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

// ── The cast ───────────────────────────────────────────────────────────────
interface Shop { key: string; name: string; retailerId?: string; inviteToken?: string; cookie?: string; userId?: string; profileId?: string; dest?: string }
const shops: Record<string, Shop> = {};
for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) shops[k] = { key: k, name: `${TEST_PREFIX}Shop ${k.toUpperCase()} (dummy run)` };

function cast() {
  const persona = (k: string, listings: FakeListing[]): Persona => (world.personas[k] = { key: k, email: EMAIL(k), name: `${TEST_PREFIX}Person ${k.toUpperCase()}`, listings });
  const a = makeListing(1, shops.a.name, PID('a'), true, AD_START);
  // Shop A's listing as a new shop would bring it: a mix of answered and unanswered reviews.
  addReview(a, 'rev-old-1star', 'ONE', 60, LOW_OLD, 'Olive Oldgrudge');
  addReview(a, 'rev-answered', 'FIVE', 40, 'Lovely job, thank you.', 'Annie Answered', true);
  addReview(a, 'rev-4star', 'FOUR', 20, 'Good work, a day later than planned.', 'Frank Fourstar');
  addReview(a, 'rev-2star', 'TWO', 3, LOW_ONBOARD, 'Lena Lowstar');
  addReview(a, 'rev-5star', 'FIVE', 2, 'Brilliant stair runner, really pleased.', 'Sam Fivestar');
  persona('a', [a]);
  persona('b', [makeListing(2, `${TEST_PREFIX}Some Other Business`, 'ChIJdummyrunNOTTHESHOPxxxxx')]); // not the listing we expected
  persona('c', [makeListing(3, shops.c.name, PID('c'), false)]);                                        // right listing, Google has not verified it
  persona('d', [makeListing(4, shops.d.name, PID('d'))]);
  persona('e', [makeListing(5, shops.e.name, PID('e'))]);
  persona('f', []);                                                                                       // manages nothing
}
const listingOf = (k: string) => world.personas[k].listings[0];

async function signIn(k: string): Promise<{ dest: string; cookie: string }> {
  const s = shops[k];
  need(s.inviteToken, `no invite link for shop ${k}`);
  const accepted = await call('invite/accept', 'POST', '/api/invite/accept', { form: { token: s.inviteToken } });
  need(accepted.status === 303 && accepted.location?.includes('/api/auth/callback/google?invite='), `invite accept gave ${accepted.status} ${accepted.location}`);
  const toGoogle = await call('auth/callback/google', 'GET', new URL(accepted.location!).pathname + new URL(accepted.location!).search);
  need(toGoogle.location?.startsWith('https://accounts.google.com/'), `expected a redirect to Google, got ${toGoogle.status} ${toGoogle.location}`);
  const g = new URL(toGoogle.location!);
  need(g.searchParams.get('redirect_uri') === `${ORIGIN}/api/auth/callback/google`, `redirect_uri was ${g.searchParams.get('redirect_uri')}`);
  const state = g.searchParams.get('state') || '';
  // "Google" sends the person back with a code.
  const back = await call('auth/callback/google', 'GET', `/api/auth/callback/google?code=code-${k}&state=${encodeURIComponent(state)}`);
  const dest = back.location ? new URL(back.location).pathname + new URL(back.location).search : '';
  const cookieValue = (back.res as any).cookies?.get?.('chocka_session')?.value;
  need(cookieValue, `no session cookie after sign-in (went to ${dest})`);
  s.cookie = `chocka_session=${cookieValue}`;
  s.dest = dest;
  const { data: u } = await db.from('users').select('id, tenant_id, google_refresh_token').eq('email', EMAIL(k)).single();
  need(u?.id, 'no user row after sign-in');
  need(!String(u.google_refresh_token).includes(`rt-${k}`), 'the Google credential was stored unencrypted');
  s.userId = u.id;
  const { data: p } = await db.from('profiles').select('id').eq('user_id', u.id).maybeSingle();
  s.profileId = p?.id;
  return { dest, cookie: s.cookie };
}

const retailerRow = async (k: string) => (await db.from('retailers').select('*').eq('id', shops[k].retailerId).maybeSingle()).data;
const postsOf = async (k: string) => (await db.from('scheduled_posts').select('*').eq('profile_id', shops[k].profileId).order('created_at', { ascending: true })).data || [];
const makeDue = (id: string) => db.from('scheduled_posts').update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() }).eq('id', id);
/** Pretend the published posts were in earlier weeks, so the weekly generator will write the next one. */
const ageAllPosts = async (k: string) => {
  for (const p of await postsOf(k)) await db.from('scheduled_posts').update({ scheduled_for: new Date(Date.parse(p.scheduled_for) - 14 * DAY).toISOString() }).eq('id', p.id);
};
async function approvePost(id: string) {
  const { generatePostActionHash } = await mod('lib/cron.ts');
  const qs = `?id=${id}&action=approve&hash=${generatePostActionHash(id, 'approve')}`;
  const page = await call('posts/approve', 'GET', `/api/posts/approve${qs}`);
  const stillWaiting = (await db.from('scheduled_posts').select('status').eq('id', id).single()).data.status;
  need(page.status === 200 && stillWaiting === 'awaiting_approval', `opening the approve link changed something (status ${stillWaiting})`);
  await call('posts/approve', 'POST', `/api/posts/approve${qs}`);
  const after = (await db.from('scheduled_posts').select('status, approved_at').eq('id', id).single()).data;
  need(after.status === 'pending_approval' && after.approved_at, `after approving, status was ${after.status}`);
}

describe('dummy run on staging', () => {
  beforeAll(async () => {
    need(STAGING_HOST && process.env.NEXT_PUBLIC_SUPABASE_URL === `https://${STAGING_HOST}`, 'Not started by the launcher (scripts/dummy-run/run.py). Refusing to run.');
    need(STAGING_HOST.startsWith('pauwvdntclmxlcettfgc'), 'The target is not the staging project. Refusing to run.');
    realFetch = installFetchGuard(world, STAGING_HOST);
    cast();
    db = (await mod('lib/supabase.ts')).supabaseAdmin;
    const [{ count: users }, { count: retailers }] = await Promise.all([
      db.from('users').select('id', { count: 'exact', head: true }),
      db.from('retailers').select('id', { count: 'exact', head: true }),
    ]);
    need(users === 0 && retailers === 0, `staging is not empty (users ${users}, retailers ${retailers})`);
  }, 120_000);

  afterAll(async () => {
    // Delete ALL test data, whatever happened above. The launcher then checks
    // every table's row count against the count taken before the run.
    const problems: string[] = [];
    const tryDo = async (what: string, fn: () => Promise<any>) => { try { const r = await fn(); if (r?.error) problems.push(`${what}: ${r.error.message}`); } catch (e: any) { problems.push(`${what}: ${e?.message}`); } };
    const { data: testShops } = await db.from('retailers').select('id').like('name', `${TEST_PREFIX}%`);
    for (const r of testShops || []) {
      await tryDo('photo files', async () => {
        const { data: files } = await db.storage.from('shop-photos').list(r.id, { limit: 1000 });
        if (files?.length) return db.storage.from('shop-photos').remove(files.map((f: any) => `${r.id}/${f.name}`));
      });
    }
    const locs = Object.values(world.personas).flatMap((p) => p.listings.map((l) => l.loc));
    await tryDo('change_log', () => db.from('change_log').delete().in('location_name', locs));
    await tryDo('users', () => db.from('users').delete().like('email', 'dummy-run+%@invalid.example'));
    await tryDo('retailers', () => db.from('retailers').delete().like('name', `${TEST_PREFIX}%`));
    await tryDo('funder_users', () => db.from('funder_users').delete().eq('email', FUNDER_EMAIL));
    notes.push(problems.length ? `CLEAN-UP PROBLEMS: ${problems.join('; ')}` : 'Clean-up ran with no errors.');

    const summary = {
      ranAt: new Date().toISOString(),
      results,
      notes,
      outside: {
        emailsCapturedNotSent: world.emails.length,
        emailRecipients: Array.from(new Set(world.emails.map((e) => e.to))).sort(),
        smsCapturedNotSent: world.sms.length,
        smsRecipients: Array.from(new Set(world.sms.map((s) => s.to))).sort(),
        modelCallsFaked: world.modelCalls.length,
        modelsAskedFor: Array.from(new Set(world.modelCalls.map((m) => m.model))),
        googleRequestsFaked: world.googleRequests,
        googleRequestsTheFakeCouldNotAnswer: Array.from(new Set(world.unhandledGoogle)),
        stagingRequests: world.stagingRequests,
        blockedOutboundRequests: world.blocked,
      },
    };
    if (process.env.DUMMY_RUN_OUT) writeFileSync(process.env.DUMMY_RUN_OUT, JSON.stringify(summary, null, 1));
    const failed = results.filter((r) => !r.ok);
    console.log(`\nDUMMY RUN: ${results.length - failed.length} of ${results.length} checks passed.`);
    for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${r.area}] ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
    for (const n of notes) console.log(`  NOTE  ${n}`);
  }, 180_000);

  it('runs every flow and records what happened', async () => {
    // ════════ 0. Switches are off unless turned on ════════
    await step('flags', 'console, photos and the preview email are all off by default', async () => {
      const login = await call('console/login', 'POST', '/api/console/login', { body: { email: FUNDER_EMAIL } });
      const data = await call('console/data', 'GET', '/api/console/data');
      const upload = await call('photos/upload', 'GET', '/api/photos/upload?token=anything-at-all-anything-at-all');
      const photosAdmin = await admin('admin/photos', { action: 'list', retailerId: 'x' });
      const { earlyPreviewEmailsEnabled } = await mod('lib/safe-automation.ts');
      need(login.status === 404 && data.status === 404, `console answered ${login.status}/${data.status} with the flag off`);
      need(upload.status === 404, `photo upload answered ${upload.status} with the flag off`);
      need(photosAdmin.status === 403, `photo admin answered ${photosAdmin.status} with the flag off`);
      need(earlyPreviewEmailsEnabled() === false, 'the early preview email is on');
      return 'console 404, photo upload 404, photo admin 403, preview email off';
    });

    // ════════ 1. Test shops, links ════════
    await step('setup', 'add seven TEST shops through /admin/pilot; wrong password is refused', async () => {
      const bad = await call('admin/pilot', 'POST', '/api/admin/pilot', { body: { action: 'list' }, headers: { authorization: 'Bearer wrong' } });
      need(bad.status === 401, `wrong admin password got ${bad.status}`);
      for (const s of Object.values(shops)) {
        const r = await admin('admin/pilot', { action: 'add', name: s.name, town: 'Testtown', contactEmail: EMAIL(`contact-${s.key}`) });
        need(r.status === 200 && r.data?.added?.id, `add failed for ${s.key}: ${r.status} ${r.text.slice(0, 120)}`);
        s.retailerId = r.data.added.id;
        // The place id Tarkett's list would have given us. Test rows only.
        await db.from('retailers').update({ place_id: PID(s.key) }).eq('id', s.retailerId);
      }
      return '7 shops, all named "ZZ-TEST …"';
    });

    await step('setup', 'generate invite links; nothing is sent', async () => {
      const before = world.emails.length + world.sms.length;
      const r = await admin('admin/pilot', { action: 'invite', retailerIds: Object.values(shops).map((s) => s.retailerId) });
      need(r.status === 200 && r.data.results.every((x: any) => x.ok), `invite failed: ${r.text.slice(0, 200)}`);
      for (const x of r.data.results) {
        const s = Object.values(shops).find((y) => y.retailerId === x.retailerId)!;
        need(x.link.startsWith(`${ORIGIN}/invite/`), `link was ${x.link.slice(0, 40)}`);
        s.inviteToken = x.link.split('/invite/')[1];
      }
      need(world.emails.length + world.sms.length === before, 'generating links sent a message');
      const again = await admin('admin/pilot', { action: 'invite', retailerIds: [shops.a.retailerId] });
      need(again.data.results[0].ok === false, 'a second link was issued while the first was still valid');
      return '7 links, 0 messages; a second link for the same shop is refused';
    });

    // ════════ 2. Sign-in and ownership statuses ════════
    await step('ownership', 'a shop with a link it has not used reads "invited"', async () => {
      const r = await retailerRow('g');
      need(r.connection_status === 'invited', `status was ${r.connection_status}`);
      return r.connection_detail;
    });
    const expectStatus = (k: string, status: string, why: string) => step('ownership', `shop ${k.toUpperCase()}: ${why}`, async () => {
      const { dest } = await signIn(k);
      const r = await retailerRow(k);
      need(r.connection_status === status, `expected ${status}, got ${r.connection_status} (${r.connection_detail}); sent to ${dest}`);
      need(r.user_id === shops[k].userId, 'the shop was not linked to the account that signed in');
      return `${status}: "${r.connection_detail}"; sent to ${dest}; listing bound: ${shops[k].profileId ? 'yes' : 'no'}`;
    });
    await expectStatus('a', 'connected', 'manages the expected listing, so "connected"');
    await expectStatus('b', 'check_listing', 'manages a different listing, so "check listing" (flagged, not blocked)');
    await expectStatus('c', 'waiting_google', 'right listing but Google has not verified it, so "waiting on Google"');
    await expectStatus('d', 'connected', 'second connected shop');
    await expectStatus('e', 'connected', 'third connected shop');
    await expectStatus('f', 'no_access', 'manages no listing at all, so "no access found"');

    await step('ownership', 'signing in without an invite is refused (Stellar is invite-only)', async () => {
      world.personas.stranger = { key: 'stranger', email: EMAIL('stranger'), name: `${TEST_PREFIX}Stranger`, listings: [] };
      const back = await call('auth/callback/google', 'GET', `/api/auth/callback/google?code=code-stranger&state=${encodeURIComponent(JSON.stringify({ action: null, plan: 'monthly' }))}`);
      const { data: u } = await db.from('users').select('id').eq('email', EMAIL('stranger')).maybeSingle();
      need(back.location?.includes('invite_required') && !u, `stranger went to ${back.location}, account created: ${!!u}`);
      return 'sent to /login?error=invite_required, no account created';
    });

    await step('ownership', '/admin/pilot shows the statuses, review links and nothing secret', async () => {
      const r = await admin('admin/pilot', { action: 'list' });
      const by = (k: string) => r.data.retailers.find((x: any) => x.id === shops[k].retailerId);
      need(by('a').state === 'live' && by('g').state === 'invited', `A is ${by('a').state}, G is ${by('g').state}`);
      need(by('a').review?.source === 'connected' && by('a').review.link.includes(PID('a')), 'A has no review link from its connected listing');
      need(by('g').review?.source === 'baseline', 'G (not connected) should use the baseline place id, marked "check first"');
      need(!/rt-|refresh_token|google_refresh/.test(r.text), 'the admin list leaked a credential');
      return `counts: ${JSON.stringify(r.data.counts)}`;
    });

    // ════════ 3. Onboarding (shop A in full) ════════
    const A = () => shops.a;
    const la = () => listingOf('a');
    let auditA: any;
    await step('onboarding', 'the audit scores the listing and pulls its history from "Google"', async () => {
      const r = await call('audit', 'POST', '/api/audit', { cookie: A().cookie });
      need(r.status === 200 && r.data?.audit, `audit gave ${r.status} ${r.text.slice(0, 160)}`);
      auditA = r.data;
      const { data: days } = await db.from('daily_metrics').select('date').eq('profile_id', A().profileId).eq('metric', 'CALL_CLICKS').order('date', { ascending: true });
      need(days?.length > 300, `only ${days?.length} days of history stored`);
      return `score ${r.data.audit.score}, predicted ${r.data.predicted}; ${days.length} days of history stored, from ${days[0].date} to ${days[days.length - 1].date}`;
    });
    await step('onboarding', 'an audit with no session is refused', async () => {
      const r = await call('audit', 'POST', '/api/audit');
      const forged = await call('audit', 'POST', '/api/audit', { cookie: `chocka_session=${A().userId}.9999999999.deadbeef` });
      need(r.status === 401 && forged.status === 401, `no cookie: ${r.status}, forged cookie: ${forged.status}`);
      return 'no cookie 401, forged cookie 401';
    });
    await step('voice', 'voice answers are saved; a phone number in them is refused', async () => {
      const bad = await call('voice', 'POST', '/api/voice', { cookie: A().cookie, body: { voice: { about: 'Call us on 0113 496 0000 for a quote' } } });
      need(bad.status === 400 && /phone/.test(bad.data.error), `a phone number was accepted (${bad.status})`);
      const ok = await call('voice', 'POST', '/api/voice', { cookie: A().cookie, body: { voice: { tone: 'down_to_earth', signOff: 'Dummy and the team', wordsToAvoid: 'cheap', about: 'A test flooring shop.', specialities: 'stair runners, vinyl' } } });
      need(ok.status === 200, `save failed ${ok.status}`);
      const r = await retailerRow('a');
      need(r.voice_profile?.signOff === 'Dummy and the team' && r.voice_updated_by === 'shop', 'voice not stored against the shop');
      return 'saved by the shop; refused: "' + bad.data.error.slice(0, 60) + '…"';
    });
    let previews: any;
    await step('onboarding', 'previews are drafted in the shop\'s voice; the reply sample is never a low-star review', async () => {
      const r = await call('audit/previews', 'POST', '/api/audit/previews', { cookie: A().cookie });
      need(r.status === 200, `previews gave ${r.status} ${r.text.slice(0, 120)}`);
      previews = r.data.previews;
      need(previews.firstPost?.endsWith('Dummy and the team'), 'the post preview did not use the sign-off');
      need(previews.reviewPreview && previews.reviewPreview.rating >= 4, `reply sample was for a ${previews.reviewPreview?.rating}-star review`);
      need(previews.reviewPreview.totalUnreplied === 2, `expected 2 reviews to reply to (the 4 and 5 star), got ${previews.reviewPreview.totalUnreplied}`);
      return `reply sample: ${previews.reviewPreview.rating} stars; reviews it will reply to: ${previews.reviewPreview.totalUnreplied}`;
    });
    await step('onboarding', 'mobile number and choices are saved; a bad number is refused', async () => {
      const bad = await call('account/delete', 'PATCH', '/api/account/delete', { cookie: A().cookie, body: { phone_number: '12345' } });
      const ok = await call('account/delete', 'PATCH', '/api/account/delete', { cookie: A().cookie, body: { phone_number: PHONE, auto_post_enabled: true, auto_reply_enabled: true } });
      need(bad.status === 400 && ok.status === 200, `bad number ${bad.status}, good number ${ok.status}`);
      return 'saved';
    });
    await step('onboarding', 'applying the fixes changes the listing, replies to 4 and 5 stars only, and queues a holding reply', async () => {
      const smsBefore = world.sms.length, emailsBefore = world.emails.length;
      const r = await call('profile-fix', 'POST', '/api/profile-fix', { cookie: A().cookie, body: {
        description: previews.description, services: previews.services, categories: previews.categories, hours: auditA.defaultHours || undefined,
        replyToReviews: true, firstPost: previews.firstPost, queueLowStar: true,
      } });
      need(r.status === 200, `profile-fix gave ${r.status} ${r.text.slice(0, 200)}`);
      const failed = (r.data.results || []).filter((x: any) => !x.success);
      need(failed.length === 0, `steps failed: ${JSON.stringify(failed).slice(0, 300)}`);
      need(la().location.profile?.description === previews.description, 'the description did not reach "Google"');
      const rev = (id: string) => la().reviews.find((x) => x.reviewId === id)!;
      need(rev('rev-5star').reviewReply && rev('rev-4star').reviewReply, 'a 4 or 5 star review did not get its reply');
      need(!rev('rev-2star').reviewReply && !rev('rev-old-1star').reviewReply, 'A LOW-STAR REVIEW GOT A REPLY WITHOUT APPROVAL');
      need(rev('rev-5star').reviewReply!.comment.endsWith('Dummy and the team'), 'the reply did not use the sign-off');
      const { data: pending } = await db.from('review_replies').select('reply_content, status, reviews!inner(google_review_id, profile_id)').eq('reviews.profile_id', A().profileId).eq('status', 'pending');
      need(pending.length === 1 && pending[0].reviews.google_review_id === 'rev-2star', `expected one holding reply queued for the recent 2-star, found ${pending.length}`);
      need(/^Thank you for your feedback, Lena\./.test(pending[0].reply_content) && !/refund|fault|discount|compensat/i.test(pending[0].reply_content), 'the queued reply is not the fixed holding reply');
      const { data: old } = await db.from('reviews').select('id').eq('profile_id', A().profileId).eq('google_review_id', 'rev-old-1star');
      need(old.length === 0, 'the 60-day-old 1-star review was picked up (14-day rule)');
      need(world.sms.length === smsBefore && world.emails.length === emailsBefore, 'onboarding sent a message');
      const { data: recorded } = await db.from('reviews').select('google_review_id').eq('profile_id', A().profileId);
      const ids = (recorded || []).map((x: any) => x.google_review_id).sort();
      need(ids.includes('rev-5star') && ids.includes('rev-4star'), `the reviews onboarding replied to were not recorded (recorded: ${ids.join(', ') || 'none'}), so the daily check will treat them as new`);
      return `${r.data.successfulFixes} of ${r.data.totalFixes} steps; replies on the 4 and 5 star; 2-star: holding reply waiting; 60-day-old 1-star: left alone; 0 messages`;
    });
    await step('safety', 'no low-star review text was ever sent to the model', async () => {
      const leaked = world.modelCalls.filter((m) => /LOWSTAR-MARKER/.test(m.user + m.system));
      need(leaked.length === 0, `${leaked.length} model call(s) contained a low-star review`);
      return `${world.modelCalls.length} model calls so far, none with a low-star review`;
    });
    await step('change log', 'every change to the listing was recorded with its previous value', async () => {
      const { data: rows } = await db.from('change_log').select('action, target, status, source, before_value, after_value').eq('location_name', la().loc).order('created_at', { ascending: true });
      need(rows.length >= 4 && rows.every((x: any) => x.status === 'applied'), `${rows.length} rows, statuses ${Array.from(new Set(rows.map((x: any) => x.status)))}`);
      const desc = rows.find((x: any) => x.action === 'update_location' && String(x.target).includes('profile'));
      need(desc && desc.before_value?.profile?.description === '', 'the description change did not record what was there before');
      return `${rows.length} rows, all applied: ${rows.map((x: any) => x.action).join(', ')}`;
    });

    // ════════ 4. A low-star holding reply, approved from the dashboard ════════
    await step('holding reply', 'the dashboard shows the waiting reply; opening the link changes nothing; pressing the button publishes it', async () => {
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: A().cookie });
      need(dash.status === 200, `dashboard gave ${dash.status} ${dash.text.slice(0, 160)}`);
      need(dash.data.pendingReplies?.length === 1, `dashboard shows ${dash.data.pendingReplies?.length} waiting replies, expected 1`);
      const p = dash.data.pendingReplies[0];
      need(p.rating === 2 && p.reviewerName === 'Lena Lowstar', 'wrong review on the card');
      const rev = () => la().reviews.find((x) => x.reviewId === 'rev-2star')!;
      const page = await call('reviews/auto-reply', 'GET', p.approveUrl);
      need(page.status === 200 && !rev().reviewReply, 'opening the approve link published the reply');
      const tampered = await call('reviews/auto-reply', 'POST', p.approveUrl.replace(/hash=\w{4}/, 'hash=0000'));
      need(!rev().reviewReply && /Invalid link/.test(tampered.text), 'a tampered link was accepted');
      await call('reviews/auto-reply', 'POST', p.approveUrl);
      need(rev().reviewReply?.comment === p.reply, 'the approved reply did not reach "Google" word for word');
      const again = await call('reviews/auto-reply', 'POST', p.approveUrl);
      need(/Already handled/.test(again.text), 'the same reply could be approved twice');
      return 'shown on the dashboard; link alone does nothing; tampered link refused; button publishes; second press refused';
    });

    // ════════ 5. Posts and first-three approval ════════
    await step('posts', 'post 1 (from onboarding) waits for approval and is not published until approved', async () => {
      let posts = await postsOf('a');
      need(posts.length === 1 && posts[0].status === 'awaiting_approval', `expected one post awaiting approval, got ${posts.map((p: any) => p.status)}`);
      await makeDue(posts[0].id);
      const early = await cron('post-publisher');
      need(early.data.published === 0 && la().posts.length === 0, 'AN UNAPPROVED POST WAS PUBLISHED');
      const previewsRun = await cron('post-previews');
      need(world.emails.filter((e) => /approve|waiting/i.test(e.subject)).length === 0, 'the preview email was sent while switched off');
      await approvePost(posts[0].id);
      await makeDue(posts[0].id);
      const pub = await cron('post-publisher');
      need(pub.data.published === 1 && la().posts.length === 1 && la().posts[0].summary === posts[0].content, `published ${pub.data.published}`);
      return `not published while waiting; preview job: ${JSON.stringify(previewsRun.data).slice(0, 90)}; published after approval`;
    });
    await step('posts', 'posts 2 and 3 also wait; post 4 does not, and gets the usual preview', async () => {
      const statuses: string[] = [];
      for (const n of [2, 3]) {
        await ageAllPosts('a');
        const gen = await cron('post-generator');
        need(gen.data.generated === 1, `post ${n}: generator made ${gen.data.generated}`);
        const p = (await postsOf('a')).pop();
        statuses.push(p.status);
        need(p.status === 'awaiting_approval', `post ${n} was ${p.status}`);
        await approvePost(p.id); await makeDue(p.id);
        const pub = await cron('post-publisher');
        need(pub.data.published === 1, `post ${n}: published ${pub.data.published}`);
      }
      await ageAllPosts('a');
      const emailsBefore = world.emails.length;
      const gen = await cron('post-generator');
      const p4 = (await postsOf('a')).pop();
      statuses.push(p4.status);
      need(gen.data.generated === 1 && p4.status === 'pending_approval', `post 4 was ${p4.status}`);
      const preview = world.emails.slice(emailsBefore);
      need(preview.length === 1 && preview[0].to === EMAIL('a') && preview[0].html.includes('/api/posts/cancel'), `post 4 preview emails: ${preview.length}`);
      await makeDue(p4.id);
      const pub = await cron('post-publisher');
      need(pub.data.published === 1 && la().posts.length === 4, `after post 4, "Google" has ${la().posts.length} posts`);
      const texts = new Set(la().posts.map((x) => x.summary));
      need(texts.size === 4, 'two posts had the same text');
      return `statuses as written: awaiting, ${statuses.join(', ')}; 4 posts on "Google"; post 4's preview captured (not sent) to the test address`;
    });
    await step('posts', 'the generator only writes for shops that asked for posts', async () => {
      const others = await db.from('scheduled_posts').select('id', { count: 'exact', head: true }).neq('profile_id', A().profileId);
      need((others.count || 0) === 0, `${others.count} posts were written for shops with posts switched off`);
      return 'B to E have posts off: 0 posts written for them';
    });

    // ════════ 6. New reviews: 4 to 5 stars and 1 to 3 stars ════════
    await step('replies', 'a new 5-star review is replied to; a new 2-star review gets a holding reply that waits', async () => {
      addReview(la(), 'rev-new-5', 'FIVE', 1, 'Fantastic fitters, on time and tidy.', 'Nina Newfive');
      addReview(la(), 'rev-new-2', 'TWO', 1, LOW_NEW, 'Ned Newlow');
      // A recent review the shop has already answered itself, on Google, before we ever saw it.
      addReview(la(), 'rev-owner-answered', 'FIVE', 1, 'Great service from start to finish.', 'Owen Ownerreplied', true);
      const ownersWords = la().reviews.find((x) => x.reviewId === 'rev-owner-answered')!.reviewReply!.comment;
      const onboardingReply = la().reviews.find((x) => x.reviewId === 'rev-5star')!.reviewReply!.comment;
      const sms0 = world.sms.length, em0 = world.emails.length, calls0 = world.modelCalls.length;
      const r = await cron('review-alerts');
      need(r.status === 200 && r.data.processed === 2, `processed ${r.data?.processed}: ${r.text.slice(0, 120)}`);
      const rev = (id: string) => la().reviews.find((x) => x.reviewId === id)!;
      need(rev('rev-new-5').reviewReply?.comment.includes('Nina'), 'the 5-star review was not replied to');
      need(!rev('rev-new-2').reviewReply, 'THE NEW 2-STAR REVIEW WAS REPLIED TO WITHOUT APPROVAL');
      need(!rev('rev-old-1star').reviewReply, 'the 60-day-old review was replied to');
      need(rev('rev-owner-answered').reviewReply!.comment === ownersWords, 'OUR REPLY REPLACED A REPLY THE SHOP WROTE ITSELF');
      need(rev('rev-5star').reviewReply!.comment === onboardingReply, 'the review answered at onboarding was answered a second time');
      const newCalls = world.modelCalls.slice(calls0);
      need(newCalls.length === 1 && !/LOWSTAR/.test(newCalls[0].user), `model calls for this run: ${newCalls.length}`);
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: A().cookie });
      need(dash.data.pendingReplies.length === 1 && dash.data.pendingReplies[0].reviewerName === 'Ned Newlow', 'the new holding reply is not on the dashboard');
      need(/^Thank you for your feedback, Ned\./.test(dash.data.pendingReplies[0].reply), 'not the fixed holding reply');
      const sms = world.sms.slice(sms0), em = world.emails.slice(em0);
      need(sms.every((s) => s.to === PHONE) && em.every((e) => e.to === EMAIL('a')), 'a message was addressed to someone other than the test shop');
      const second = await cron('review-alerts');
      need(second.data.processed === 0, `a second run processed ${second.data.processed} again`);
      return `5-star replied; 2-star waiting on the dashboard; old 1-star recorded, not replied; the shop's own reply left alone; the review answered at onboarding not answered twice; ${sms.length} texts and ${em.length} email captured (not sent), all to the test shop; a second run does nothing`;
    });

    // ════════ 7. A photo, with approval (flag on locally only) ════════
    process.env.SHOP_PHOTOS = 'on';
    let photoToken = '';
    await step('photos', 'upload by link: location data removed, stored privately, waiting for approval', async () => {
      const { makeJpeg, contains, GPS_MARKER, DEVICE_MARKER } = await mod('lib/image-test-fixtures.ts');
      const { remainingMetadata } = await mod('lib/image-metadata.ts');
      const link = await admin('admin/photos', { action: 'link', retailerId: A().retailerId });
      need(link.status === 200 && link.data.link.startsWith(`${ORIGIN}/photos/`), `link gave ${link.status}`);
      photoToken = link.data.link.split('/photos/')[1];
      const info = await call('photos/upload', 'GET', `/api/photos/upload?token=${photoToken}`);
      need(info.status === 200 && info.data.shop.name === A().name, `upload page lookup gave ${info.status}`);
      const wrong = await call('photos/upload', 'GET', `/api/photos/upload?token=${photoToken.slice(0, -2)}xx`);
      need(wrong.status === 404, 'a wrong link was accepted');

      const dirty: Uint8Array = makeJpeg({ orientation: 6, xmp: true, iptc: true, comment: true, minBytes: 30_000, trailing: Array.from(Buffer.from('MotionPhoto_Data')) });
      need(contains(dirty, GPS_MARKER), 'the test photo has no location in it to remove');
      const fd = new FormData(); fd.append('token', photoToken); fd.append('photo', new Blob([Buffer.from(dirty)], { type: 'image/jpeg' }), 'IMG_0001.jpg');
      const up = await call('photos/upload', 'POST', '/api/photos/upload', { formData: fd });
      need(up.status === 200 && up.data.ok, `upload gave ${up.status} ${up.text.slice(0, 160)}`);

      const notPhoto = new FormData(); notPhoto.append('token', photoToken); notPhoto.append('photo', new Blob([Buffer.from('%PDF-1.7 '.padEnd(30_000, 'x'))], { type: 'image/jpeg' }), 'really-a-pdf.jpg');
      const refused = await call('photos/upload', 'POST', '/api/photos/upload', { formData: notPhoto });
      need(refused.status === 400, `a PDF renamed .jpg got ${refused.status}`);

      const { data: rows } = await db.from('shop_photos').select('*').eq('retailer_id', A().retailerId);
      need(rows.length === 1 && rows[0].status === 'pending', `rows: ${rows.length}, status ${rows[0]?.status}`);
      need(rows[0].storage_path.startsWith(`${A().retailerId}/`) && !rows[0].storage_path.includes('IMG_0001'), 'the stored name used the uploaded file name');
      const { data: blob, error } = await db.storage.from('shop-photos').download(rows[0].storage_path);
      need(!error && blob, `could not read the stored file back: ${error?.message}`);
      const stored = new Uint8Array(await blob.arrayBuffer());
      need(!contains(stored, GPS_MARKER) && !contains(stored, DEVICE_MARKER) && !contains(stored, 'MotionPhoto') && !contains(stored, 'Acacia'), 'THE STORED FILE STILL CONTAINS METADATA');
      need(remainingMetadata(stored).length === 0, `metadata left: ${remainingMetadata(stored)}`);
      const publicTry = await realFetch(`https://${STAGING_HOST}/storage/v1/object/public/shop-photos/${rows[0].storage_path}`);
      need(publicTry.status >= 400, `the file is publicly readable without a signed address (${publicTry.status})`);
      return `stored ${stored.length} bytes (uploaded ${dirty.length}); GPS, device, XMP, IPTC and trailing data gone; not publicly readable (${publicTry.status}); PDF-as-JPEG refused`;
    });
    await step('photos', 'a photo waiting for approval is never attached to a post', async () => {
      await ageAllPosts('a');
      await cron('post-generator');
      const p5 = (await postsOf('a')).pop();
      need(p5.photo_id === null, 'a pending photo was attached to a post');
      await makeDue(p5.id); await cron('post-publisher');
      need(!la().posts[0].media, 'a post went out with a photo nobody approved');
      return 'post 5 went out as text';
    });
    await step('photos', 'once approved, the photo goes on the next post, by a short-lived private address', async () => {
      const list = await admin('admin/photos', { action: 'list', retailerId: A().retailerId });
      need(list.data.photos.length === 1 && list.data.listingEnabled === false, 'photo panel wrong');
      const photoId = list.data.photos[0].id;
      const ok = await admin('admin/photos', { action: 'approve', photoId });
      need(ok.status === 200, `approve gave ${ok.status}`);
      await ageAllPosts('a');
      await cron('post-generator');
      const p6 = (await postsOf('a')).pop();
      need(p6.photo_id === photoId, 'the approved photo was not attached');
      await makeDue(p6.id);
      const pub = await cron('post-publisher');
      const media = la().posts[0].media;
      need(pub.data.published === 1 && media?.[0]?.mediaFormat === 'PHOTO', 'the post reached "Google" without its photo');
      need(media[0].sourceUrl.startsWith(`https://${STAGING_HOST}/storage/v1/object/sign/shop-photos/`) && media[0].sourceUrl.includes('token='), 'the photo address is not a signed staging address');
      // What Google would do next: fetch that address, with no credentials.
      const fetched = await realFetch(media[0].sourceUrl);
      const bytes = new Uint8Array(await fetched.arrayBuffer());
      need(fetched.status === 200 && bytes[0] === 0xff && bytes[1] === 0xd8, `fetching the signed address gave ${fetched.status}`);
      const { data: log } = await db.from('change_log').select('after_value').eq('location_name', la().loc).eq('action', 'create_post').order('created_at', { ascending: false }).limit(1);
      need(log[0].after_value.photoId === photoId && !JSON.stringify(log[0]).includes('token='), 'the change log should record the photo id and never its address');
      const toListing = await admin('admin/photos', { action: 'to_listing', photoId });
      need(toListing.status === 403 && la().media.length === 0, `adding to the Google listing answered ${toListing.status} with its flag off`);
      return `post 6 carries the photo; the signed address is fetchable without credentials (${bytes.length} bytes, a JPEG); the change log holds the photo id only; "add to listing" refused (flag off)`;
    });
    await step('photos', 'with the flag off again, a post that has a photo goes out as text', async () => {
      await ageAllPosts('a');
      // Give the photo back its eligibility, then write a post that has it attached.
      await db.from('shop_photos').update({ last_used_at: null }).eq('retailer_id', A().retailerId);
      await cron('post-generator');
      const p7 = (await postsOf('a')).pop();
      need(p7.photo_id, 'post 7 should have a photo attached for this check');
      delete process.env.SHOP_PHOTOS;
      await makeDue(p7.id); await cron('post-publisher');
      const sent = la().posts[0];
      process.env.SHOP_PHOTOS = 'on';
      need(sent.summary === p7.content && !sent.media, 'a photo was published while the flag was off');
      return 'published as text';
    });

    // ════════ 8. The report, with corrected numbers, and before-and-after ════════
    await step('report', 'ad start date is set by an admin; a bad date is refused', async () => {
      const bad = await admin('admin/pilot', { action: 'set_ad_start', retailerId: A().retailerId, date: '16/11/2026' });
      const ok = await admin('admin/pilot', { action: 'set_ad_start', retailerId: A().retailerId, date: AD_START });
      need(bad.status === 400 && ok.status === 200, `bad ${bad.status}, good ${ok.status}`);
      return `ads started ${AD_START}`;
    });
    await step('report', 'the other connected shops have their history pulled too', async () => {
      const got: string[] = [];
      for (const k of ['b', 'c', 'd', 'e']) {
        if (!shops[k].profileId) { got.push(`${k.toUpperCase()}: no listing bound`); continue; }
        const r = await call('audit', 'POST', '/api/audit', { cookie: shops[k].cookie });
        got.push(`${k.toUpperCase()}: ${r.status}`);
      }
      // Pretend the last sync was two days ago, so the hourly job has something to do.
      await db.from('profiles').update({ metrics_synced_at: new Date(Date.now() - 2 * DAY).toISOString() }).in('id', ['a', 'b', 'c', 'd', 'e'].map((k) => shops[k].profileId).filter(Boolean));
      const sync = await cron('metrics-sync');
      need(sync.status === 200 && sync.data.failed === 0 && sync.data.synced >= 1, `metrics-sync: ${JSON.stringify(sync.data)}`);
      return `${got.join(', ')}; metrics-sync: ${JSON.stringify(sync.data).slice(0, 120)}`;
    });
    await step('report', 'the monthly report\'s figures equal what "Google" reported, not four times it', async () => {
      const em0 = world.emails.length;
      const r = await cron('monthly-report');
      need(r.status === 200, `monthly-report gave ${r.status} ${r.text.slice(0, 160)}`);
      const sent = world.emails.slice(em0);
      const mine = sent.filter((e) => e.to === EMAIL('a'));
      need(mine.length === 1, `shop A got ${mine.length} reports`);
      need(sent.every((e) => e.to.endsWith('@invalid.example')), 'a report was addressed outside the test addresses');
      // Work out last month's true totals from the same figures the fake Google served.
      const now = new Date();
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      const sum = (metrics: string[]) => { let t = 0; for (let d = first.getTime(); d <= last.getTime(); d += DAY) for (const m of metrics) t += metricValue(la(), m, iso(new Date(d))); return t; };
      const want = {
        calls: sum(['CALL_CLICKS']), website: sum(['WEBSITE_CLICKS']), directions: sum(['BUSINESS_DIRECTION_REQUESTS']),
        views: sum(Object.keys(PER_DAY).filter((m) => m.includes('IMPRESSIONS'))),
      };
      const html = mine[0].html;
      const has = (n: number) => html.includes(`>${n}<`) || html.includes(`>${n.toLocaleString('en-GB')}<`) || new RegExp(`\\b${n.toLocaleString('en-GB')}\\b`).test(html) || new RegExp(`\\b${n}\\b`).test(html);
      const missing = Object.entries(want).filter(([, n]) => !has(n));
      need(missing.length === 0, `the report does not show the true figure for: ${missing.map(([k, n]) => `${k} (${n})`).join(', ')}`);
      const fourTimes = Object.entries(want).filter(([, n]) => has(n * 4) && !has(n));
      need(fourTimes.length === 0, 'the report shows four times the true figure');
      return `shop A: views ${want.views}, calls ${want.calls}, website clicks ${want.website}, directions ${want.directions}: all match; ${sent.length} reports captured (not sent), all to test addresses`;
    });
    await step('report', 'the report is sent once: every listing is marked for the month, and a second run sends nothing', async () => {
      const { data: marks } = await db.from('profiles').select('id, monthly_report_sent_for').in('id', ['a', 'b', 'c', 'd', 'e'].map((k) => shops[k].profileId).filter(Boolean));
      const months = Array.from(new Set(marks.map((m: any) => m.monthly_report_sent_for)));
      need(marks.length === 5 && months.length === 1 && /^\d{4}-\d{2}$/.test(String(months[0])), `markers after the first run: ${JSON.stringify(months)}`);
      const em0 = world.emails.length;
      const again = await cron('monthly-report');
      need(again.data.sent === 0 && again.data.remaining === 0 && world.emails.length === em0, `a second run sent ${again.data.sent} (${world.emails.length - em0} emails)`);
      // The database refuses a malformed month, so a bug cannot write nonsense there.
      const bad = await db.from('profiles').update({ monthly_report_sent_for: 'October' }).eq('id', shops.b.profileId);
      need(bad.error, 'the database accepted a malformed month marker');
      return `all 5 marked ${months[0]}; second run: sent 0; a malformed marker is refused by the database`;
    });

    await step('before and after', 'the report shows "Change during your ads" against shops without ads', async () => {
      const html = world.emails.filter((e) => e.to === EMAIL('a')).pop()!.html;
      need(html.includes('Change during your ads'), 'the section is missing from the report of the shop with an ad date');
      const other = world.emails.filter((e) => e.to === EMAIL('d')).pop();
      need(other && !other.html.includes('Change during your ads'), 'a shop with no ad date was shown the section');
      const section = html.slice(html.indexOf('Change during your ads'), html.indexOf('Change during your ads') + 2600).replace(/<[^>]+>/g, ' ').replace(/&rarr;/g, '->').replace(/\s+/g, ' ');
      const comparedWith = /across (\d+) shops without ads/.exec(section)?.[1];
      // The fake doubles shop A's figures from the ad date, and leaves the others flat.
      need(/\+100%/.test(section), `expected +100% for the shop with ads; section reads: ${section.slice(0, 260)}`);
      need(comparedWith && Number(comparedWith) >= 3, `compared against ${comparedWith} shops; section reads: ${section.slice(0, 260)}`);
      return `shop A: +100% (the fake doubles its figures from the ad date); compared against ${comparedWith} shops without ads, which were flat; a shop with no ad date is not shown the section`;
    });

    // ════════ 9. The console and league, behind their flag ════════
    await step('console', 'with the flag on: sign-in by one-time link, per-shop view, league; no contact details', async () => {
      process.env.TARKETT_CONSOLE_ENABLED = 'on';
      // The league needs four full weeks since joining. Pretend the test accounts joined 40 days ago.
      await db.from('profiles').update({ created_at: new Date(Date.now() - 40 * DAY).toISOString() }).in('id', ['a', 'b', 'c', 'd', 'e'].map((k) => shops[k].profileId).filter(Boolean));
      const { data: tenant } = await db.from('tenants').select('id').eq('slug', 'stellar').single();
      const ins = await db.from('funder_users').insert({ tenant_id: tenant.id, email: FUNDER_EMAIL, name: `${TEST_PREFIX}Funder` });
      need(!ins.error, `could not add the test console user: ${ins.error?.message}`);
      const em0 = world.emails.length;
      const unknown = await call('console/login', 'POST', '/api/console/login', { body: { email: EMAIL('nobody') } });
      const login = await call('console/login', 'POST', '/api/console/login', { body: { email: FUNDER_EMAIL } });
      need(unknown.text === login.text, 'the console tells a stranger whether an address has access');
      const mail = world.emails.slice(em0);
      need(mail.length === 1 && mail[0].to === FUNDER_EMAIL, `sign-in emails captured: ${mail.length}`);
      const token = /verify\?token=([A-Za-z0-9_-]+)/.exec(mail[0].html)![1];
      const noSession = await call('console/data', 'GET', '/api/console/data');
      need(noSession.status === 401 || noSession.status === 403, `console data without signing in gave ${noSession.status}`);
      const page = await call('console/verify', 'GET', `/api/console/verify?token=${token}`);
      const used = await db.from('funder_login_tokens').select('used_at');
      need(page.status === 200 && used.data.every((t: any) => !t.used_at), 'opening the sign-in link used it up');
      const verified = await call('console/verify', 'POST', `/api/console/verify?token=${token}`);
      const cookie = (verified.res as any).cookies?.get?.('stellar_funder_session')?.value;
      need(verified.status === 303 && cookie, `verify gave ${verified.status}`);
      const reuse = await call('console/verify', 'POST', `/api/console/verify?token=${token}`);
      need(/Link not valid/.test(reuse.text), 'the sign-in link worked twice');
      const data = await call('console/data', 'GET', '/api/console/data', { cookie: `stellar_funder_session=${cookie}` });
      need(data.status === 200 && data.data.shops?.length === 7, `console data gave ${data.status} with ${data.data?.shops?.length} shops`);
      const by = (k: string) => data.data.shops.find((s: any) => s.retailerId === shops[k].retailerId);
      need(by('a').participating && by('a').postsLast30 >= 6, `shop A: participating ${by('a').participating}, posts ${by('a').postsLast30}`);
      need(by('g').participating === false && by('g').scoreAtActivation === null && by('g').actionsChange === null, 'a shop that has not joined has figures showing');
      need(!/@|07700|rev-|LOWSTAR|refresh/.test(data.text.replace(/"viewer":"[^"]*"/, '')), 'the console response contains contact details, review text or a credential');
      need(Array.isArray(data.data.league?.ranked) && Array.isArray(data.data.league?.excluded), 'no league in the response');
      need(data.data.league.ranked.length + data.data.league.excluded.length >= 5, 'the league does not account for every joined shop');
      need(data.data.league.ranked.length >= 4, `only ${data.data.league.ranked.length} shops were ranked; left out: ${JSON.stringify(data.data.league.excluded).slice(0, 300)}`);
      need(data.data.league.ranked[0].retailerId === shops.a.retailerId, 'the shop whose figures doubled is not top of the league');
      need(data.data.league.ranked.every((e: any) => !('calls' in e) && !/@/.test(JSON.stringify(e))), 'the league exposes raw figures or contact details');
      const sessionShop = await call('console/data', 'GET', '/api/console/data', { cookie: A().cookie });
      need(sessionShop.status === 401 || sessionShop.status === 403, 'a shop\'s own login opened the Tarkett console');
      return `7 shops; A: ${by('a').postsLast30} posts, ${by('a').repliesLast30} replies in 30 days, actions ${by('a').actionsChange}%; G (not joined): no figures; league: ${data.data.league.ranked.length} ranked (top: ${JSON.stringify(data.data.league.ranked[0] ?? null).replace(/"retailerId":"[^"]+",?/, '').slice(0, 170)}), ${data.data.league.excluded.length} left out (${Array.from(new Set(data.data.league.excluded.map((x: any) => x.reason))).join('; ').slice(0, 140)}); link is one-use; a shop login cannot open it`;
    });
    await step('console', 'with the flag off again, everything is a 404', async () => {
      delete process.env.TARKETT_CONSOLE_ENABLED;
      const data = await call('console/data', 'GET', '/api/console/data');
      need(data.status === 404, `console data gave ${data.status}`);
      return '404';
    });

    // ════════ 10. Undo ════════
    await step('revert', 'the revert script puts the listing back from the change log', async () => {
      const original = JSON.parse(la().original);
      need(la().posts.length === 7 && la().location.profile.description !== '', 'nothing to revert');
      const argv = process.argv, exit = process.exit;
      const lines: string[] = [];
      const log = console.log;
      console.log = (...a: any[]) => { lines.push(a.join(' ')); };
      let exited: any = null;
      (process as any).exit = (c: number) => { exited = c; };
      process.argv = ['node', 'revert', '--location', la().loc, '--since', iso(new Date(Date.now() - 2 * DAY)), '--confirm'];
      try {
        await mod('scripts/revert-listing-change.ts');
        // The script starts itself on import. Wait for it to work through the log.
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline && exited === null) {
          const { count } = await db.from('change_log').select('id', { count: 'exact', head: true }).eq('location_name', la().loc).neq('source', 'revert').is('reverted_at', null);
          const skips = lines.filter((l) => /SKIP|✗/.test(l)).length;
          if ((count || 0) <= skips && lines.some((l) => /✓/.test(l))) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } finally { console.log = log; process.argv = argv; (process as any).exit = exit; }
      need(exited === null, `the revert script stopped with an error (exit ${exited}): ${lines.slice(-3).join(' | ')}`);
      need(lines.some((l) => l.includes(STAGING_HOST)), 'the script did not say which database it was reading');
      const failedLines = lines.filter((l) => l.includes('✗'));
      need(failedLines.length === 0, `revert failures: ${failedLines.slice(0, 3).join(' | ')}`);
      need(la().posts.length === 0, `${la().posts.length} of our posts are still on "Google"`);
      for (const f of ['profile', 'serviceItems', 'categories', 'regularHours']) {
        need(canon(la().location[f]) === canon(original[f]), `"${f}" was not restored: now ${canon(la().location[f])?.slice(0, 160)}, was ${canon(original[f])?.slice(0, 160)}`);
      }
      const rev = (id: string) => la().reviews.find((x) => x.reviewId === id)!;
      need(!rev('rev-5star').reviewReply && !rev('rev-4star').reviewReply && !rev('rev-new-5').reviewReply, 'a reply we wrote automatically is still there');
      need(rev('rev-answered').reviewReply, 'a reply the shop wrote itself, before we arrived, was removed');
      need(rev('rev-owner-answered').reviewReply, 'a reply the shop wrote itself was removed');
      need(la().reviews.length === 8, 'a review itself was touched');
      const skipped = lines.filter((l) => /SKIP/.test(l));
      const stillThere = rev('rev-2star').reviewReply ? 'the holding reply the shop approved by hand is left in place and reported for a manual check' : 'the hand-approved holding reply was removed too';
      return `7 posts deleted; description, services, categories and hours back to what they were; our automatic replies removed; the shop's own replies and all 8 reviews untouched; ${skipped.length} skipped (${stillThere})`;
    });

    // ════════ 11. Leaving: account deletion, photo files, retention ════════
    await step('deletion', 'deleting the account deletes the shop\'s photo files from storage and cancels its upload link', async () => {
      const { data: before } = await db.storage.from('shop-photos').list(A().retailerId!, { limit: 100 });
      need(before.length === 1, `expected 1 stored photo before, found ${before.length}`);
      const del = await call('account/delete', 'DELETE', '/api/account/delete', { cookie: A().cookie });
      need(del.status === 200, `delete gave ${del.status}`);
      const { data: after } = await db.storage.from('shop-photos').list(A().retailerId!, { limit: 100 });
      const { count: rows } = await db.from('shop_photos').select('id', { count: 'exact', head: true }).eq('retailer_id', A().retailerId);
      const { data: u } = await db.from('users').select('id').eq('id', A().userId).maybeSingle();
      const r = await retailerRow('a');
      need(after.length === 0 && rows === 0, `${after.length} file(s) and ${rows} record(s) left behind`);
      need(!u && r && r.user_id === null && r.photo_link_hash === null, 'account or link not cleared as expected');
      const linkNow = await call('photos/upload', 'GET', `/api/photos/upload?token=${photoToken}`);
      need(linkNow.status === 404, 'the upload link still works after the account was deleted');
      const { count: logKept } = await db.from('change_log').select('id', { count: 'exact', head: true }).eq('location_name', la().loc);
      return `file gone from storage, photo record gone, upload link dead, account gone; the shop's record stays (as designed); ${logKept} change-log rows kept, with no user attached`;
    });
    await step('deletion', 'the retention job deletes a long-delisted, unclaimed TEST shop, and never a claimed one', async () => {
      const longAgo = new Date(Date.now() - 200 * DAY).toISOString();
      await db.from('retailers').update({ delisted_at: longAgo }).in('id', [shops.g.retailerId, shops.d.retailerId]); // G unclaimed, D claimed
      const dry = await cron('retailer-retention', '?dry=1');
      need(dry.data.deletable === 1 && dry.data.deleted === 0, `dry run: ${JSON.stringify(dry.data)}`);
      need(await retailerRow('g'), 'the dry run deleted something');
      const real = await cron('retailer-retention');
      need(real.data.deleted === 1 && !(await retailerRow('g')) && (await retailerRow('d')), `real run: ${JSON.stringify(real.data)}`);
      await db.from('retailers').update({ delisted_at: null }).eq('id', shops.d.retailerId);
      return `dry run: would delete 1, deleted 0; real run: deleted the unclaimed one, kept the claimed one; photo files checked first (${real.data.photoFilesDeleted} to delete)`;
    });

    // ════════ 12. Nothing left the building ════════
    await step('safety', 'no request went anywhere except staging and the fakes', async () => {
      need(world.blocked.length === 0, `blocked outbound requests: ${Array.from(new Set(world.blocked)).join(', ')}`);
      need(world.unhandledGoogle.length === 0, `the fake Google could not answer: ${Array.from(new Set(world.unhandledGoogle)).join(', ')}`);
      const outside = [...world.emails.map((e) => e.to), ...world.sms.map((s) => s.to)].filter((to) => !to.endsWith('@invalid.example') && to !== PHONE);
      need(outside.length === 0, `messages addressed outside the test data: ${outside.length}`);
      need(world.modelCalls.every((m) => !/LOWSTAR/.test(m.user)), 'a low-star review reached the model');
      return `${world.googleRequests} Google requests faked, ${world.modelCalls.length} model calls faked (model asked for: ${Array.from(new Set(world.modelCalls.map((m) => m.model))).join(', ')}), ${world.emails.length} emails and ${world.sms.length} texts captured and not sent, ${world.stagingRequests} requests to staging, 0 anywhere else`;
    });

    const failed = results.filter((r) => !r.ok);
    expect(failed.map((f) => `[${f.area}] ${f.name}: ${f.detail}`)).toEqual([]);
  }, 900_000);
});
