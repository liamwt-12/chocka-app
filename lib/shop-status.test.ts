import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shopStatus, liveRulesFromEnv, needsHelpOrder, automationHeld, DEFAULT_LIVE_RULES, type StatusInvite } from './shop-status';
import { pilotStatus } from './pilot';

const NOW = new Date('2026-11-20T12:00:00Z');
const ALL = DEFAULT_LIVE_RULES;
const user = (o: any = {}) => ({ id: 'u1', google_refresh_token: 'v1.x', token_status: 'valid', profiles: [{ google_location_name: 'locations/1' }], ...o });
const inv = (o: Partial<StatusInvite> = {}): StatusInvite => ({ status: 'pending', expires_at: '2026-12-10T00:00:00Z', created_at: '2026-11-10T00:00:00Z', accepted_at: null, opened_at: null, ...o });
const st = (r: any, u: any, i: StatusInvite[] = [], rules = ALL) => shopStatus({ user_id: null, ...r }, u, i, NOW, rules);

describe('LIVE is defined once: connected, matched, verified, access not lost', () => {
  it('live when all four hold', () => {
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
    const managed = { id: 'u2', google_refresh_token: null, managed_by_user_id: 'op', manager: { id: 'op', google_refresh_token: 'v1.y', token_status: 'valid' }, profiles: [{ google_location_name: 'locations/2' }] };
    expect(st({ user_id: 'u2' }, managed)).toMatchObject({ live: true, why: 'live (manager access)' });
  });

  it('the rules can be relaxed by a setting, and "connected" never can', () => {
    expect(liveRulesFromEnv(undefined)).toEqual(ALL);
    expect(liveRulesFromEnv('')).toEqual(ALL);
    expect(liveRulesFromEnv('access')).toEqual({ matched: false, verified: false, access: true });
    expect(liveRulesFromEnv('Matched, VERIFIED ,nonsense')).toEqual({ matched: true, verified: true, access: false });
    const lax = liveRulesFromEnv('access');
    expect(st({ user_id: 'u1', connection_status: 'check_listing' }, user(), [], lax).live).toBe(true);
    expect(st({ user_id: 'u1', connection_status: 'waiting_google' }, user(), [], lax).live).toBe(true);
    expect(st({ user_id: 'u1' }, user({ profiles: [] }), [], { matched: false, verified: false, access: false }).live).toBe(false);
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
    expect(automationHeld({ connection_status: 'waiting_google' }, { matched: true, verified: false, access: true })).toBeNull();
  });
  it('every job that acts for a shop is covered', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('./cron.ts')).toMatch(/automationHeld\(u\.retailers\)/);
    expect(src('../app/api/cron/post-publisher/route.ts')).toMatch(/automationHeld\(user\.retailers\)/);
    // The daily check must still see held shops, or a hold could never lift.
    expect(src('../app/api/cron/metrics-sync/route.ts')).toMatch(/includeHeld: true/);
  });
});
