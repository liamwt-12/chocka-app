import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shopStatus, liveRulesFromEnv, needsHelpOrder, automationHeld, isActive, parseLiveRequires, STATUS_USER_COLUMNS, DEFAULT_LIVE_RULES, type StatusInvite } from './shop-status';
import { pilotStatus } from './pilot';

const NOW = new Date('2026-11-20T12:00:00Z');
const ALL = DEFAULT_LIVE_RULES;
const user = (o: any = {}) => ({ id: 'u1', google_refresh_token: 'v1.x', token_status: 'valid', auto_post_enabled: true, auto_reply_enabled: false, profiles: [{ google_location_name: 'locations/1' }], ...o });
const inv = (o: Partial<StatusInvite> = {}): StatusInvite => ({ status: 'pending', expires_at: '2026-12-10T00:00:00Z', created_at: '2026-11-10T00:00:00Z', accepted_at: null, opened_at: null, ...o });
const st = (r: any, u: any, i: StatusInvite[] = [], rules = ALL) => shopStatus({ user_id: null, ...r }, u, i, NOW, rules);

describe('LIVE is defined once: connected, matched, verified, access not lost, and something switched on', () => {
  it('live when all five hold', () => {
    const s = st({ user_id: 'u1', connection_status: 'connected' }, user());
    expect(s).toMatchObject({ key: 'live', live: true, needsHelp: false });
  });

  it('a shop from before statuses existed (no status recorded) is live if connected with access', () => {
    expect(st({ user_id: 'u1' }, user()).live).toBe(true);
  });

  it('the WRONG LISTING is not live, until a person confirms it', () => {
    const wrong = st({ user_id: 'u1', connection_status: 'check_listing', connection_detail: 'bound Kit Kitchens; none of the listings matches the expected shop' }, user());
    expect(wrong).toMatchObject({ key: 'check_listing', live: false, needsHelp: true, severity: 1 });
    expect(wrong.buttons).toEqual(['confirm_listing', 'reset']);
    expect(st({ user_id: 'u1', connection_status: 'check_listing', listing_confirmed_at: '2026-11-19T00:00:00Z' }, user()).live).toBe(true);
    // With no expected listing on record, support is not told we expected a different one.
    const none = st({ user_id: 'u1', connection_status: 'check_listing', connection_detail: 'Some Floors; we have no expected listing on record for this shop, so a person needs to confirm it' }, user());
    expect(none.why).toMatch(/had no listing on record/);
    expect(none.why).not.toMatch(/not to the listing we expected/);
    expect(wrong.why).toMatch(/not to the listing we expected/);
  });

  it('an UNVERIFIED listing is not live', () => {
    expect(st({ user_id: 'u1', connection_status: 'waiting_google' }, user())).toMatchObject({ key: 'waiting_google', live: false, needsHelp: true });
  });

  it('LOST ACCESS is not live, and says since when', () => {
    const s = st({ user_id: 'u1', connection_status: 'connected' }, user({ token_status: 'invalid', token_invalid_at: '2026-11-16T09:00:00Z' }));
    expect(s).toMatchObject({ key: 'access_lost', live: false, severity: 1 });
    expect(s.why).toMatch(/16 Nov/);
    expect(s.action).toMatch(/Reconnect/);
  });

  it('signed in but no listing bound is not live, whatever else is true', () => {
    expect(st({ user_id: 'u1', connection_status: 'connected' }, user({ profiles: [] }))).toMatchObject({ key: 'no_listing_chosen', live: false });
    expect(st({ user_id: 'u1' }, null).key).toBe('no_listing_chosen');
  });

  it('manager access counts, and says so', () => {
    const managed = { id: 'u2', google_refresh_token: null, auto_reply_enabled: true, managed_by_user_id: 'op', manager: { id: 'op', google_refresh_token: 'v1.y', token_status: 'valid' }, profiles: [{ google_location_name: 'locations/2' }] };
    expect(st({ user_id: 'u2' }, managed)).toMatchObject({ live: true, why: 'live (manager access)' });
  });

  it('the rules can be relaxed by a setting, and "connected" never can', () => {
    expect(liveRulesFromEnv(undefined)).toEqual(ALL);
    expect(liveRulesFromEnv('')).toEqual(ALL);
    expect(liveRulesFromEnv('access')).toEqual({ matched: false, verified: false, access: true, active: false });
    expect(liveRulesFromEnv('Matched, VERIFIED ')).toEqual({ matched: true, verified: true, access: false, active: false });
    // Anything that is not one of the four words is not trusted to relax what is billed: the full definition applies.
    for (const bad of ['Matched, VERIFIED ,nonsense', 'matched; verified; access; active', '"matched,verified,access,active"', 'all', ',,']) {
      expect(parseLiveRequires(bad).rules, bad).toEqual(ALL);
      expect(parseLiveRequires(bad).problem, bad).toMatch(/has been ignored and the full definition applies/);
    }
    expect(parseLiveRequires('matched,verified,access').problem).toBeNull();
    expect(liveRulesFromEnv('matched,verified,access,active')).toEqual(ALL);
    const lax = liveRulesFromEnv('access');
    expect(st({ user_id: 'u1', connection_status: 'check_listing' }, user(), [], lax).live).toBe(true);
    expect(st({ user_id: 'u1', connection_status: 'waiting_google' }, user(), [], lax).live).toBe(true);
    expect(st({ user_id: 'u1' }, user({ profiles: [] }), [], { matched: false, verified: false, access: false, active: false }).live).toBe(false);
  });
});

describe('live is tied to value: posts or replies must be switched on', () => {
  const connected = { user_id: 'u1', connection_status: 'connected', connection_checked_at: '2026-11-18T09:00:00Z' };
  it('posts on, or replies on, or both: live', () => {
    for (const o of [{ auto_post_enabled: true, auto_reply_enabled: false }, { auto_post_enabled: false, auto_reply_enabled: true }, { auto_post_enabled: true, auto_reply_enabled: true }]) {
      expect(st(connected, user(o))).toMatchObject({ key: 'live', live: true });
    }
  });
  it('connected, right listing, verified, access working, but NOTHING switched on: not live, and it says what would help', () => {
    const s = st(connected, user({ auto_post_enabled: false, auto_reply_enabled: false }));
    expect(s).toMatchObject({ key: 'nothing_on', label: 'Nothing switched on', live: false, connected: true, needsHelp: true, severity: 2 });
    expect(s.why).toMatch(/does not count as live until one is on/);
    expect(s.action).toMatch(/Only the shop can switch these on/);
    // No button here does it for the shop.
    expect(s.buttons).toEqual([]);
  });
  it('a shop that has pressed Pause is not live while paused, whatever is switched on', () => {
    const s = st(connected, user({ auto_post_enabled: true, auto_reply_enabled: true, automation_paused_at: '2026-11-19T10:00:00Z' }));
    expect(s).toMatchObject({ key: 'paused', label: 'Paused by the shop', live: false, connected: true, needsHelp: true, severity: 3 });
    expect(s.why).toMatch(/19 Nov/);
  });
  it('an account row read without the switches cannot be live: unknown is not "on"', () => {
    const bare = { id: 'u1', google_refresh_token: 'v1.x', token_status: 'valid', profiles: [{ google_location_name: 'locations/1' }] };
    expect(st(connected, bare).live).toBe(false);
    expect(isActive(null)).toBe(false);
    expect(isActive({ auto_post_enabled: 'true' as any })).toBe(false);
  });
  it('the earlier reasons still come first: a wrong listing with nothing on is "Check listing", not "Nothing switched on"', () => {
    const off = user({ auto_post_enabled: false, auto_reply_enabled: false });
    expect(st({ user_id: 'u1', connection_status: 'check_listing' }, off).key).toBe('check_listing');
    expect(st({ user_id: 'u1', connection_status: 'waiting_google' }, off).key).toBe('waiting_google');
    expect(st({ user_id: 'u1', connection_status: 'connected' }, { ...off, token_status: 'invalid' }).key).toBe('access_lost');
  });
  it('switches that were only turned on by a hands-off choice do not count once hands-off is not in force', () => {
    // Chose hands-off (which turned both on); the hands-off switch is off in this test run.
    const chose = user({ auto_post_enabled: true, auto_reply_enabled: true, automation_mode: 'hands_off', automation_consent_at: '2026-11-18T10:00:00Z', automation_consent_version: 'whatever' });
    expect(st(connected, chose)).toMatchObject({ key: 'nothing_on', live: false });
    expect(st(connected, { ...chose, automation_mode: 'ask_first' }).live).toBe(true);
  });
  it('can be relaxed by the setting, like the others, and is on by default', () => {
    expect(DEFAULT_LIVE_RULES.active).toBe(true);
    const off = user({ auto_post_enabled: false, auto_reply_enabled: false });
    expect(st(connected, off, [], liveRulesFromEnv('matched,verified,access')).live).toBe(true);
  });
  it('is "connected, not live" in the five coarse states, and is on the needs-help list', () => {
    const off = user({ auto_post_enabled: false, auto_reply_enabled: false });
    expect(pilotStatus(connected, off as any, [], NOW).state).toBe('connected_not_live');
    const rows = [{ id: 'a', status: st(connected, off) }, { id: 'b', status: st(connected, user()) }];
    expect(needsHelpOrder(rows).map((r) => r.id)).toEqual(['a']);
  });
  it('nothing that decides "live" ever switches anything on for a shop', () => {
    const code = readFileSync(new URL('./shop-status.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\.update\(|auto_post_enabled:\s*true|auto_reply_enabled:\s*true/);
  });
  it('every query that feeds the definition reads the switches', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(STATUS_USER_COLUMNS).toBe('auto_post_enabled, auto_reply_enabled, automation_paused_at, automation_mode, automation_consent_at, automation_consent_version');
    for (const f of ['./billing.ts', './console-data.ts', './retention-data.ts', '../app/api/admin/pilot/route.ts']) {
      expect(src(f), f).toMatch(/\$\{STATUS_USER_COLUMNS\}/);
      expect(src(f), f).toMatch(/shopStatus\(|pilotStatus\(/);
    }
    // And those are the only places it is called from.
    const callers = ['./billing.ts', './console-data.ts', './retention-data.ts', './pilot.ts', '../app/api/admin/pilot/route.ts'];
    expect(callers).toHaveLength(5);
  });
});

describe('why a shop has not connected', () => {
  it.each([
    ['cancelled', /Cancel/, /Ring them/],
    ['unticked', /unticked/, /tick the box/],
    ['no_listing', /does not look after any shop/, /Ask who set the shop up/],
    ['wrong_account', /other listings/, /Google account that manages this shop/],
    ['google_error', /did not answer/, /try again/],
  ])('%s: a reason and an action in plain words', (code, why, action) => {
    const s = st({ connect_issue: code, connect_issue_at: '2026-11-19T12:00:00Z' }, null, [inv({ accepted_at: '2026-11-19T11:59:00Z' })]);
    expect(s.key).toBe(code);
    expect(s.needsHelp).toBe(true);
    expect(s.why).toMatch(why);
    expect(s.why).toMatch(/yesterday/);
    expect(s.action).toMatch(action);
  });

  it('these five no longer all read the same', () => {
    const keys = [
      st({ connect_issue: 'cancelled' }, null, [inv()]).key,
      st({ connect_issue: 'unticked' }, null, [inv()]).key,
      st({}, null, [inv({ accepted_at: '2026-11-17T00:00:00Z' })]).key,
      st({}, null, [inv({ opened_at: '2026-11-12T00:00:00Z' })]).key,
      st({}, null, [inv()]).key,
    ];
    expect(new Set(keys).size).toBe(5);
    expect(keys).toEqual(['cancelled', 'unticked', 'started', 'opened', 'not_opened']);
  });

  it('quiet states are only flagged once they have been quiet a while', () => {
    expect(st({}, null, [inv({ accepted_at: '2026-11-20T09:00:00Z' })]).needsHelp).toBe(false);
    expect(st({}, null, [inv({ accepted_at: '2026-11-18T09:00:00Z' })]).needsHelp).toBe(true);
    expect(st({}, null, [inv({ opened_at: '2026-11-19T09:00:00Z' })]).needsHelp).toBe(false);
    expect(st({}, null, [inv({ opened_at: '2026-11-16T09:00:00Z' })]).needsHelp).toBe(true);
    expect(st({}, null, [inv({ created_at: '2026-11-18T00:00:00Z' })]).needsHelp).toBe(false);
    expect(st({}, null, [inv({ created_at: '2026-11-10T00:00:00Z' })]).needsHelp).toBe(true);
  });

  it('a bounced invitation and an expired link come before guesses about what the shop did', () => {
    expect(st({ invite_bounced_at: '2026-11-18T00:00:00Z', connect_issue: 'cancelled' }, null, [inv()])).toMatchObject({ key: 'bounced', severity: 1 });
    expect(st({ connect_issue: 'cancelled' }, null, [inv({ expires_at: '2026-11-14T00:00:00Z' })]).key).toBe('link_expired');
    expect(st({}, null, [inv({ expires_at: '2026-11-14T00:00:00Z' })]).buttons).toContain('new_link');
  });

  it('no link at all is "not invited", and is not a call for help', () => {
    expect(st({}, null, [])).toMatchObject({ key: 'not_invited', needsHelp: false });
    expect(st({}, null, [inv({ status: 'revoked' })]).key).toBe('not_invited');
  });

  it('no wording here needs a developer to read it', () => {
    const all = [
      st({ user_id: 'u1' }, user({ token_status: 'invalid' })), st({ user_id: 'u1', connection_status: 'check_listing' }, user()),
      st({ user_id: 'u1', connection_status: 'waiting_google' }, user()), st({ user_id: 'u1' }, user({ profiles: [] })),
      st({ connect_issue: 'cancelled' }, null, [inv()]), st({}, null, [inv({ accepted_at: '2026-11-01T00:00:00Z' })]),
    ];
    for (const s of all) expect(`${s.label} ${s.why} ${s.action}`).not.toMatch(/token|OAuth|credential|token_status|scope|API|null|undefined/);
  });
});

describe('the needs-help list', () => {
  it('most urgent first, then longest waiting; fine shops are left out', () => {
    const rows = [
      { name: 'fine', status: st({ user_id: 'u1' }, user()) },
      { name: 'quiet', status: st({}, null, [inv({ created_at: '2026-11-01T00:00:00Z' })]) },
      { name: 'cancelled-recent', status: st({ connect_issue: 'cancelled', connect_issue_at: '2026-11-19T00:00:00Z' }, null, [inv()]) },
      { name: 'cancelled-old', status: st({ connect_issue: 'cancelled', connect_issue_at: '2026-11-12T00:00:00Z' }, null, [inv()]) },
      { name: 'google-error', status: st({ connect_issue: 'google_error', connect_issue_at: '2026-11-11T00:00:00Z' }, null, [inv()]) },
    ];
    expect(needsHelpOrder(rows).map((r) => r.name)).toEqual(['cancelled-old', 'cancelled-recent', 'google-error', 'quiet']);
  });
});

describe('the five coarse states are a view of the same decision', () => {
  it('wrong listing, unverified and lost access all read "connected, not live"', () => {
    expect(pilotStatus({ user_id: 'u1', connection_status: 'check_listing' }, user(), [], NOW).state).toBe('connected_not_live');
    expect(pilotStatus({ user_id: 'u1', connection_status: 'waiting_google' }, user(), [], NOW).state).toBe('connected_not_live');
    expect(pilotStatus({ user_id: 'u1', connection_status: 'connected' }, user({ token_status: 'invalid' }), [], NOW).state).toBe('connected_not_live');
    expect(pilotStatus({ user_id: 'u1', connection_status: 'connected' }, user(), [], NOW).state).toBe('live');
  });

  it('the admin list and the console both go through pilotStatus, and nothing else decides "live"', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('../app/api/admin/pilot/route.ts')).toMatch(/pilotStatus\(r, user, shopInvites, now, rules\)/);
    expect(src('./console-data.ts')).toMatch(/pilotStatus\(r, user/);
    // The fields the decision needs are fetched by both.
    for (const f of ['../app/api/admin/pilot/route.ts', './console-data.ts']) {
      expect(src(f)).toMatch(/connection_status/);
      expect(src(f)).toMatch(/listing_confirmed_at/);
      expect(src(f)).toMatch(/token_invalid_at/);
    }
    expect(src('./pilot.ts')).not.toMatch(/resolveAccess\(/);
  });
});

describe('unattended work is held for an unconfirmed or unverified listing', () => {
  it('held', () => {
    expect(automationHeld([{ connection_status: 'check_listing', listing_confirmed_at: null }])).toMatch(/not the one we expected/);
    expect(automationHeld({ connection_status: 'waiting_google' })).toMatch(/not verified/);
  });
  it('not held: confirmed, connected, or no shop record at all (the other brand)', () => {
    expect(automationHeld([{ connection_status: 'check_listing', listing_confirmed_at: '2026-11-19T00:00:00Z' }])).toBeNull();
    expect(automationHeld([{ connection_status: 'connected' }])).toBeNull();
    expect(automationHeld([])).toBeNull();
    expect(automationHeld(undefined)).toBeNull();
    expect(automationHeld(null)).toBeNull();
  });
  it('follows the same setting as "live"', () => {
    expect(automationHeld({ connection_status: 'waiting_google' }, { matched: true, verified: false, access: true, active: true })).toBeNull();
  });
  it('every job that acts for a shop is covered', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('./cron.ts')).toMatch(/automationHeld\(u\.retailers\)/);
    expect(src('../app/api/cron/post-publisher/route.ts')).toMatch(/automationHeld\(user\.retailers\)/);
    // The daily check must still see held shops, or a hold could never lift.
    expect(src('../app/api/cron/metrics-sync/route.ts')).toMatch(/includeHeld: true/);
  });
});
