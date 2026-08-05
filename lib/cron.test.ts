import { describe, it, expect, vi, afterEach } from 'vitest';
import { isEntitledToAutomation, admitEntitled } from './cron';

// The gate every cron job runs behind. It was a bare
// `subscription_status = 'active'`, which made every Stellar retailer invisible
// to all six cron routes forever and silently — the product simply never ran for
// the tenant it was built for. These cases exist so that cannot come back.

const chocka = { tenants: { slug: 'chocka' } };   // priceMonthlyGbp 29
const stellar = { tenants: { slug: 'stellar' } }; // priceMonthlyGbp 0

describe('isEntitledToAutomation', () => {
  it('admits a paying Chocka user', () => {
    expect(isEntitledToAutomation({ ...chocka, subscription_status: 'active' })).toBe(true);
  });

  it('excludes a Chocka user who is not paying', () => {
    expect(isEntitledToAutomation({ ...chocka, subscription_status: 'none' })).toBe(false);
    expect(isEntitledToAutomation({ ...chocka, subscription_status: 'cancelled' })).toBe(false);
    expect(isEntitledToAutomation({ ...chocka, subscription_status: null })).toBe(false);
  });

  it('admits a Stellar retailer despite never being "active"', () => {
    // The regression. 'none' is the column default and the only value a Stellar
    // retailer can ever hold: Stellar is free, so nothing goes through Stripe,
    // and the Stripe webhook is the only writer of 'active' in the codebase.
    expect(isEntitledToAutomation({ ...stellar, subscription_status: 'none' })).toBe(true);
    expect(isEntitledToAutomation({ ...stellar, subscription_status: null })).toBe(true);
    expect(isEntitledToAutomation({ ...stellar, subscription_status: undefined })).toBe(true);
  });

  it('still admits a Stellar retailer if one somehow is marked active', () => {
    expect(isEntitledToAutomation({ ...stellar, subscription_status: 'active' })).toBe(true);
  });

  it('does not admit a cancelled Chocka user by accident', () => {
    // Guards the shape of the fix: entitlement is "paying OR free tenant", not
    // "has a tenant".
    expect(isEntitledToAutomation({ ...chocka, subscription_status: 'past_due' })).toBe(false);
  });

  it('treats an unknown or missing tenant as the primary (paid) tenant', () => {
    // getTenantForRow falls back to the primary tenant, which is priced — so an
    // unresolvable row is NOT silently granted automation.
    expect(isEntitledToAutomation({ subscription_status: 'none' })).toBe(false);
    expect(isEntitledToAutomation({ tenants: null, subscription_status: 'none' })).toBe(false);
    expect(isEntitledToAutomation({ tenants: { slug: 'nonsense' }, subscription_status: 'none' })).toBe(false);
  });

  it('handles a null user rather than throwing', () => {
    expect(isEntitledToAutomation(null)).toBe(false);
    expect(isEntitledToAutomation(undefined)).toBe(false);
  });
});

// The counting half of the gate. FOLLOWUPS: "a cron run that processes zero
// users is currently indistinguishable from a healthy quiet day" — these cases
// pin the counts, the per-tenant breakdown and the zero-admitted warning, all of
// which exist so the 2026-08-03 silent exclusion cannot recur unobserved.
describe('admitEntitled', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns exactly the entitled subset', () => {
    const paying = { ...chocka, subscription_status: 'active', id: 'a' };
    const notPaying = { ...chocka, subscription_status: 'none', id: 'b' };
    const free = { ...stellar, subscription_status: 'none', id: 'c' };

    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(admitEntitled([paying, notPaying, free], 'test').map((u) => u.id)).toEqual(['a', 'c']);
  });

  it('logs candidate and admitted counts with a per-tenant breakdown', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    admitEntitled(
      [
        { ...chocka, subscription_status: 'active' },
        { ...chocka, subscription_status: 'none' },
        { ...stellar, subscription_status: 'none' },
      ],
      'post-generator',
    );

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('[cron:post-generator]');
    expect(line).toContain('candidates=3');
    expect(line).toContain('admitted=2');
    // The breakdown is the part that matters: an aggregate of 2/3 would look
    // healthy in the exact case where one whole tenant was excluded.
    expect(line).toContain('chocka 1/2');
    expect(line).toContain('stellar 1/1');
  });

  it('WARNS when there were candidates and none were admitted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const out = admitEntitled([{ ...chocka, subscription_status: 'none' }], 'monday-stats');

    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain('ZERO admitted');
    expect(line).toContain('candidates=1');
    expect(line).toContain('chocka 0/1');
  });

  it('does not warn when there were no candidates at all', () => {
    // Nothing to admit is not the same fault as admitting nothing. An empty
    // query is a quiet day; a full query admitting nobody is the bug shape.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(admitEntitled([], 'review-alerts')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('candidates=0 admitted=0');
  });

  it('labels rows with no embedded tenant rather than dropping them from the count', () => {
    // A query that forgot `tenants ( slug )` still has to be countable — that
    // missing embed is itself a documented trap, and it must not also make the
    // rows invisible in the log that would reveal it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    admitEntitled([{ subscription_status: 'none' }], 'onboarding-sequence');

    expect(warn.mock.calls[0][0]).toContain('(none) 0/1');
  });
});
