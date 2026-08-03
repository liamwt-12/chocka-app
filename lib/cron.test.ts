import { describe, it, expect } from 'vitest';
import { isEntitledToAutomation } from './cron';

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
