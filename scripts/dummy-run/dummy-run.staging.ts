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
/** Set by `run.py --clean`: delete labelled TEST data left by a killed run, and do nothing else. */
const CLEAN_ONLY = process.env.DUMMY_RUN_CLEAN_ONLY === '1';
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
interface Shop { key: string; name: string; retailerId?: string; inviteToken?: string; cookie?: string; userId?: string; profileId?: string; dest?: string; state?: string }
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
  persona('f', []);                                                                                       // a personal Google account that manages nothing
  persona('f2', [makeListing(6, shops.f.name, PID('f'))]);                                              // the right account for shop F
  persona('g', [makeListing(7, shops.g.name, PID('g'))]);                                               // shop G never completes: it is used for the refusals
}
const listingOf = (k: string) => world.personas[k].listings[0];

async function signIn(k: string, as: string = k): Promise<{ dest: string; cookie: string }> {
  const s = shops[k];
  need(s.inviteToken, `no invite link for shop ${k}`);
  const accepted = await call('invite/accept', 'POST', '/api/invite/accept', { form: { token: s.inviteToken } });
  need(accepted.status === 303 && accepted.location?.includes('/api/auth/callback/google?invite='), `invite accept gave ${accepted.status} ${accepted.location}`);
  const toGoogle = await call('auth/callback/google', 'GET', new URL(accepted.location!).pathname + new URL(accepted.location!).search);
  need(toGoogle.location?.startsWith('https://accounts.google.com/'), `expected a redirect to Google, got ${toGoogle.status} ${toGoogle.location}`);
  const g = new URL(toGoogle.location!);
  need(g.searchParams.get('redirect_uri') === `${ORIGIN}/api/auth/callback/google`, `redirect_uri was ${g.searchParams.get('redirect_uri')}`);
  const state = g.searchParams.get('state') || '';
  s.state = state;
  // "Google" sends the person back with a code.
  const back = await call('auth/callback/google', 'GET', `/api/auth/callback/google?code=code-${as}&state=${encodeURIComponent(state)}`);
  const dest = back.location ? new URL(back.location).pathname + new URL(back.location).search : '';
  const cookieValue = (back.res as any).cookies?.get?.('chocka_session')?.value;
  s.dest = dest;
  // Not connected: the shop is on a help page, and no account exists for it.
  if (dest.startsWith('/connect-help')) { s.cookie = undefined; s.userId = undefined; s.profileId = undefined; return { dest, cookie: '' }; }
  need(cookieValue, `no session cookie after sign-in (went to ${dest})`);
  s.cookie = `chocka_session=${cookieValue}`;
  const { data: u } = await db.from('users').select('id, tenant_id, google_refresh_token').eq('email', EMAIL(as)).single();
  need(u?.id, 'no user row after sign-in');
  need(!String(u.google_refresh_token).includes(`rt-${as}`), 'the Google credential was stored unencrypted');
  s.userId = u.id;
  const { data: p } = await db.from('profiles').select('id').eq('user_id', u.id).maybeSingle();
  s.profileId = p?.id;
  return { dest, cookie: s.cookie };
}

/** One step of applying changes to a listing: what the screen sends, one at a time. */
const fix = async (k: string, body: any) => {
  const r = await call('profile-fix', 'POST', '/api/profile-fix', { cookie: shops[k].cookie, body });
  need(r.status === 200, `profile-fix ${body.step} gave ${r.status} ${r.text.slice(0, 200)}`);
  return r.data;
};
const week = (open: Record<string, [string, string]>) => ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((day) => (open[day] ? { day, open: true, from: open[day][0], to: open[day][1] } : { day, open: false, from: '', to: '' }));
const adminList = async () => (await admin('admin/pilot', { action: 'list' })).data.retailers as any[];

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
    if (CLEAN_ONLY) return; // tidying up after a killed run: afterAll does the work
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
    await tryDo('live_months', () => db.from('live_months').delete().like('name', `${TEST_PREFIX}%`));
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
    if (CLEAN_ONLY) { notes.push('Clean-up only: no checks were run.'); return; }
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
      const { handsOffEnabled } = await mod('lib/automation-mode.ts');
      const { reviewAlertEmailsEnabled } = await mod('lib/review-alerts.ts');
      need(handsOffEnabled() === false && reviewAlertEmailsEnabled() === false, 'hands-off mode or the review alert emails are on');
      return 'console 404, photo upload 404, photo admin 403, preview email off, review alert emails off, hands-off mode off';
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

    await step('readiness', 'the launch check finds every database change in place, and never shows a secret', async () => {
      const r = await admin('admin/pilot', { action: 'readiness' });
      need(r.status === 200, `readiness gave ${r.status}`);
      // A rule that cannot be read back (no column) is listed for a person to confirm, never claimed as checked.
      const toConfirm = r.data.checks.database.filter((c: any) => String(c.key).startsWith('rule:'));
      need(toConfirm.length >= 1 && toConfirm.every((c: any) => c.ok === null && /Confirm migration/.test(c.detail)), `rules to confirm by hand: ${JSON.stringify(toConfirm).slice(0, 200)}`);
      const missing = r.data.checks.database.filter((c: any) => !String(c.key).startsWith('rule:') && c.ok !== true);
      need(missing.length === 0, `not in the staging database: ${missing.map((c: any) => c.detail).join(' | ')}`);
      for (const secret of [process.env.ADMIN_PASSWORD!, process.env.CRON_SECRET!, process.env.SESSION_SECRET!, process.env.SUPABASE_SERVICE_ROLE_KEY!, process.env.SECRET_ENCRYPTION_KEY!]) need(!r.text.includes(secret), 'THE READINESS CHECK PRINTED A SECRET');
      need(r.data.checks.settings.find((c: any) => c.key === 'WELCOME_EMAIL').detail.startsWith('Off'), 'the welcome email is not reported as off');
      return `${r.data.checks.database.length} database checks in place; ${r.data.toFix} setting(s) flagged for this throwaway setup; no secret in the answer`;
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
      need(dest === '/connected', `a connected shop should land on "You're connected", went to ${dest}`);
      const { data: u } = await db.from('users').select('onboarding_step, auto_post_enabled, auto_reply_enabled, phone_number').eq('id', shops[k].userId).single();
      need(u.onboarding_step === 'complete' && u.auto_post_enabled === false && u.auto_reply_enabled === false && !u.phone_number, 'connecting should finish setup with everything off and no mobile number asked for');
      return `${status}: "${r.connection_detail}"; sent to ${dest}; nothing switched on; no mobile number needed`;
    });
    await expectStatus('a', 'connected', 'manages the expected listing, so "connected"');
    await expectStatus('b', 'check_listing', 'manages a different listing, so "check listing" (flagged, and held until a person confirms)');
    await expectStatus('c', 'waiting_google', 'right listing but Google has not verified it, so "waiting on Google"');
    await expectStatus('e', 'connected', 'third connected shop');

    await step('welcome', 'no welcome email while it is switched off; with it on, one email, once', async () => {
      need(world.emails.length === 0, `${world.emails.length} email(s) were captured with the welcome email off`);
      process.env.WELCOME_EMAIL = 'on';
      try {
        await signIn('d');
        const mail = world.emails.filter((e) => e.to === EMAIL('d'));
        need(mail.length === 1 && /is connected to Stellar Local/.test(mail[0].subject), `expected one welcome email to shop D, captured ${mail.length}`);
        need(/Nothing has been changed on your Google listing/.test(mail[0].html) && !/£/.test(mail[0].html), 'the welcome email wording is not as expected');
        // Signing in again, as any returning shop does, must not send it twice.
        const back = await call('auth/callback/google', 'GET', `/api/auth/callback/google?code=code-d&state=${encodeURIComponent(JSON.stringify({ action: 'login', plan: 'monthly' }))}`);
        need(back.location?.endsWith('/dashboard'), `a returning connected shop went to ${back.location}`);
        need(world.emails.filter((e) => e.to === EMAIL('d')).length === 1, 'a second welcome email was captured');
        need((world.emails as any[]).length === 1, 'someone else got a welcome email');
      } finally { delete process.env.WELCOME_EMAIL; }
      const r = await retailerRow('d');
      need(r.connection_status === 'connected', `shop D is ${r.connection_status}`);
      return 'off: 0 emails for four connections; on: 1 to the shop that connected (captured, not sent); a second sign-in sends nothing';
    });

    await step('dead ends', 'the wrong Google account: no account is made, the shop is told why, and the same link then works with the right account', async () => {
      const first = await signIn('f');
      need(first.dest.startsWith('/connect-help?why=no_listing&invite='), `went to ${first.dest}`);
      const { data: none } = await db.from('users').select('id').eq('email', EMAIL('f')).maybeSingle();
      let r = await retailerRow('f');
      need(!none && r.user_id === null, 'an account was created for a Google account that manages no listing');
      need(r.connection_status === 'no_access' && r.connect_issue === 'no_listing', `recorded ${r.connection_status} / ${r.connect_issue}`);
      const row = (await adminList()).find((x) => x.id === shops.f.retailerId);
      need(row.help.label === 'Wrong Google account' && row.help.needsHelp && /Ask who set the shop up/.test(row.help.action), `needs-help row reads: ${JSON.stringify(row.help).slice(0, 200)}`);
      // The shop presses "Try a different Google account" and signs in with the right one.
      const second = await signIn('f', 'f2');
      r = await retailerRow('f');
      need(second.dest === '/connected' && r.user_id === shops.f.userId && r.connection_status === 'connected' && r.connect_issue === null, `second try went to ${second.dest}; status ${r.connection_status}, issue ${r.connect_issue}`);
      return 'first try: help page, nothing stored, reason recorded and shown to support; second try with the right account: connected';
    });

    await step('dead ends', 'pressing Cancel at Google, and leaving the box unticked, each lead to a help page that keeps the invite', async () => {
      const s = shops.g;
      const accepted = await call('invite/accept', 'POST', '/api/invite/accept', { form: { token: s.inviteToken! } });
      const toGoogle = await call('auth/callback/google', 'GET', new URL(accepted.location!).pathname + new URL(accepted.location!).search);
      const state = new URL(toGoogle.location!).searchParams.get('state') || '';
      const cancelled = await call('auth/callback/google', 'GET', `/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state)}`);
      need(cancelled.location?.includes('/connect-help?why=cancelled&invite='), `Cancel went to ${cancelled.location}`);
      let r = await retailerRow('g');
      need(r.connect_issue === 'cancelled' && r.connection_status === 'invited' && r.user_id === null, `after Cancel: ${r.connection_status} / ${r.connect_issue}`);
      // "Try again" on the help page goes back to Google with the invite still attached.
      const help = new URL(cancelled.location!);
      const retry = await call('auth/callback/google', 'GET', `/api/auth/callback/google?invite=${encodeURIComponent(help.searchParams.get('invite')!)}`);
      need(JSON.parse(new URL(retry.location!).searchParams.get('state') || '{}').invite, 'the retry from the help page lost the invite');
      // This time the box is left unticked.
      world.personas.g.scopeUnticked = true;
      const unticked = await call('auth/callback/google', 'GET', `/api/auth/callback/google?code=code-g&state=${encodeURIComponent(new URL(retry.location!).searchParams.get('state')!)}`);
      world.personas.g.scopeUnticked = false;
      need(unticked.location?.includes('/connect-help?why=unticked&invite='), `unticked box went to ${unticked.location}`);
      r = await retailerRow('g');
      const { data: none } = await db.from('users').select('id').eq('email', EMAIL('g')).maybeSingle();
      need(r.connect_issue === 'unticked' && !none, `after the unticked box: issue ${r.connect_issue}, account created: ${!!none}`);
      const row = (await adminList()).find((x) => x.id === shops.g.retailerId);
      need(row.help.label === 'Box not ticked' && row.state === 'invited', `needs-help row reads ${row.help.label} / ${row.state}`);
      const { data: inv } = await db.from('retailer_invites').select('status, accepted_at, user_id').eq('retailer_id', s.retailerId).single();
      need(inv.status === 'pending' && inv.accepted_at && !inv.user_id, 'the invite was used up by a refusal');
      return 'Cancel: help page, reason "cancelled"; unticked box: help page, reason "unticked"; no account either time; the link is still good; support sees which it was';
    });

    await step('dead ends', 'a connected shop that says "this is not my shop" can start again itself, with the same invitation', async () => {
      const before = await retailerRow('d');
      const oldUser = shops.d.userId;
      const peek = await call('connection/reset', 'GET', '/api/connection/reset', { cookie: shops.d.cookie });
      need(peek.status === 405 && (await retailerRow('d')).user_id === before.user_id, 'opening the address without pressing the button changed something');
      const nobody = await call('connection/reset', 'POST', '/api/connection/reset');
      need(nobody.location?.endsWith('/login'), `with nobody signed in it went to ${nobody.location}`);
      const reset = await call('connection/reset', 'POST', '/api/connection/reset', { cookie: shops.d.cookie });
      need(reset.status === 303 && reset.location?.includes('/api/auth/callback/google?invite='), `reset went to ${reset.status} ${reset.location}`);
      const r = await retailerRow('d');
      const { data: gone } = await db.from('users').select('id').eq('id', oldUser).maybeSingle();
      const { data: inv } = await db.from('retailer_invites').select('status, user_id').eq('retailer_id', shops.d.retailerId).single();
      need(!gone && r.user_id === null && r.listing_confirmed_at === null && inv.status === 'pending' && !inv.user_id, `after reset: account ${gone ? 'still there' : 'gone'}, shop linked: ${!!r.user_id}, invite ${inv.status}`);
      // Another shop's session cannot reset this one: the route only ever acts on the signed-in shop.
      const again = await signIn('d');
      need(again.dest === '/connected' && (await retailerRow('d')).connection_status === 'connected', `reconnecting went to ${again.dest}`);
      need(shops.d.userId !== oldUser, 'the old account was reused');
      return 'a button, not a link; removes only the signed-in shop\'s own account; the invitation works again; reconnected';
    });

    await step('visibility', 'opening an invite is recorded by the page\'s script, once, and says nothing about whether a link is real', async () => {
      const open = (token: string) => call('invite/opened', 'POST', '/api/invite/opened', { body: { token } });
      const real = await open(shops.g.inviteToken!), fake = await open('not-a-real-token-not-a-real-token');
      need(real.status === 204 && fake.status === 204, `opened gave ${real.status} / ${fake.status}`);
      const { data: a } = await db.from('retailer_invites').select('opened_at').eq('retailer_id', shops.g.retailerId).single();
      need(a.opened_at, 'opening was not recorded');
      await open(shops.g.inviteToken!);
      const { data: b } = await db.from('retailer_invites').select('opened_at').eq('retailer_id', shops.g.retailerId).single();
      need(b.opened_at === a.opened_at, 'a second open overwrote the first');
      return 'recorded once; a made-up link gets the same answer';
    });

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
      // A has connected the right, verified listing and switched nothing on: LIVE (billable), and flagged as quiet.
      need(by('a').state === 'live' && by('a').help.label === 'Nothing switched on' && by('a').help.needsHelp && by('a').help.buttons.length === 0, `A is ${by('a').state} / ${by('a').help.label}`);
      need(by('g').state === 'invited', `G is ${by('g').state}`);
      // The wrong listing and the unverified listing are connected, and are NOT live.
      need(by('b').state === 'connected_not_live' && by('b').help.label === 'Check listing' && by('b').help.buttons.includes('confirm_listing'), `B is ${by('b').state} / ${by('b').help.label}`);
      need(by('c').state === 'connected_not_live' && by('c').help.label === 'Waiting on Google', `C is ${by('c').state} / ${by('c').help.label}`);
      need(r.data.needsHelp >= 3, `needs-help count is ${r.data.needsHelp}`);
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
      need(!('defaultHours' in r.data) && !('predicted' in r.data), 'the audit still offers default hours or a predicted score');
      need(r.data.hours?.daysSet === 0 && r.data.hours.draft.every((d: any) => !d.open && !d.from), 'a listing with no hours should come back as an empty week, not a suggested one');
      need(!r.data.audit.fixes.some((f: any) => f.key === 'attributes') && r.data.manual.some((m: any) => m.key === 'photos'), 'the audit should not offer fixes we do not make, and should list them plainly instead');
      // Looking again must not move the score the shop joined with.
      const again = await call('audit', 'POST', '/api/audit', { cookie: A().cookie });
      need(again.data.scoreAtActivation === r.data.audit.score, 'the activation score changed on a second look');
      return `score ${r.data.audit.score}; no default hours, no predicted score; ${r.data.manual.length} gaps listed as "we do not do this"; ${days.length} days of history stored, from ${days[0].date} to ${days[days.length - 1].date}`;
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
    let drafts: any[] = [];
    await step('onboarding', 'suggestions are drafted in the shop\'s voice; every reply is drafted for the shop to read; none is for a low-star review', async () => {
      const r = await call('audit/previews', 'POST', '/api/audit/previews', { cookie: A().cookie });
      need(r.status === 200, `previews gave ${r.status} ${r.text.slice(0, 120)}`);
      previews = r.data.previews;
      need(previews.firstPost?.endsWith('Dummy and the team'), 'the post preview did not use the sign-off');
      need(previews.description.length <= 750, `the description is ${previews.description.length} characters; Google allows 750`);
      need(previews.reviewPreview?.totalUnreplied === 2 && previews.lowStarUnreplied === 2, `expected 2 good and 2 lower-rated reviews unanswered, got ${previews.reviewPreview?.totalUnreplied} and ${previews.lowStarUnreplied}`);
      const d = await call('onboarding/reply-drafts', 'POST', '/api/onboarding/reply-drafts', { cookie: A().cookie, body: { have: [] } });
      drafts = d.data.drafts;
      need(d.status === 200 && drafts.length === 2 && d.data.remaining === 0, `reply drafts: ${drafts?.length}, remaining ${d.data?.remaining}`);
      need(drafts.every((x: any) => x.rating >= 4 && x.text.endsWith('Dummy and the team')), 'a draft was for a low-star review, or did not use the sign-off');
      need(listingOf('a').reviews.every((x) => x.reviewId === 'rev-answered' || !x.reviewReply), 'drafting a reply posted it');
      return `2 reply drafts, both for 4 or 5 stars, nothing posted; description ${previews.description.length} characters`;
    });
    await step('onboarding', 'choices are saved; a mobile number is optional, checked, and can be removed', async () => {
      const bad = await call('account/delete', 'PATCH', '/api/account/delete', { cookie: A().cookie, body: { phone_number: '12345' } });
      const ok = await call('account/delete', 'PATCH', '/api/account/delete', { cookie: A().cookie, body: { phone_number: PHONE, auto_post_enabled: true, auto_reply_enabled: true } });
      need(bad.status === 400 && ok.status === 200, `bad number ${bad.status}, good number ${ok.status}`);
      const gone = await call('account/delete', 'PATCH', '/api/account/delete', { cookie: A().cookie, body: { phone_number: '' } });
      const { data: u } = await db.from('users').select('phone_number').eq('id', A().userId).single();
      need(gone.status === 200 && u.phone_number === null, 'the mobile number could not be removed');
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: A().cookie, body: { phone_number: PHONE } });
      return 'saved; removed; saved again for the later checks';
    });
    await step('live', 'a live shop stops being flagged as quiet once it has switched posts or replies on', async () => {
      const row = (await adminList()).find((x) => x.id === A().retailerId);
      need(row.state === 'live' && !row.help.needsHelp, `with posts and replies on, A is ${row.state} / ${row.help.label}`);
      need(row.working?.postsOn && row.working?.repliesOn && row.working.label === 'Ask me first (not chosen yet)', `how A works, as the admin page shows it: ${JSON.stringify(row.working)}`);
      return 'A was live and flagged "Nothing switched on"; with posts and replies on it is live and no longer flagged';
    });
    await step('hours', 'opening hours are never guessed: with nothing confirmed, nothing is written', async () => {
      for (const bad of [undefined, [], week({})]) {
        const r = await fix('a', { step: 'hours', hours: bad });
        need(r.result.ok === false, 'an empty week was accepted');
      }
      need(!la().location.regularHours, 'HOURS WERE WRITTEN THAT THE SHOP NEVER CONFIRMED');
      return 'empty and missing weeks refused; the listing still has no hours';
    });
    await step('onboarding', 'each change is applied on its own, checked on "Google", and only then reported as done', async () => {
      const smsBefore = world.sms.length, emailsBefore = world.emails.length;
      const hours = week({ MONDAY: ['09:00', '17:30'], TUESDAY: ['09:00', '17:30'], WEDNESDAY: ['09:00', '17:30'], THURSDAY: ['09:00', '17:30'], FRIDAY: ['09:00', '17:30'], SATURDAY: ['09:30', '16:00'] });
      const done: string[] = [];
      const one = async (body: any) => { const r = await fix('a', body); need(r.result.ok, `${body.step} was not done: ${r.result.message} ${r.result.detail || ''}`); done.push(body.step); return r.result; };
      await one({ step: 'description', text: previews.description });
      await one({ step: 'services', names: previews.services });
      await one({ step: 'categories', names: previews.categories });
      const h = await one({ step: 'hours', hours });
      need(/Monday 9:00 to 17:30/.test(h.message), `the hours result did not say what was written: ${h.message}`);
      // Replies go a few to a request, as the screen sends them; each has its own result.
      const batch = await fix('a', { step: 'replies', replies: [...drafts.map((d: any) => ({ reviewId: d.reviewId, text: d.text })), { reviewId: 'rev-2star', text: drafts[0].text }] });
      need(batch.results.length === 3 && batch.results.filter((x: any) => x.ok).length === 2 && batch.results[2].ok === false, `batched replies: ${JSON.stringify(batch.results.map((x: any) => [x.reviewId, x.ok]))}`);
      done.push('reply', 'reply');
      await one({ step: 'lowStar' });
      await one({ step: 'firstPost', text: previews.firstPost });
      // Sending a step twice must change nothing.
      const twice = await fix('a', { step: 'reply', reviewId: drafts[0].reviewId, text: drafts[0].text });
      need(twice.result.ok, 'repeating a reply step failed');

      need(la().location.profile?.description === previews.description, 'the description did not reach "Google"');
      need(la().location.regularHours.periods.length === 6 && canon(la().location.regularHours.periods[0]) === canon({ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17, minutes: 30 } }), 'the hours on "Google" are not the ones the shop confirmed');
      need(la().location.categories.primaryCategory.name === 'categories/gcid:flooring_store' && la().location.categories.additionalCategories.every((c: any) => /^categories\/gcid:/.test(c.name)), 'categories were not sent by Google\'s own ids, or the main category changed');
      need(la().location.serviceItems.every((x: any) => x.freeFormServiceItem.category === 'categories/gcid:flooring_store'), 'services were not attached to the listing\'s category by its id');
      const rev = (id: string) => la().reviews.find((x) => x.reviewId === id)!;
      need(rev('rev-5star').reviewReply && rev('rev-4star').reviewReply, 'a 4 or 5 star review did not get its reply');
      need(!rev('rev-2star').reviewReply && !rev('rev-old-1star').reviewReply, 'A LOW-STAR REVIEW GOT A REPLY WITHOUT APPROVAL');
      need(rev('rev-5star').reviewReply!.comment.endsWith('Dummy and the team'), 'the reply did not use the sign-off');
      const low = await fix('a', { step: 'reply', reviewId: 'rev-2star', text: 'Thank you for your review, we are glad you were pleased with the job.' });
      need(low.result.ok === false && !rev('rev-2star').reviewReply, 'A REPLY TO A LOW-STAR REVIEW WAS ACCEPTED');
      const { data: pending } = await db.from('review_replies').select('reply_content, status, reviews!inner(google_review_id, profile_id)').eq('reviews.profile_id', A().profileId).eq('status', 'pending');
      need(pending.length === 1 && pending[0].reviews.google_review_id === 'rev-2star', `expected one holding reply queued for the recent 2-star, found ${pending.length}`);
      need(/^Thank you for your feedback, Lena\./.test(pending[0].reply_content) && !/refund|fault|discount|compensat/i.test(pending[0].reply_content), 'the queued reply is not the fixed holding reply');
      const { data: old } = await db.from('reviews').select('id').eq('profile_id', A().profileId).eq('google_review_id', 'rev-old-1star');
      need(old.length === 0, 'the 60-day-old 1-star review was picked up (14-day rule)');
      need(world.sms.length === smsBefore && world.emails.length === emailsBefore, 'applying changes sent a message');
      const { data: recorded } = await db.from('reviews').select('google_review_id').eq('profile_id', A().profileId);
      const ids = (recorded || []).map((x: any) => x.google_review_id).sort();
      need(ids.includes('rev-5star') && ids.includes('rev-4star'), `the reviews replied to were not recorded (recorded: ${ids.join(', ') || 'none'}), so the daily check will treat them as new`);

      const fin = await fix('a', { step: 'finish' });
      const { data: prof } = await db.from('profiles').select('audit_score, audit_score_after').eq('id', A().profileId).single();
      need(fin.measured && fin.measured.score > auditA.audit.score, `the score after was ${fin.measured?.score}, before ${auditA.audit.score}`);
      need(prof.audit_score === auditA.audit.score && prof.audit_score_after === fin.measured.score, `stored scores: at activation ${prof.audit_score} (should be ${auditA.audit.score}), latest ${prof.audit_score_after} (should be ${fin.measured.score})`);
      return `${done.length} steps, each checked: ${Array.from(new Set(done)).join(', ')}; score ${auditA.audit.score} -> ${fin.measured.score}, measured from "Google"; replies on the 4 and 5 star only; 2-star: holding reply waiting; 60-day-old 1-star: left alone; 0 messages`;
    });
    await step('honesty', 'a change "Google" refuses is reported as not done, in plain words, and nothing claims otherwise', async () => {
      // The unverified listing: make "Google" refuse to change it, as it would.
      (listingOf('c') as any).refuseWrites = true;
      const r = await fix('c', { step: 'description', text: previews.description });
      (listingOf('c') as any).refuseWrites = false;
      need(r.result.ok === false && /would not let us/.test(r.result.message) && r.result.nextStep, `a refused change was reported as: ${JSON.stringify(r.result).slice(0, 200)}`);
      const { data: rows } = await db.from('change_log').select('status').eq('location_name', listingOf('c').loc);
      need(rows.length === 1 && rows[0].status === 'failed', 'the refused change was not recorded as failed');
      return `"${r.result.message}" ${r.result.nextStep.slice(0, 70)}…`;
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
    await step('posts', 'post 1 is the one the shop read and ticked: booked, published at its time, and cancellable until then', async () => {
      let posts = await postsOf('a');
      need(posts.length === 1 && posts[0].status === 'pending_approval' && posts[0].approved_at, `expected one booked post the shop approved by ticking it, got ${posts.map((p: any) => p.status)}`);
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: A().cookie });
      need(dash.data.postsToManage?.length === 1 && dash.data.postsToManage[0].waiting === false, 'the booked post is not on the dashboard with a way to stop it');
      await makeDue(posts[0].id);
      const pub = await cron('post-publisher');
      need(pub.data.published === 1 && la().posts.length === 1 && la().posts[0].summary === posts[0].content, `published ${pub.data.published}`);
      return 'booked with the wording the shop saw; shown on the dashboard; published when due';
    });
    await step('posts', 'posts 2 and 3 wait for the shop; they are approved from the dashboard (and by the old email link); nothing piles up', async () => {
      const manage = (body: any, cookie = A().cookie) => call('posts/manage', 'POST', '/api/posts/manage', { cookie, body });
      const statuses: string[] = [];
      // Post 2: approved from the dashboard, after changing its wording.
      await ageAllPosts('a');
      let gen = await cron('post-generator');
      need(gen.data.generated === 1, `post 2: generator made ${gen.data.generated}`);
      const p2 = (await postsOf('a')).pop();
      statuses.push(p2.status);
      need(p2.status === 'awaiting_approval', `post 2 was ${p2.status}`);
      await makeDue(p2.id);
      const early = await cron('post-publisher');
      need(early.data.published === 0 && la().posts.length === 1, 'AN UNAPPROVED POST WAS PUBLISHED');
      const previewsRun = await cron('post-previews');
      need(world.emails.filter((e) => /approve|waiting/i.test(e.subject)).length === 0, 'the preview email was sent while switched off');
      // While one is waiting, the weekly writer must not add another.
      await ageAllPosts('a');
      const pile = await cron('post-generator');
      need(pile.data.generated === 0 && (await postsOf('a')).filter((x: any) => x.status === 'awaiting_approval').length === 1, `a second post was written while one was still waiting (generated ${pile.data.generated})`);
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: A().cookie });
      need(dash.data.postsToManage?.some((x: any) => x.id === p2.id && x.waiting), 'the waiting post is not on the dashboard');
      const stranger = await manage({ id: p2.id, action: 'approve' }, shops.e.cookie);
      need(stranger.status === 404, `another shop could act on this post (${stranger.status})`);
      const badWords = await manage({ id: p2.id, action: 'approve', content: 'Carpets from £9 a metre this week only, pop in and see us in the showroom.' });
      need(badWords.status === 400, `wording with a price in it was accepted (${badWords.status})`);
      const newWords = 'New ranges are in the showroom this week. Pop in and have a look. Dummy and the team';
      const ok = await manage({ id: p2.id, action: 'approve', content: newWords });
      need(ok.status === 200 && ok.data.post.status === 'pending_approval' && ok.data.post.content === newWords, `dashboard approve gave ${ok.status} ${ok.text.slice(0, 120)}`);
      const twice = await manage({ id: p2.id, action: 'approve' });
      need(twice.status === 409, `approving twice gave ${twice.status}`);
      await makeDue(p2.id);
      let pub = await cron('post-publisher');
      need(pub.data.published === 1 && la().posts[0].summary === newWords, `post 2: published ${pub.data.published}`);
      // Post 3: skipped from the dashboard, then the next one approved by the email link, which still works.
      await ageAllPosts('a');
      gen = await cron('post-generator');
      const p3 = (await postsOf('a')).pop();
      need(gen.data.generated === 1 && p3.status === 'awaiting_approval', `post 3 was ${p3.status}`);
      const skip = await manage({ id: p3.id, action: 'skip' });
      need(skip.status === 200 && skip.data.post.status === 'cancelled', `skip gave ${skip.status}`);
      await ageAllPosts('a');
      gen = await cron('post-generator');
      const p3b = (await postsOf('a')).pop();
      statuses.push(p3b.status);
      need(gen.data.generated === 1 && p3b.status === 'awaiting_approval', `the post after a skipped one was ${p3b.status}`);
      await approvePost(p3b.id); await makeDue(p3b.id);
      pub = await cron('post-publisher');
      need(pub.data.published === 1, `post 3: published ${pub.data.published}`);
      // Post 4: three have been published, so this one does not wait, and gets the usual preview.
      await ageAllPosts('a');
      const emailsBefore = world.emails.length;
      gen = await cron('post-generator');
      const p4 = (await postsOf('a')).pop();
      statuses.push(p4.status);
      need(gen.data.generated === 1 && p4.status === 'pending_approval', `post 4 was ${p4.status}`);
      const preview = world.emails.slice(emailsBefore);
      need(preview.length === 1 && preview[0].to === EMAIL('a') && preview[0].html === '' && preview[0].text.includes('/api/posts/cancel') && /goes up on .* unless you stop it/.test(preview[0].text) && !/<[a-z]/i.test(preview[0].text), `post 4 preview emails: ${preview.length}`);
      await makeDue(p4.id);
      pub = await cron('post-publisher');
      need(pub.data.published === 1 && la().posts.length === 4, `after post 4, "Google" has ${la().posts.length} posts`);
      const texts = new Set(la().posts.map((x) => x.summary));
      need(texts.size === 4, 'two posts had the same text');
      return `statuses as written: ${statuses.join(', ')}; unapproved post not published; no second post written while one waited; another shop refused; a price in edited wording refused; approve, edit and skip all from the dashboard; 4 posts on "Google"; preview job with the email off: ${JSON.stringify(previewsRun.data).slice(0, 60)}`;
    });
    await step('posts', 'the generator only writes for shops that asked for posts', async () => {
      const others = await db.from('scheduled_posts').select('id', { count: 'exact', head: true }).neq('profile_id', A().profileId);
      need((others.count || 0) === 0, `${others.count} posts were written for shops with posts switched off`);
      return 'B to E have posts off: 0 posts written for them';
    });
    await step('held', 'a shop on a listing nobody has confirmed is held: no post is written for it until a person says "this is right"', async () => {
      // Shop A sits this one out, so the only post that could be written here is shop B's.
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.a.cookie, body: { auto_post_enabled: false } });
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.b.cookie, body: { auto_post_enabled: true } });
      const before = await cron('post-generator');
      need((await postsOf('b')).length === 0, `a post was written for a shop on an unconfirmed listing (generated ${before.data.generated})`);
      const ok = await admin('admin/pilot', { action: 'confirm_listing', retailerId: shops.b.retailerId });
      need(ok.status === 200, `confirm_listing gave ${ok.status}`);
      const row = (await adminList()).find((x) => x.id === shops.b.retailerId);
      need(row.state === 'live' && !row.help.needsHelp, `after "this is right", B is ${row.state}`);
      const after = await cron('post-generator');
      const posts = await postsOf('b');
      need(after.data.generated === 1 && posts.length === 1 && posts[0].status === 'awaiting_approval', `after confirming, generator made ${after.data.generated}; B has ${posts.map((x: any) => x.status)}`);
      // Tidy: B goes back to posts off, and its waiting post is skipped, so the later checks see what they expect.
      await call('posts/manage', 'POST', '/api/posts/manage', { cookie: shops.b.cookie, body: { id: posts[0].id, action: 'skip' } });
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.b.cookie, body: { auto_post_enabled: false } });
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.a.cookie, body: { auto_post_enabled: true } });
      return 'held while unconfirmed; live and written for once a person confirmed it; its first post waits for approval';
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
    await step('live', 'live does not depend on the switches: a shop with nothing on, or paused, is live and billable, and is flagged so it is not invisible', async () => {
      const row = async (k: string) => (await adminList()).find((x) => x.id === shops[k].retailerId);
      for (const k of ['b', 'd', 'e']) { const r = await row(k); need(r.state === 'live' && r.help.label === 'Nothing switched on' && r.help.needsHelp, `${k.toUpperCase()} with nothing on is ${r.state} / ${r.help.label}`); }
      // No admin action switches anything on for a shop. The shops do it themselves.
      for (const k of ['b', 'c', 'd', 'e']) {
        const r = await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops[k].cookie, body: { auto_reply_enabled: true } });
        need(r.status === 200, `shop ${k} could not switch replies on (${r.status})`);
      }
      for (const k of ['b', 'd', 'e']) { const r = await row(k); need(r.state === 'live' && !r.help.needsHelp, `${k.toUpperCase()} with replies on is ${r.state} / ${r.help.label}`); }
      // C has something on, but Google has not verified its listing: that does stop it being live.
      need((await row('c')).state === 'connected_not_live' && (await row('c')).help.label === 'Waiting on Google', `C is ${(await row('c')).help.label}`);
      // Pause: one tap, works with the hands-off switch off. The shop is still live: only disconnecting stops that.
      const paused = await call('automation-mode', 'POST', '/api/automation-mode', { cookie: shops.e.cookie, body: { paused: true } });
      need(paused.status === 200 && paused.data.paused === true, `pause gave ${paused.status} ${paused.text.slice(0, 120)}`);
      const p = await row('e');
      need(p.state === 'live' && p.help.label === 'Paused by the shop' && p.help.needsHelp && p.working.paused, `paused, E is ${p.state} / ${p.help.label}`);
      const resumed = await call('automation-mode', 'POST', '/api/automation-mode', { cookie: shops.e.cookie, body: { paused: false } });
      need(resumed.data.paused === false && !(await row('e')).help.needsHelp, 'after Resume, E is still flagged');
      // A few reviews from before the shops joined, so the network has a rating to add up later.
      addReview(listingOf('d'), 'rev-d-old-5', 'FIVE', 90, 'Great carpet, thank you.', 'Dora Oldfive', true);
      addReview(listingOf('d'), 'rev-d-old-4', 'FOUR', 80, 'Good job.', 'Dan Oldfour');
      addReview(listingOf('e'), 'rev-e-old-5', 'FIVE', 70, 'Lovely floor.', 'Eve Oldfive', true);
      addReview(listingOf('c'), 'rev-c-old-3', 'THREE', 75, 'LOWSTAR-MARKER-C it was all right in the end', 'Cal Oldthree');
      return 'B, D, E: live and flagged "Nothing switched on" until each switched replies on itself; C not live while "Waiting on Google"; paused E stays live and is flagged "Paused by the shop"';
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
      // Google finishes verifying shop C's listing. Nobody tells us: the daily check has to notice.
      listingOf('c').location.metadata.hasVoiceOfMerchant = true;
      const sync = await cron('metrics-sync');
      need(sync.status === 200 && sync.data.failed === 0 && sync.data.synced >= 1, `metrics-sync: ${JSON.stringify(sync.data)}`);
      need(sync.data.rechecked >= 5, `the daily connection check looked at ${sync.data.rechecked} shops`);
      const c = await retailerRow('c');
      need(c.connection_status === 'connected', `after Google verified it, shop C is still ${c.connection_status}`);
      const b = await retailerRow('b');
      need(b.connection_status === 'check_listing' && b.listing_confirmed_at, 'the daily check wiped a person\'s "this is right"');
      // The same run marks today's live shops for the monthly count; a second run the same day adds nothing.
      // A, B, D, E and F are connected to verified listings. F never switched anything on and is counted
      // all the same: what is switched on does not decide it. C is not verified yet at the start of this run.
      need(sync.data.liveCount?.live === 5 && sync.data.liveCount.marked === 5, `live count: ${JSON.stringify(sync.data.liveCount)}`);
      const monthNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(new Date());
      const { data: counted } = await db.from('live_months').select('retailer_id').eq('month', monthNow);
      const f = (await adminList()).find((x) => x.id === shops.f.retailerId);
      need((counted || []).some((m: any) => m.retailer_id === shops.f.retailerId) && f.state === 'live' && f.help.label === 'Nothing switched on' && f.help.needsHelp, `F, connected with nothing switched on, should be counted and flagged: ${f.state} / ${f.help.label}`);
      await db.from('profiles').update({ metrics_synced_at: new Date(Date.now() - 2 * DAY).toISOString() }).eq('id', shops.d.profileId);
      // The count is taken at the start of a run, so the next run picks up shop C,
      // which only became live during the first. After that, nobody is marked twice.
      const again = await cron('metrics-sync');
      need(again.data.liveCount?.marked === 1, `the next run should mark only shop C, newly live; it marked ${again.data.liveCount?.marked}`);
      const third = await cron('metrics-sync');
      need(third.data.liveCount?.marked === 0, `a further run the same day marked ${third.data.liveCount?.marked} again`);
      return `${got.join(', ')}; metrics-sync: ${JSON.stringify(sync.data).slice(0, 160)}; C went from "waiting on Google" to connected by itself; B's confirmation kept; a second run marks nobody twice`;
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

    await step('statement', 'the month\'s live shops are listed by name; the cap is money and the credit is worked out from settings, never from code', async () => {
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(new Date());
      // No statement at all until the term dates are set.
      const none = await admin('admin/pilot', { action: 'statement', month });
      need(none.status === 409 && none.data.notAvailable === true && /BILLING_TERM_START and BILLING_TERM_END/.test(none.data.error) && !none.data.statement, `with no term set the statement action gave ${none.status} ${none.text.slice(0, 160)}`);
      process.env.BILLING_TERM_START = iso(new Date(Date.now() - 500 * DAY));
      const half = await admin('admin/pilot', { action: 'statement', month });
      need(half.status === 409 && /BILLING_TERM_END is missing/.test(half.data.error), `with one date set: ${half.status} ${half.text.slice(0, 160)}`);
      process.env.BILLING_TERM_END = iso(new Date(Date.now() + 500 * DAY));
      const plain = await admin('admin/pilot', { action: 'statement', month });
      need(plain.status === 200 && plain.data.statement.money === null, `with no price set the statement should show counts only: ${plain.text.slice(0, 160)}`);
      const names: string[] = plain.data.statement.lines.map((l: any) => l.name);
      need(names.includes(shops.a.name) && names.includes(shops.b.name) && names.includes(shops.c.name) && !names.includes(shops.g.name), `live shops listed: ${names.join(', ')}`);
      need(plain.data.statement.provisional === true, 'the month in progress should be marked provisional');
      process.env.BILLING_PRICE_PENCE_PER_SHOP = '1000'; process.env.BILLING_MONTHLY_CAP_PENCE = '2500';
      try {
        // A term that ended last month: no cap, no credit line, and it says the term has ended.
        const lastMonthEnd = iso(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0)));
        process.env.BILLING_TERM_START = iso(new Date(Date.parse(lastMonthEnd) - 400 * DAY)); process.env.BILLING_TERM_END = lastMonthEnd;
        const ended = (await admin('admin/pilot', { action: 'statement', month })).data;
        need(ended.statement.cap.reason === 'after_term' && ended.statement.money.creditPence === 0 && ended.statement.shopsAboveCap === 0 && /the term ended on/.test(ended.csv), `after the term: ${JSON.stringify(ended.statement.cap)}`);
        // A term this month falls inside: the cap applies, as below.
        process.env.BILLING_TERM_START = iso(new Date(Date.now() - 500 * DAY)); process.env.BILLING_TERM_END = iso(new Date(Date.now() + 500 * DAY));
        const r = await admin('admin/pilot', { action: 'statement', month });
        need(r.data.statement.cap.applies === true && r.data.csv.includes('The cap applies for the term,'), `inside the term: ${JSON.stringify(r.data.statement.cap)}`);
        const st = r.data.statement, n = st.liveShops;
        need(n >= 3, `only ${n} shops counted`);
        need(st.money.grossPence === n * 1000 && st.money.totalPence === 2500 && st.money.creditPence === n * 1000 - 2500 && st.shopsAboveCap === n - 2, `cap of 25.00 with ${n} live: ${JSON.stringify(st.money)}, ${st.shopsAboveCap} above`);
        need(r.data.csv.includes(shops.a.name) && r.data.csv.includes('Monthly cap,25.00') && /Credit: above the monthly cap \(\d+ shops?\),-\d+\.00/.test(r.data.csv) && r.data.csv.includes('Total,25.00'), 'the spreadsheet does not show the cap, the credit line and the total');
        // A shop that was live earlier in the month and is not now is shown, and not counted.
        await db.from('live_months').update({ last_live_on: iso(new Date(Date.now() - 5 * DAY)) }).eq('month', month).eq('retailer_id', shops.e.retailerId);
        const after = (await admin('admin/pilot', { action: 'statement', month })).data.statement;
        need(after.liveShops === n - 1 && after.notCounted.some((l: any) => l.name === shops.e.name), `a shop not live now was still counted (${after.liveShops} of ${n})`);
        await db.from('live_months').update({ last_live_on: iso(new Date()) }).eq('month', month).eq('retailer_id', shops.e.retailerId);
        const ex = await admin('admin/pilot', { action: 'set_excluded', retailerId: shops.e.retailerId, excluded: true });
        need(ex.status === 200, `set_excluded gave ${ex.status}`);
        await admin('admin/pilot', { action: 'set_excluded', retailerId: shops.e.retailerId, excluded: false });
        return `${n} live shops by name; a cap in money: the excess is one credit line and the total adds up; a shop not live on the deciding day is listed and not counted; no statement is produced until both term dates are set; the cap is applied only inside its term, and not after it has ended; figures and dates here are made-up test settings`;
      } finally { delete process.env.BILLING_PRICE_PENCE_PER_SHOP; delete process.env.BILLING_MONTHLY_CAP_PENCE; delete process.env.BILLING_TERM_START; delete process.env.BILLING_TERM_END; }
    });

    await step('ad spend', 'spend is entered by an admin, checked, and never appears in anything the shop sees', async () => {
      const bad = await admin('admin/pilot', { action: 'set_ad_spend', retailerId: A().retailerId, spend: 'lots' });
      const ok = await admin('admin/pilot', { action: 'set_ad_spend', retailerId: A().retailerId, spend: '250.50' });
      const badEnd = await admin('admin/pilot', { action: 'set_ad_spend', retailerId: A().retailerId, spend: '250.50', endDate: '2020-01-01' });
      need(bad.status === 400 && ok.status === 200 && ok.data.updated.adSpendPence === 25050 && badEnd.status === 400, `bad ${bad.status}, good ${ok.status}, end before start ${badEnd.status}`);
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: A().cookie });
      need(!/25050|250\.50|ad_spend|adSpend/.test(dash.text), 'the shop\'s dashboard response contains the spend');
      need(world.emails.filter((e) => e.to === EMAIL('a')).every((e) => !/250\.50/.test(e.html)), 'an email to the shop contains the spend');
      return 'saved as pence; nonsense and an end date before the start refused; not in the shop\'s dashboard or emails';
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
      need(by('a').adSpend === '£250.50' && by('a').adChange?.label === 'Clear rise' && by('a').adChange.flag === false && !/\d/.test(by('a').adChange.detail.replace(/[+-]?\d+%/g, '')), `shop A ad columns: ${JSON.stringify({ s: by('a').adSpend, c: by('a').adChange })}`);
      need(by('d').adSpend === null && by('d').adChange === null, 'a shop with no ads has ad columns filled in');
      need(by('g').statusNote?.label === 'Box not ticked' && by('a').statusNote === null, `status notes: G ${JSON.stringify(by('g').statusNote)?.slice(0, 80)}, A ${by('a').statusNote}`);
      need(by('a').pilotState === 'live' && by('b').pilotState === 'live' && by('c').pilotState === 'live', `console states: A ${by('a').pilotState}, B ${by('b').pilotState}, C ${by('c').pilotState}`);
      need(by('a').participating && by('a').postsLast30 >= 6, `shop A: participating ${by('a').participating}, posts ${by('a').postsLast30}`);
      need(by('g').participating === false && by('g').scoreAtActivation === null && by('g').actionsChange === null, 'a shop that has not joined has figures showing');
      need(!/@|07700|rev-|LOWSTAR|refresh/.test(data.text.replace(/"viewer":"[^"]*"/, '').replace(/hello@stellarlocal\.co\.uk/g, '')), 'the console response contains contact details, review text or a credential');
      need(Array.isArray(data.data.league?.ranked) && Array.isArray(data.data.league?.excluded), 'no league in the response');
      need(data.data.league.ranked.length + data.data.league.excluded.length >= 5, 'the league does not account for every joined shop');
      need(data.data.league.ranked.length >= 4, `only ${data.data.league.ranked.length} shops were ranked; left out: ${JSON.stringify(data.data.league.excluded).slice(0, 300)}`);
      need(data.data.league.ranked[0].retailerId === shops.a.retailerId, 'the shop whose figures doubled is not top of the league');
      need(data.data.league.ranked.every((e: any) => !('calls' in e) && !/@/.test(JSON.stringify(e))), 'the league exposes raw figures or contact details');
      // The monthly summary: network totals and what the console already shows. Nothing new per shop.
      const sum = data.data.summary;
      need(sum && sum.shops.total === 7 && sum.shops.live === data.data.shops.filter((x: any) => x.pilotState === 'live').length, `summary shop counts: ${JSON.stringify(sum?.shops)}`);
      need(sum.totals.shopsCounted >= 3 ? sum.totals.lines.length === 4 && sum.totals.lines.every((l: any) => Number.isInteger(l.thisMonth)) : sum.totals.lines.length === 0, `summary totals from ${sum.totals.shopsCounted} shops: ${sum.totals.lines.length} lines (none are shown from fewer than three)`);
      need(sum.totals.shopsCompared <= sum.totals.shopsCounted && typeof sum.totals.note === 'string', `summary counted ${sum.totals.shopsCounted}, compared ${sum.totals.shopsCompared}`);
      need(sum.ads.shops.some((x: any) => x.name === shops.a.name && x.spend === '£250.50' && x.label === 'Clear rise'), 'the summary does not show shop A\'s ads');
      need(sum.notLive.total >= 1 && sum.notLive.byReason.every((r: any) => typeof r.label === 'string' && r.count > 0), 'the summary does not count shops needing help');
      need(sum.topMovers[0]?.name === shops.a.name && !('calls' in sum.topMovers[0]), 'top movers are wrong or expose raw figures');
      need(!/@/.test(JSON.stringify(sum)), 'the summary contains a contact detail');
      // Same weeks last year. The fake Google has 18 months of history for every listing, so every comparison uses it.
      need(by('a').adChange.detail.includes('against the same four weeks last year') && /measured the same way/.test(by('a').adChange.detail), `the ad view is not against last year: ${by('a').adChange.detail}`);
      need(data.data.league.ranked[0].actionsChange === 100 && data.data.league.ranked.slice(1).every((e: any) => e.actionsChange === 0 && e.band === 'Steady'), `league against last year: ${JSON.stringify(data.data.league.ranked.map((e: any) => e.actionsChange))}`);
      need(data.data.league.excluded.every((e: any) => !/before it joined/.test(e.reason)), 'a shop with last year\'s figures was put on the fallback');
      if (sum.totals.shopsCounted >= 3 && sum.totals.basis) need(sum.totals.basis === 'last_year' && /\d{4}$/.test(sum.totals.beforeLabel) && /time of year is not counted as a change/.test(sum.totals.note), `summary totals compared with ${sum.totals.basis} (${sum.totals.beforeLabel})`);
      // The network's rating and share answered: live shops only, from the daily note, never per shop.
      const liveKeys = ['a', 'b', 'c', 'd', 'e'].filter((k) => by(k).pilotState === 'live');
      const withReviews = liveKeys.map((k) => listingOf(k)).filter((l) => l.reviews.length > 0);
      const starsOf: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
      const allReviews = withReviews.flatMap((l) => l.reviews);
      const expectRating = Math.round((allReviews.reduce((t, r) => t + starsOf[r.starRating], 0) / allReviews.length) * 10) / 10;
      const expectShare = Math.round((allReviews.filter((r) => r.reviewReply).length / allReviews.length) * 100);
      need(withReviews.length >= 3, `only ${withReviews.length} live test shops have reviews`);
      need(Math.abs(sum.reviews.rating - expectRating) <= 0.1 && sum.reviews.totalReviews === allReviews.length && sum.reviews.shareAnswered === expectShare, `network reviews: ${JSON.stringify(sum.reviews)}; expected rating ${expectRating} from ${allReviews.length}, ${expectShare}% answered`);
      need(data.data.shops.every((x: any) => !Object.keys(x).some((key) => /review|rating/i.test(key))), 'a shop row in the console carries a review figure');
      const sessionShop = await call('console/data', 'GET', '/api/console/data', { cookie: A().cookie });
      need(sessionShop.status === 401 || sessionShop.status === 403, 'a shop\'s own login opened the Tarkett console');
      return `7 shops; A: ${by('a').postsLast30} posts, ${by('a').repliesLast30} replies in 30 days, actions ${by('a').actionsChange}%; G (not joined): no figures; league: ${data.data.league.ranked.length} ranked (top: ${JSON.stringify(data.data.league.ranked[0] ?? null).replace(/"retailerId":"[^"]+",?/, '').slice(0, 170)}), ${data.data.league.excluded.length} left out (${Array.from(new Set(data.data.league.excluded.map((x: any) => x.reason))).join('; ').slice(0, 140)}); link is one-use; a shop login cannot open it; everything compared with the same weeks last year; network rating ${sum.reviews.rating} from ${sum.reviews.totalReviews} reviews, ${sum.reviews.shareAnswered}% answered, from ${sum.reviews.ratedShops} live shops`;
    });
    await step('console', 'with the flag off again, everything is a 404', async () => {
      delete process.env.TARKETT_CONSOLE_ENABLED;
      const data = await call('console/data', 'GET', '/api/console/data');
      need(data.status === 404, `console data gave ${data.status}`);
      return '404';
    });

    // ════════ 9a. Hands-off mode, review alerts for every shop, the review card (all switched on locally only) ════════
    const mode = (k: string, body?: any) => call('automation-mode', body ? 'POST' : 'GET', '/api/automation-mode', { cookie: shops[k].cookie, ...(body ? { body } : {}) });
    const userRow = async (k: string) => (await db.from('users').select('auto_post_enabled, auto_reply_enabled, automation_mode, automation_mode_chosen_at, automation_consent_at, automation_consent_version, automation_paused_at').eq('id', shops[k].userId).single()).data;
    const dropReview = (k: string, id: string) => { const l = listingOf(k); l.reviews = l.reviews.filter((r) => r.reviewId !== id); };
    const LOW_HANDS = 'LOWSTAR-MARKER-HANDSOFF the carpet was the wrong colour';
    const LOW_HELD = 'LOWSTAR-MARKER-HELD nobody called me back';
    const LOW_ALERT = 'LOWSTAR-MARKER-ALERT two weeks late';

    await step('hands-off', 'while the switch is off the choice is not offered and cannot be made', async () => {
      const got = await mode('d');
      need(got.status === 200 && got.data.enabled === false && got.data.mode === 'ask_first', `with the switch off: ${got.text.slice(0, 160)}`);
      const tried = await mode('d', { mode: 'hands_off', wordingVersion: got.data.wordingVersion });
      const u = await userRow('d');
      need(tried.status === 404 && u.automation_mode === null && u.automation_consent_at === null && u.auto_post_enabled === false, `the choice was accepted with the switch off (${tried.status}, ${JSON.stringify(u)})`);
      return 'not offered; a hands-off choice is refused and nothing is recorded';
    });

    process.env.HANDS_OFF_MODE = 'on';
    let handsOffPostId = '';
    await step('hands-off', 'permission is not recorded while a forgeable sign-in cookie is still accepted', async () => {
      const got = await mode('d');
      const tried = await mode('d', { mode: 'hands_off', wordingVersion: got.data.wordingVersion });
      need(tried.status === 409 && (await userRow('d')).automation_mode === null, `with the old cookie still accepted, the choice gave ${tried.status}`);
      return 'refused until SESSION_ACCEPT_LEGACY_COOKIE=false';
    });
    process.env.SESSION_ACCEPT_LEGACY_COOKIE = 'false';
    await step('hands-off', 'the shop presses one of two buttons; the choice is recorded as its permission, with the time and the wording version; out-of-date wording is refused', async () => {
      const got = await mode('d');
      need(got.data.enabled && got.data.offeredFirst === 'hands_off' && got.data.chosen === false && got.data.mode === 'ask_first', `the choice as offered: ${got.text.slice(0, 200)}`);
      need(got.data.handsOff.button === 'Start hands-off' && got.data.askFirst.button === 'Ask me first' && got.data.handsOff.permission.includes('Stellar Local') && /until you tell us to stop/.test(got.data.handsOff.permission) && got.data.handsOff.points.some((x: string) => /Pause and Undo/.test(x)), 'the wording shown does not carry the permission, or pause and undo');
      // Offered first is not chosen: nothing has been switched on for the shop.
      const before = await userRow('d');
      need(before.automation_mode === null && before.auto_post_enabled === false, `hands-off was applied without the shop choosing it: ${JSON.stringify(before)}`);
      const stale = await mode('d', { mode: 'hands_off', wordingVersion: 'an-older-version' });
      need(stale.status === 409 && (await userRow('d')).automation_mode === null, `a choice against out-of-date wording gave ${stale.status}`);
      const noSession = await call('automation-mode', 'POST', '/api/automation-mode', { body: { mode: 'hands_off', wordingVersion: got.data.wordingVersion } });
      need(noSession.status === 401, `with no session the choice gave ${noSession.status}`);
      const t0 = Date.now();
      const chosen = await mode('d', { mode: 'hands_off', wordingVersion: got.data.wordingVersion });
      const u = await userRow('d');
      need(chosen.status === 200 && chosen.data.mode === 'hands_off' && chosen.data.held === false, `choosing hands-off gave ${chosen.status} ${chosen.text.slice(0, 160)}`);
      need(u.automation_mode === 'hands_off' && u.automation_consent_version === got.data.wordingVersion && Math.abs(Date.parse(u.automation_consent_at) - t0) < 60_000 && u.auto_post_enabled && u.auto_reply_enabled, `what was recorded: ${JSON.stringify(u)}`);
      const row = (await adminList()).find((x) => x.id === shops.d.retailerId);
      need(row.working.label === 'Hands-off' && row.working.permissionOn && row.working.wordingVersion === got.data.wordingVersion && row.state === 'live', `the admin page shows: ${JSON.stringify(row.working)}`);
      // The other shops are untouched: nobody else is in hands-off.
      for (const k of ['a', 'b', 'c', 'e']) need((await userRow(k)).automation_mode === null, `shop ${k} was put into a mode it did not choose`);
      return `two buttons, hands-off recommended, nothing chosen until one is pressed; recorded with the time and wording version ${u.automation_consent_version}; visible in /admin/pilot; nobody else changed`;
    });

    await step('hands-off', 'the weekly post is booked without waiting for approval, the shop is sent it first, and it goes up at its time', async () => {
      const em0 = world.emails.length;
      const gen = await cron('post-generator');
      const posts = await postsOf('d');
      need(posts.length === 1 && posts[0].status === 'pending_approval', `D's first post in hands-off: generated ${gen.data.generated}, ${posts.map((x: any) => x.status)}`);
      handsOffPostId = posts[0].id;
      const mail = world.emails.slice(em0).filter((e) => e.to === EMAIL('d'));
      need(mail.length === 1 && /Your Google post for this week/.test(mail[0].subject) && mail[0].html === '' && /posts\/cancel\?id=/.test(mail[0].text) && !/<[a-z]/i.test(mail[0].text), `the shop was not sent its post first, in plain text (${mail.map((e) => e.subject)})`);
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: shops.d.cookie });
      need(dash.data.postsToManage?.some((x: any) => x.id === handsOffPostId && !x.waiting), 'the booked post is not on the dashboard with a way to stop it');
      // Not before its time.
      const early = await cron('post-publisher');
      need(listingOf('d').posts.length === 0, `the post went up before its time (published ${early.data.published})`);
      await makeDue(handsOffPostId);
      const pub = await cron('post-publisher');
      need(pub.data.published >= 1 && listingOf('d').posts.length === 1, `at its time the post did not go up (published ${pub.data.published})`);
      return 'first post booked with no approval; emailed to the shop with a link to stop it; on the dashboard; published at its time';
    });

    await step('hands-off', 'a 1 to 3 star review gets the fixed holding reply at once and the shop is told; a 5-star review is answered; no low-star text reaches the model', async () => {
      addReview(listingOf('d'), 'rev-d-new-2', 'TWO', 0, LOW_HANDS, 'Lola Lowhands');
      addReview(listingOf('d'), 'rev-d-new-5', 'FIVE', 0, 'Really pleased with the new hall floor.', 'Fay Fivehands');
      const em0 = world.emails.length, calls0 = world.modelCalls.length;
      const r = await cron('review-alerts');
      const rev = (id: string) => listingOf('d').reviews.find((x) => x.reviewId === id)!;
      const { holdingReply } = await mod('lib/safe-automation.ts');
      need(rev('rev-d-new-2').reviewReply?.comment === holdingReply('Lola Lowhands'), `the low review's reply: ${rev('rev-d-new-2').reviewReply?.comment} (processed ${r.data?.processed})`);
      need(!!rev('rev-d-new-5').reviewReply, 'the 5-star review was not answered');
      need(!rev('rev-d-old-4').reviewReply, 'a review from before the shop joined was answered');
      const calls = world.modelCalls.slice(calls0);
      need(calls.length === 1 && !/LOWSTAR/.test(calls[0].user), `model calls: ${calls.length}`);
      const mail = world.emails.slice(em0).filter((e) => e.to === EMAIL('d'));
      need(mail.length === 1 && /we have replied for you/.test(mail[0].subject) && mail[0].html === '' && mail[0].text.includes('Thank you for your feedback, Lola.') && /undo it in Settings/.test(mail[0].text), `the shop was not told (${mail.map((e) => e.subject)})`);
      const { data: stored } = await db.from('review_replies').select('status, reply_content, reviews!inner(profile_id, google_review_id)').eq('reviews.profile_id', shops.d.profileId).eq('reviews.google_review_id', 'rev-d-new-2');
      need(stored?.length === 1 && stored[0].status === 'published', `the holding reply is recorded as ${stored?.map((x: any) => x.status)}`);
      const again = await cron('review-alerts');
      need(world.emails.slice(em0).filter((e) => e.to === EMAIL('d')).length === 1 && again.status === 200, 'a second run told the shop again');
      return 'holding reply posted (the fixed wording), shop told by email with how to undo it; 5-star answered; an old review left alone; one model call, none for the low review';
    });

    await step('hands-off', 'undo is one tap: the shop takes the holding reply back off Google from its list of changes', async () => {
      const mine = await call('changes', 'GET', '/api/changes', { cookie: shops.d.cookie });
      const change = mine.data.changes.find((c: any) => c.what === 'Reply to a review' && /Thank you for your feedback, Lola/.test(c.after) && c.canUndo);
      need(change, `the reply is not in the shop's list of changes with an Undo: ${mine.text.slice(0, 200)}`);
      const undone = await call('changes', 'POST', '/api/changes', { cookie: shops.d.cookie, body: { changeId: change.id } });
      need(undone.data.undo?.ok && !listingOf('d').reviews.find((x) => x.reviewId === 'rev-d-new-2')!.reviewReply, `undo: ${undone.text.slice(0, 160)}`);
      return 'the reply is listed with an Undo; pressing it removed the reply from "Google"';
    });

    await step('hands-off', 'a listing nobody has confirmed stays held, even in hands-off: no post, no reply', async () => {
      const { data: was } = await db.from('retailers').select('listing_confirmed_at').eq('id', shops.b.retailerId).single();
      try {
        await db.from('retailers').update({ listing_confirmed_at: null }).eq('id', shops.b.retailerId);
        const got = await mode('b');
        const chosen = await mode('b', { mode: 'hands_off', wordingVersion: got.data.wordingVersion });
        need(chosen.data.mode === 'hands_off' && chosen.data.held === true, `B chose hands-off on an unconfirmed listing: ${chosen.text.slice(0, 160)}`);
        addReview(listingOf('b'), 'rev-b-held-2', 'TWO', 0, LOW_HELD, 'Hal Held');
        const postsBefore = (await postsOf('b')).length;
        await cron('post-generator'); await cron('review-alerts');
        need((await postsOf('b')).length === postsBefore, 'A POST WAS WRITTEN FOR A HELD LISTING IN HANDS-OFF');
        need(!listingOf('b').reviews.find((x) => x.reviewId === 'rev-b-held-2')!.reviewReply, 'A REPLY WAS POSTED ON A HELD LISTING IN HANDS-OFF');
        const row = (await adminList()).find((x) => x.id === shops.b.retailerId);
        need(row.state === 'connected_not_live' && row.help.label === 'Check listing', `B in hands-off on an unconfirmed listing is ${row.state} / ${row.help.label}`);
      } finally {
        dropReview('b', 'rev-b-held-2');
        await mode('b', { mode: 'ask_first' });
        await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.b.cookie, body: { auto_post_enabled: false, auto_reply_enabled: true } });
        await db.from('retailers').update({ listing_confirmed_at: was!.listing_confirmed_at }).eq('id', shops.b.retailerId);
      }
      const b = await userRow('b');
      need(b.automation_mode === 'ask_first' && b.automation_consent_at, 'switching back lost the record of the earlier permission');
      return 'the shop is told nothing starts until its listing is checked; no post written, no reply posted; switching back keeps the record of what was agreed';
    });

    await step('hands-off', 'Pause is one tap: a booked post is dropped, nothing is written or replied to, and Resume starts it again', async () => {
      await ageAllPosts('d');
      await cron('post-generator');
      const booked = (await postsOf('d')).find((x: any) => x.status === 'pending_approval');
      need(booked, `no post was booked for D before pausing: ${(await postsOf('d')).map((x: any) => x.status)}`);
      const paused = await mode('d', { paused: true });
      need(paused.data.paused === true && paused.data.dropped >= 1, `pause: ${paused.text.slice(0, 160)}`);
      need((await db.from('scheduled_posts').select('status').eq('id', booked.id).single()).data.status === 'cancelled' && !(await postsOf('d')).some((x: any) => x.status === 'pending_approval'), 'a booked post was not dropped');
      const onGoogle = listingOf('d').posts.length;
      await ageAllPosts('d');
      addReview(listingOf('d'), 'rev-d-paused-1', 'ONE', 0, 'LOWSTAR-MARKER-PAUSED never again', 'Pat Paused');
      const count = (await postsOf('d')).length;
      await cron('post-generator'); await cron('post-publisher'); await cron('review-alerts');
      need((await postsOf('d')).length === count && listingOf('d').posts.length === onGoogle, 'A POST WAS WRITTEN OR PUBLISHED FOR A PAUSED SHOP');
      need(!listingOf('d').reviews.find((x) => x.reviewId === 'rev-d-paused-1')!.reviewReply, 'A REPLY WAS POSTED FOR A PAUSED SHOP');
      const row = (await adminList()).find((x) => x.id === shops.d.retailerId);
      need(row.working.paused && row.help.label === 'Paused by the shop' && row.state === 'live' && row.help.needsHelp, `paused, the admin page shows ${row.state} / ${row.help.label}`);
      dropReview('d', 'rev-d-paused-1');
      const resumed = await mode('d', { paused: false });
      need(resumed.data.paused === false && (await userRow('d')).automation_paused_at === null && !(await adminList()).find((x) => x.id === shops.d.retailerId).help.needsHelp, 'Resume did not clear the pause');
      return 'booked post dropped; nothing written, published or replied to while paused; still live, and flagged as paused; Resume clears it';
    });

    await step('hands-off', 'back to "Ask me first": the next post waits for approval again, and the record of the permission is kept', async () => {
      // A post booked under hands-off, still to come, when the shop changes its mind.
      await ageAllPosts('d');
      await cron('post-generator');
      const bookedByMode = (await postsOf('d')).find((x: any) => x.status === 'pending_approval');
      need(bookedByMode && !bookedByMode.approved_at, `no post booked under hands-off before switching back: ${(await postsOf('d')).map((x: any) => x.status)}`);
      const back = await mode('d', { mode: 'ask_first' });
      let u = await userRow('d');
      // Leaving hands-off turns off what it turned on, and the booked post waits for the shop again.
      need(back.data.mode === 'ask_first' && u.automation_mode === 'ask_first' && u.automation_consent_at && u.auto_post_enabled === false && u.auto_reply_enabled === false, `after switching back: ${JSON.stringify(u)}`);
      need((await db.from('scheduled_posts').select('status').eq('id', bookedByMode.id).single()).data.status === 'awaiting_approval', 'the post booked under hands-off was left to go up after the shop chose "ask me first"');
      await makeDue(bookedByMode.id);
      const onGoogle = listingOf('d').posts.length;
      await cron('post-publisher');
      need(listingOf('d').posts.length === onGoogle, 'A POST WENT UP AFTER THE SHOP CHOSE "ASK ME FIRST"');
      await call('posts/manage', 'POST', '/api/posts/manage', { cookie: shops.d.cookie, body: { id: bookedByMode.id, action: 'skip' } });
      need((await adminList()).find((x) => x.id === shops.d.retailerId).help.label === 'Nothing switched on', 'after leaving hands-off with nothing switched on, D is not flagged as quiet');
      // The shop then turns posts on itself, as any shop does.
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.d.cookie, body: { auto_post_enabled: true, auto_reply_enabled: true } });
      u = await userRow('d');
      await ageAllPosts('d');
      await db.from('scheduled_posts').update({ scheduled_for: new Date(Date.now() - 20 * DAY).toISOString() }).eq('profile_id', shops.d.profileId).eq('status', 'cancelled');
      const gen = await cron('post-generator');
      const latest = (await postsOf('d')).pop();
      need(latest.status === 'awaiting_approval', `in "ask me first" with one post published, D's next post is ${latest.status} (generator: ${JSON.stringify(gen.data)}; D's posts: ${(await postsOf('d')).map((x: any) => `${x.status}@${String(x.scheduled_for).slice(0, 10)}`).join(', ')}; D: ${JSON.stringify(u)})`);
      await call('posts/manage', 'POST', '/api/posts/manage', { cookie: shops.d.cookie, body: { id: latest.id, action: 'skip' } });
      return 'both switches go off; a post booked under hands-off goes back to waiting and does not go up; the shop is flagged "Nothing switched on" until it switches something on itself; its next post waits for approval; the earlier permission stays on record';
    });
    delete process.env.HANDS_OFF_MODE; delete process.env.SESSION_ACCEPT_LEGACY_COOKIE;

    await step('hands-off', 'switched off again, a stored choice has no effect', async () => {
      const got = await mode('d', { mode: 'hands_off', wordingVersion: 'x' });
      need(got.status === 404, `with the switch off again the choice gave ${got.status}`);
      await db.from('users').update({ automation_mode: 'hands_off' }).eq('id', shops.d.userId);
      const { isHandsOff, postNeedsApproval } = await mod('lib/automation-mode.ts');
      const u = await userRow('d');
      need(isHandsOff(u) === false && postNeedsApproval(u, 0, 3) === true, 'a stored hands-off choice still had an effect with the switch off');
      // The switches that choice turned on do not count either: not for posts, replies, or being live.
      need((await adminList()).find((x) => x.id === shops.d.retailerId).help.label === 'Nothing switched on', 'with hands-off switched off, a shop that only chose hands-off is not flagged as quiet');
      const before = (await postsOf('d')).length; await ageAllPosts('d'); await cron('post-generator');
      need((await postsOf('d')).length === before, 'a post was written on the strength of a hands-off choice that is switched off');
      await db.from('users').update({ automation_mode: 'ask_first' }).eq('id', shops.d.userId);
      return 'refused; a shop recorded as hands-off is treated as "ask me first", is flagged as having nothing switched on, and has nothing written for it';
    });

    await step('alerts', 'with the switch off, a shop with replies off hears nothing about a new review, as before', async () => {
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.e.cookie, body: { auto_reply_enabled: false, auto_post_enabled: true } });
      const recorded = async () => (await db.from('reviews').select('id', { count: 'exact', head: true }).eq('profile_id', shops.e.profileId)).count || 0;
      const before = await recorded();
      addReview(listingOf('e'), 'rev-e-before-5', 'FIVE', 1, 'Lovely new carpet in the lounge.', 'Bea Beforejoining');
      const em0 = world.emails.length;
      await cron('review-alerts');
      need(world.emails.slice(em0).every((e) => e.to !== EMAIL('e')) && (await recorded()) === before, `with the switch off, E got ${world.emails.slice(em0).filter((e) => e.to === EMAIL('e')).length} email(s) and ${(await recorded()) - before} new review(s) recorded`);
      return 'no email, and the shop is not even looked at';
    });

    process.env.REVIEW_ALERT_EMAILS = 'on';
    await step('alerts', 'with it on, a shop with replies OFF is told about a good review, and nothing is replied', async () => {
      const em0 = world.emails.length, calls0 = world.modelCalls.length;
      const recorded = async () => (await db.from('reviews').select('id', { count: 'exact', head: true }).eq('profile_id', shops.e.profileId)).count || 0;
      const before = await recorded();
      // As if E had only just joined: yesterday's review was left BEFORE it joined, so it is recorded and no email goes.
      const { data: was } = await db.from('profiles').select('created_at').eq('id', shops.e.profileId).single();
      await db.from('profiles').update({ created_at: new Date().toISOString() }).eq('id', shops.e.profileId);
      await cron('review-alerts');
      await db.from('profiles').update({ created_at: was!.created_at }).eq('id', shops.e.profileId);
      need((await recorded()) === before + 1 && world.emails.slice(em0).every((e) => e.to !== EMAIL('e')), `a review from before the shop joined: ${(await recorded()) - before} recorded, ${world.emails.slice(em0).filter((e) => e.to === EMAIL('e')).length} email(s)`);
      // A review left since it joined.
      addReview(listingOf('e'), 'rev-e-new-5', 'FIVE', 0, 'Brilliant job on the stairs.', 'Gail Goodnews');
      await cron('review-alerts');
      const mail = world.emails.slice(em0).filter((e) => e.to === EMAIL('e'));
      need(mail.length === 1 && /New 5-star review/.test(mail[0].subject) && mail[0].html === '' && mail[0].text.includes('Replies are switched off, so we have not replied.') && mail[0].text.includes('Gail Goodnews'), `E's email: ${mail.map((e) => e.subject)}`);
      need(!listingOf('e').reviews.find((x) => x.reviewId === 'rev-e-new-5')!.reviewReply && !listingOf('e').reviews.find((x) => x.reviewId === 'rev-e-before-5')!.reviewReply, 'A REPLY WAS POSTED FOR A SHOP WITH REPLIES OFF');
      need(world.modelCalls.length === calls0, 'a reply was written for a shop with replies off');
      const again = await cron('review-alerts');
      need(world.emails.slice(em0).filter((e) => e.to === EMAIL('e')).length === 1 && again.status === 200, 'a second run sent the email again');
      return 'a review left before the shop joined is recorded with no email; one left since: one email saying what it said and that nothing was replied; no reply on "Google"; no model call; a second run sends nothing';
    });

    await step('alerts', 'a low review at a shop with replies off: the holding reply is drafted for its approval and never posted', async () => {
      addReview(listingOf('e'), 'rev-e-new-2', 'TWO', 0, LOW_ALERT, 'Lou Lowalert');
      const em0 = world.emails.length, calls0 = world.modelCalls.length;
      await cron('review-alerts');
      const mail = world.emails.slice(em0).filter((e) => e.to === EMAIL('e'));
      need(mail.length === 1 && /needs your input/.test(mail[0].subject) && mail[0].html === '' && /We have NOT replied/.test(mail[0].text) && /action=approve/.test(mail[0].text), `E's email about the low review: ${mail.map((e) => e.subject)}`);
      need(!listingOf('e').reviews.find((x) => x.reviewId === 'rev-e-new-2')!.reviewReply, 'A HOLDING REPLY WAS POSTED WITHOUT APPROVAL');
      need(world.modelCalls.length === calls0, 'the model was called for a low review');
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: shops.e.cookie });
      need(dash.data.pendingReplies.length === 1 && /^Thank you for your feedback, Lou\./.test(dash.data.pendingReplies[0].reply), 'the drafted holding reply is not waiting on the dashboard');
      return 'drafted and waiting on the dashboard; the shop emailed to approve it or handle it; nothing posted; no model call';
    });

    await step('alerts', 'a shop with replies on is told what we replied to a good review; only reviews since joining raise an email', async () => {
      addReview(la(), 'rev-a-alert-5', 'FIVE', 0, 'Superb service again.', 'Abe Alertfive');
      const em0 = world.emails.length;
      await cron('review-alerts');
      const mine = world.emails.slice(em0).filter((e) => e.to === EMAIL('a'));
      need(mine.length === 1 && /New 5-star review/.test(mine[0].subject) && mine[0].html === '' && mine[0].text.includes('We replied for you:') && la().reviews.find((x) => x.reviewId === 'rev-a-alert-5')!.reviewReply, `A's email: ${mine.map((e) => e.subject)}`);
      need(world.emails.slice(em0).every((e) => [EMAIL('a')].includes(e.to)), `other shops were emailed: ${world.emails.slice(em0).map((e) => e.to)}`);
      return 'the email shows the review and the reply we posted; no other shop was emailed';
    });
    delete process.env.REVIEW_ALERT_EMAILS;
    await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.e.cookie, body: { auto_reply_enabled: true, auto_post_enabled: false } });

    await step('alerts', 'the preview email for a post waiting for approval: nothing while off; once, with approve and skip links, when on', async () => {
      // Shop E asks for posts; its first one waits for approval.
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.e.cookie, body: { auto_post_enabled: true } });
      await cron('post-generator');
      const waiting = (await postsOf('e')).find((x: any) => x.status === 'awaiting_approval');
      need(waiting, `E has no post waiting: ${(await postsOf('e')).map((x: any) => x.status)}`);
      await db.from('scheduled_posts').update({ scheduled_for: new Date(Date.now() + 6 * 3_600_000).toISOString() }).eq('id', waiting.id);
      const em0 = world.emails.length;
      const off = await cron('post-previews');
      need(off.data.enabled === false && off.data.sent === 0 && world.emails.length === em0, `with the switch off: ${JSON.stringify(off.data)}`);
      process.env.EARLY_POST_PREVIEW_EMAILS = 'on';
      try {
        const on = await cron('post-previews');
        const mail = world.emails.slice(em0).filter((e) => e.to === EMAIL('e'));
        need(on.data.sent >= 1 && mail.length === 1 && /Approve your Google post/.test(mail[0].subject) && mail[0].html === '' && /action=approve/.test(mail[0].text) && /action=skip/.test(mail[0].text) && /If you do nothing, nothing is posted/.test(mail[0].text) && !/<[a-z]/i.test(mail[0].text), `with it on: ${JSON.stringify(on.data)}, ${mail.map((e) => e.subject)}`);
        const twice = await cron('post-previews');
        need(world.emails.slice(em0).filter((e) => e.to === EMAIL('e')).length === 1 && twice.status === 200, 'the preview email was sent twice');
        need((await db.from('scheduled_posts').select('status').eq('id', waiting.id).single()).data.status === 'awaiting_approval', 'sending the preview changed the post');
      } finally { delete process.env.EARLY_POST_PREVIEW_EMAILS; }
      await call('posts/manage', 'POST', '/api/posts/manage', { cookie: shops.e.cookie, body: { id: waiting.id, action: 'skip' } });
      await call('account/delete', 'PATCH', '/api/account/delete', { cookie: shops.e.cookie, body: { auto_post_enabled: false } });
      return 'off: nothing sent. On: one email with approve and skip links, sent once, and the post still waits';
    });

    await step('alerts', 'the admin page can show each switched-off email with made-up content, and that sends nothing', async () => {
      const em0 = world.emails.length;
      const list = await admin('admin/pilot', { action: 'preview_email' });
      const { EMAIL_PREVIEWS } = await mod('lib/email-previews.ts');
      need(list.data.previews?.length === EMAIL_PREVIEWS.length && list.data.previews.length >= 5, `previews listed: ${list.text.slice(0, 120)}`);
      for (const p of list.data.previews) {
        const one = await admin('admin/pilot', { action: 'preview_email', key: p.key });
        need(one.status === 200 && one.data.subject && one.data.text.includes('Example') && !/invalid\.example|ZZ-TEST|<[a-z]/i.test(one.data.text), `sample ${p.key}: ${one.status}`);
      }
      need(world.emails.length === em0, 'reading a sample sent an email');
      return `${list.data.previews.length} samples, all made-up content, nothing sent`;
    });

    await step('operator rows', 'an account made through an operator account starts with posts and replies off, whatever the insert says; an ordinary account is untouched', async () => {
      const { randomUUID } = await import('node:crypto');
      const { data: tenant } = await db.from('tenants').select('id').eq('slug', 'stellar').single();
      const make = async (key: string, extra: Record<string, unknown>) => {
        const id = randomUUID();
        const ins = await db.from('users').insert({ id, email: EMAIL(key), name: `${TEST_PREFIX}Managed ${key}`, referral_code: `zz${id.slice(0, 8)}`, tenant_id: tenant.id, ...extra }).select('auto_post_enabled, auto_reply_enabled').single();
        need(!ins.error, `could not insert the test account ${key}: ${ins.error?.message}`);
        return { id, row: ins.data };
      };
      // Left to the database's defaults (which are "on"): the rule sets both off.
      const byDefault = await make('managed-default', { managed_by_user_id: A().userId });
      need(byDefault.row.auto_post_enabled === false && byDefault.row.auto_reply_enabled === false, `a managed account left to the defaults came out ${JSON.stringify(byDefault.row)}`);
      // Even if the insert asks for them on.
      const askedOn = await make('managed-on', { managed_by_user_id: A().userId, auto_post_enabled: true, auto_reply_enabled: true });
      need(askedOn.row.auto_post_enabled === false && askedOn.row.auto_reply_enabled === false, `a managed account inserted with both on came out ${JSON.stringify(askedOn.row)}`);
      // An account that is not managed keeps the defaults: the other brand relies on them.
      const ordinary = await make('ordinary', {});
      need(ordinary.row.auto_post_enabled === true && ordinary.row.auto_reply_enabled === true, `an ordinary account's defaults changed: ${JSON.stringify(ordinary.row)}`);
      // After that it is the account's own to change: the rule is for the insert only.
      const later = await db.from('users').update({ auto_reply_enabled: true }).eq('id', byDefault.id).select('auto_reply_enabled').single();
      need(later.data?.auto_reply_enabled === true, 'a managed account could not switch replies on afterwards');
      // And no notice would be addressed to it: the address on it is not known to be the shop's own.
      const { shopContactEmail } = await mod('lib/shop-notices.ts');
      need(shopContactEmail({ email: EMAIL('managed-default'), managed_by_user_id: A().userId }) === null && shopContactEmail({ email: EMAIL('a') }) === EMAIL('a'), 'the notice address rule is wrong');
      await db.from('users').delete().in('id', [byDefault.id, askedOn.id, ordinary.id]);
      return 'managed account: both switches off on insert, by default and when asked for on; ordinary account unchanged; can be switched on afterwards; never sent a notice';
    });

    await step('review card', 'a print-ready A6 PDF per shop at its signed address, and one file of every connected shop; names, towns and public links only', async () => {
      const { reviewCardSignature } = await mod('lib/review-link.ts');
      const cardRoute = await mod('app/api/review-card/[retailerId]/route.ts');
      const get = async (id: string, k?: string) => cardRoute.GET(request(`/api/review-card/${id}${k ? `?k=${k}` : ''}`), { params: { retailerId: id } }) as Promise<Response>;
      const res = await get(A().retailerId!, reviewCardSignature(A().retailerId!));
      const pdf = Buffer.from(await res.arrayBuffer());
      need(res.status === 200 && res.headers.get('content-type') === 'application/pdf' && pdf.subarray(0, 8).toString('latin1') === '%PDF-1.4' && pdf.toString('latin1').endsWith('%%EOF\n'), `A's card: ${res.status} ${res.headers.get('content-type')}`);
      need(/\/BaseFont \/Lato-Regular/.test(pdf.toString('latin1')) && /\/BaseFont \/Lato-Bold/.test(pdf.toString('latin1')) && (pdf.toString('latin1').match(/\/FontFile2 \d+ 0 R/g) || []).length === 2 && !/Helvetica/.test(pdf.toString('latin1')), 'the card does not embed Lato Regular and Bold');
      need((pdf.toString('latin1').match(/\/Type \/Page \/Parent/g) || []).length === 1 && /\/TrimBox \[8\.5 8\.5 306\.14 428\.03\]/.test(pdf.toString('latin1')), 'the card is not one A6 page with its trim marked');
      need((await get(A().retailerId!)).status === 404 && (await get(A().retailerId!, 'f'.repeat(32))).status === 404, 'the card was given out without its signature');
      const bulk = await admin('admin/pilot', { action: 'review_cards' });
      const connected = (await adminList()).filter((x) => x.review?.source === 'connected').length;
      need(connected >= 5, `only ${connected} test shops have a connected listing`);
      need(bulk.status === 200 && bulk.data.cards === connected && bulk.data.unchecked === 0, `bulk file: ${bulk.data?.cards} cards for ${connected} connected shops`);
      need(bulk.data.leftOut.notConnected.includes(shops.g.name), `G (not connected) should be left out: ${JSON.stringify(bulk.data.leftOut)}`);
      const all = Buffer.from(bulk.data.pdfBase64, 'base64').toString('latin1');
      need((all.match(/\/Type \/Page \/Parent/g) || []).length === connected && all.startsWith('%PDF-1.4'), 'the bulk file is not one page per connected shop');
      const withUnchecked = await admin('admin/pilot', { action: 'review_cards', includeUnchecked: true });
      need(withUnchecked.data.cards === connected + 1 && withUnchecked.data.unchecked === 1, `including shops not yet connected: ${withUnchecked.data.cards} cards, ${withUnchecked.data.unchecked} unchecked`);
      const noAuth = await call('admin/pilot', 'POST', '/api/admin/pilot', { body: { action: 'review_cards' } });
      need(noAuth.status === 401, `the bulk file without the admin password gave ${noAuth.status}`);
      // Nothing about a customer or a contact can be in it: the loader reads only the name, town and listing id.
      need(!/@|07700/.test(JSON.stringify({ ...bulk.data, pdfBase64: '' })), 'the bulk response carries a contact detail');
      return `one A6 page with trim and bleed for shop A, set in embedded Lato; refused without the signature; bulk file of ${connected} connected shops, one page each, G left out unless asked for; admin password needed`;
    });

    // ════════ 9b. Google access lost; hours, holiday hours and website from Settings; undo ════════
    await step('unknown listing', 'a shop we hold no expected listing for is "Check listing" until a person confirms it, and stays confirmed', async () => {
      const due = () => db.from('profiles').update({ metrics_synced_at: new Date(Date.now() - 2 * DAY).toISOString() }).eq('id', shops.c.profileId);
      const rowC = async () => (await adminList()).find((x) => x.id === shops.c.retailerId);
      const { data: was } = await db.from('retailers').select('place_id, listing_confirmed_at').eq('id', shops.c.retailerId).single();
      try {
        await db.from('retailers').update({ place_id: null, listing_confirmed_at: null }).eq('id', shops.c.retailerId);
        await due(); await cron('metrics-sync');
        let row = await rowC();
        need(row.connection?.status === 'check_listing' && row.state === 'connected_not_live' && row.help.needsHelp, `with no expected listing, C is ${row.connection?.status} / ${row.state}`);
        const ok = await admin('admin/pilot', { action: 'confirm_listing', retailerId: shops.c.retailerId });
        need(ok.status === 200, `confirm_listing gave ${ok.status}`);
        need((await rowC()).state === 'live', 'a person confirmed it and it is still not live');
        await due(); await cron('metrics-sync');
        row = await rowC();
        need(row.state === 'live' && !row.help.needsHelp, `the next daily check undid the confirmation: ${row.state}`);
      } finally {
        await db.from('retailers').update({ place_id: was!.place_id, listing_confirmed_at: was!.listing_confirmed_at }).eq('id', shops.c.retailerId);
        await due(); await cron('metrics-sync');
      }
      const back = await rowC();
      need(back.connection?.status === 'connected' && back.state === 'live', `after putting the expected listing back, C is ${back.connection?.status} / ${back.state}`);
      return 'not live and under Needs help until confirmed; live once a person says "this is right"; the next daily check leaves that alone';
    });

    await step('lost access', 'when Google withdraws our permission, the daily check notices, the shop is told, and support sees it', async () => {
      world.personas.e.tokenRevoked = true;
      await db.from('profiles').update({ metrics_synced_at: new Date(Date.now() - 2 * DAY).toISOString() }).eq('id', shops.e.profileId);
      const sync = await cron('metrics-sync');
      need(sync.data.lostAccess === 1, `the daily check reported ${sync.data.lostAccess} lost connections`);
      const { data: u } = await db.from('users').select('token_status, token_invalid_at').eq('id', shops.e.userId).single();
      need(u.token_status === 'invalid' && u.token_invalid_at, `shop E's access is recorded as ${u.token_status}`);
      const dash = await call('dashboard', 'GET', '/api/dashboard', { cookie: shops.e.cookie });
      need(dash.data.lostAccess?.title && /Reconnect/.test(dash.data.lostAccess.nextStep), 'the shop\'s dashboard does not say the connection is lost');
      const row = (await adminList()).find((x) => x.id === shops.e.retailerId);
      need(row.state === 'connected_not_live' && row.help.label === 'Connection lost' && !/token|credential/i.test(`${row.help.why} ${row.help.action}`), `support sees: ${JSON.stringify(row.help).slice(0, 200)}`);
      // A busy Google must NOT be mistaken for this.
      const { GoogleAuthError, isDeadGrant } = await mod('lib/google.ts');
      need(isDeadGrant(new GoogleAuthError('Token refresh failed: busy', 429, false)) === false, 'a busy Google would be treated as a lost connection');
      return 'noticed by the daily check; shop told on its dashboard with a Reconnect button; support sees "Connection lost" in plain words; shop no longer counted as live';
    });
    await step('lost access', 'the connection-lost email: off sends nothing; on, one plain-text email to the shop, then not again for a week; reconnecting clears it', async () => {
      // Needs migration 20261121090000_connection_lost_notice_marker on staging.
      const { runConnectionLostNotices } = await mod('lib/connection-lost.ts');
      const { sendEmail } = await mod('lib/email.ts');
      const marker = async () => (await db.from('users').select('connection_lost_notice_at').eq('id', shops.e.userId).single()).data?.connection_lost_notice_at ?? null;
      const toE = (from: number) => world.emails.slice(from).filter((e) => e.to === EMAIL('e'));
      const pass = (enabled: boolean) => runConnectionLostNotices(db, { now: new Date(), enabled, send: sendEmail });
      // Off (the default): the hourly job counts it and sends nothing.
      let em0 = world.emails.length;
      const sync = await cron('metrics-sync');
      need(sync.data.connectionLost?.enabled === false && sync.data.connectionLost.due >= 1 && sync.data.connectionLost.sent === 0 && toE(em0).length === 0 && (await marker()) === null, `with the switch off: ${JSON.stringify(sync.data.connectionLost)}, ${toE(em0).length} email(s)`);
      // On: one email, plain text, to the shop's own address.
      em0 = world.emails.length;
      const on = await pass(true);
      const mail = toE(em0);
      need(!on.problem && mail.length === 1 && /Please reconnect/.test(mail[0].subject) && mail[0].html === '' && /Settings and press Reconnect/.test(mail[0].text) && /nothing is posted/.test(mail[0].text) && !/<[a-z]/i.test(mail[0].text) && (await marker()), `with it on: ${JSON.stringify(on)}, ${mail.map((e) => e.subject)}`);
      // Not again within the week.
      em0 = world.emails.length;
      await pass(true);
      need(toE(em0).length === 0, 'the email was sent again within the week');
      // A week on, once more.
      await db.from('users').update({ connection_lost_notice_at: new Date(Date.now() - 8 * DAY).toISOString() }).eq('id', shops.e.userId);
      em0 = world.emails.length;
      await pass(true);
      need(toE(em0).length === 1, `a week on: ${toE(em0).length} email(s)`);
      // Reconnected: the marker is cleared and nothing is sent. Then put E back as it was.
      await db.from('users').update({ token_status: 'valid' }).eq('id', shops.e.userId);
      try {
        em0 = world.emails.length;
        const cleared = await pass(true);
        need(cleared.cleared >= 1 && (await marker()) === null && toE(em0).length === 0, `after reconnecting: ${JSON.stringify(cleared)}`);
      } finally {
        await db.from('users').update({ token_status: 'invalid', connection_lost_notice_at: null }).eq('id', shops.e.userId);
      }
      return 'off: counted, none sent; on: one plain-text email to E, none within the week, one a week on; reconnecting cleared the marker';
    });
    await step('retention', 'off: nothing is recorded and the view is closed. On: facts per shop, most at risk first, no contact details', async () => {
      const off = await admin('admin/pilot', { action: 'retention' });
      need(off.status === 200 && off.data.enabled === false && !off.data.rows, `with the flag off the view gave ${JSON.stringify(off.data).slice(0, 80)}`);
      await call('dashboard', 'GET', '/api/dashboard', { cookie: shops.a.cookie });
      const { data: u0 } = await db.from('users').select('last_seen_at').eq('id', shops.a.userId).single();
      need(u0!.last_seen_at === null, 'a dashboard visit was recorded with the flag off');
      process.env.RETENTION_VIEW = 'on';
      try {
        await call('dashboard', 'GET', '/api/dashboard', { cookie: shops.a.cookie });
        const { data: u1 } = await db.from('users').select('last_seen_at').eq('id', shops.a.userId).single();
        need(!!u1!.last_seen_at, 'a dashboard visit was not recorded with the flag on');
        await call('dashboard', 'GET', '/api/dashboard', { cookie: shops.a.cookie });
        const { data: u2 } = await db.from('users').select('last_seen_at').eq('id', shops.a.userId).single();
        need(u2!.last_seen_at === u1!.last_seen_at, 'a second visit within the hour wrote again');
        const on = await admin('admin/pilot', { action: 'retention' });
        need(on.data.enabled && on.data.rows.length === 7, `retention gave ${on.data.rows?.length} rows`);
        const r = (k: string) => on.data.rows.find((x: any) => x.name === shops[k].name);
        need(r('e').risk === 'high' && r('e').signals.some((t: string) => /Connected but not live: connection lost/.test(t)), `shop E (lost access): ${JSON.stringify(r('e')).slice(0, 200)}`);
        need(r('a').lastSeenOn && !r('a').signals.some((t: string) => /dashboard/.test(t)), `shop A, who just opened its dashboard: ${JSON.stringify(r('a').signals)}`);
        const order = on.data.rows.map((x: any) => x.risk);
        const rank: Record<string, number> = { high: 0, some: 1, none: 2 };
        need(order.every((x: string, i: number) => i === 0 || rank[order[i - 1]] <= rank[x]), `not ordered by risk: ${order}`);
        need(!/@|07700|\+44/.test(JSON.stringify(on.data)) && !/@/.test(on.data.csv), 'the retention view or its download contains contact details');
        return `7 shops: ${on.data.counts.high} at risk, ${on.data.counts.some} worth a look, ${on.data.counts.none} fine; one visit recorded, not two; no contact details`;
      } finally { delete process.env.RETENTION_VIEW; await db.from('users').update({ last_seen_at: null }).eq('id', shops.a.userId); }
    });

    let websiteChangeId = '';
    await step('settings', 'the shop sets holiday hours and its website from Settings; each is checked on "Google" and logged', async () => {
      const listing = await call('listing', 'GET', '/api/listing', { cookie: A().cookie });
      need(listing.status === 200 && listing.data.available && listing.data.hours.daysSet === 6 && listing.data.website === 'https://shop.invalid', `listing read gave ${listing.text.slice(0, 160)}`);
      const day = iso(new Date(Date.now() + 20 * DAY));
      const hol = await fix('a', { step: 'holidayHours', days: [{ date: day, open: false }] });
      need(hol.result.ok && la().location.specialHours.specialHourPeriods.length === 1 && la().location.specialHours.specialHourPeriods[0].closed === true, `holiday hours: ${hol.result.message}`);
      const past = await fix('a', { step: 'holidayHours', days: [{ date: '2020-01-01', open: false }] });
      need(past.result.ok === false, 'a date in the past was accepted');
      const site = await fix('a', { step: 'website', url: 'www.zz-test-floors.invalid' });
      need(site.result.ok && la().location.websiteUri === 'https://www.zz-test-floors.invalid', `website: ${site.result.message}`);
      const junk = await fix('a', { step: 'website', url: 'not a website' });
      need(junk.result.ok === false && la().location.websiteUri === 'https://www.zz-test-floors.invalid', 'nonsense was accepted as a website');
      const { data: rows } = await db.from('change_log').select('id, target, before_value').eq('location_name', la().loc).in('target', ['websiteUri', 'specialHours']).eq('status', 'applied');
      need(rows.length === 2 && rows.find((x: any) => x.target === 'websiteUri').before_value.websiteUri === 'https://shop.invalid', 'the two changes were not logged with what they replaced');
      websiteChangeId = rows.find((x: any) => x.target === 'websiteUri').id;
      return 'holiday hours and website written, read back and logged; a past date and a nonsense address refused';
    });
    await step('undo', 'the shop undoes one of its own changes itself; another shop cannot; support undoes one from the admin page', async () => {
      const mine = await call('changes', 'GET', '/api/changes', { cookie: A().cookie });
      need(mine.status === 200 && mine.data.changes.length >= 6 && mine.data.changes.some((c: any) => c.what === 'Opening hours' && /Monday 9:00 to 17:30/.test(c.after) && c.before === 'nothing'), `the shop's list of changes: ${mine.text.slice(0, 200)}`);
      const notMine = await call('changes', 'POST', '/api/changes', { cookie: shops.d.cookie, body: { changeId: websiteChangeId } });
      need(notMine.status === 404 && la().location.websiteUri === 'https://www.zz-test-floors.invalid', `another shop could undo this (${notMine.status})`);
      const undone = await call('changes', 'POST', '/api/changes', { cookie: A().cookie, body: { changeId: websiteChangeId } });
      need(undone.data.undo?.ok && la().location.websiteUri === 'https://shop.invalid', `the shop's own undo: ${undone.text.slice(0, 160)}`);
      const twice = await call('changes', 'POST', '/api/changes', { cookie: A().cookie, body: { changeId: websiteChangeId } });
      need(twice.data.undo?.ok === false && /Already undone/.test(twice.data.undo.message), 'the same change could be undone twice');
      // Support, from the admin page: the holiday hours.
      const list = await admin('admin/pilot', { action: 'changes', retailerId: A().retailerId });
      const hol = list.data.changes.find((c: any) => c.what === 'Holiday hours' && c.canUndo);
      need(hol, 'support cannot see the holiday-hours change');
      const wrongShop = await admin('admin/pilot', { action: 'undo_change', retailerId: shops.d.retailerId, changeId: hol.id });
      need(wrongShop.status === 404, `support could undo a change through the wrong shop (${wrongShop.status})`);
      const byAdmin = await admin('admin/pilot', { action: 'undo_change', retailerId: A().retailerId, changeId: hol.id });
      need(byAdmin.data.undo.ok && !la().location.specialHours, `support's undo: ${byAdmin.text.slice(0, 160)}`);
      // A field changed again since is not put back blindly.
      const before = la().location.profile.description;
      la().location.profile.description = 'The shop rewrote this itself, in Google.';
      const desc = list.data.changes.find((c: any) => c.what === 'Description');
      const refused = await admin('admin/pilot', { action: 'undo_change', retailerId: A().retailerId, changeId: desc.id });
      need(refused.data.undo.ok === false && /changed again since/.test(refused.data.undo.message) && la().location.profile.description === 'The shop rewrote this itself, in Google.', 'an undo overwrote a later change without being told to');
      la().location.profile.description = before;
      return 'the shop sees its changes in plain words and undoes one itself, checked on "Google"; not twice; not another shop\'s; support undoes one from the admin page; an undo that would lose a later change is refused';
    });

    // ════════ 10. Undo ════════
    await step('revert', 'the revert script puts the listing back from the change log', async () => {
      const original = JSON.parse(la().original);
      need(la().posts.length === 7 && la().location.profile.description !== '', `nothing to revert: ${la().posts.length} posts on "Google", description ${la().location.profile.description ? 'set' : 'empty'}`);
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
      for (const f of ['profile', 'serviceItems', 'categories', 'regularHours', 'websiteUri', 'specialHours']) {
        need(canon(la().location[f]) === canon(original[f]), `"${f}" was not restored: now ${canon(la().location[f])?.slice(0, 160)}, was ${canon(original[f])?.slice(0, 160)}`);
      }
      const rev = (id: string) => la().reviews.find((x) => x.reviewId === id)!;
      need(!rev('rev-5star').reviewReply && !rev('rev-4star').reviewReply && !rev('rev-new-5').reviewReply, 'a reply we wrote automatically is still there');
      need(rev('rev-answered').reviewReply, 'a reply the shop wrote itself, before we arrived, was removed');
      need(rev('rev-owner-answered').reviewReply, 'a reply the shop wrote itself was removed');
      need(!rev('rev-a-alert-5').reviewReply, 'the reply we wrote to the review alerted on is still there');
      need(la().reviews.length === 9, 'a review itself was touched');
      const skipped = lines.filter((l) => /SKIP/.test(l));
      const stillThere = rev('rev-2star').reviewReply ? 'the holding reply the shop approved by hand is left in place and reported for a manual check' : 'the hand-approved holding reply was removed too';
      return `7 posts deleted; description, services, categories, hours, website and holiday hours back to what they were; our automatic replies removed; the shop's own replies and all 9 reviews untouched; ${skipped.length} skipped (${stillThere})`;
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
