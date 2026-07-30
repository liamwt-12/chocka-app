import { describe, it, expect } from 'vitest';
import { getTenantForRow, getTenantBySlug, getTenant } from './tenant';

/**
 * getTenantForRow() is how cron jobs learn which brand a user belongs to. There
 * is no request context in a scheduler, so if this returns the wrong tenant the
 * failure is silent — a Stellar retailer receives Chocka-branded mail and
 * nothing errors. These tests pin the resolution and, just as importantly, the
 * fail-open cases that make the silence possible.
 */
describe('getTenantForRow', () => {
  it('resolves a Stellar row to the Stellar tenant', () => {
    const t = getTenantForRow({ tenants: { slug: 'stellar' } });
    expect(t.slug).toBe('stellar');
    expect(t.brandName).toBe('Stellar Local');
    expect(t.emailFrom).toBe('Stellar Local <hello@stellarlocal.co.uk>');
  });

  it('resolves a Chocka row to the primary tenant', () => {
    const t = getTenantForRow({ tenants: { slug: 'chocka' } });
    expect(t.slug).toBe('chocka');
    expect(t.emailFrom).toBe(getTenant().emailFrom);
  });

  // The following four are all the same hazard: the row cannot name a tenant,
  // so we fall back to the primary rather than throwing. That keeps a cron
  // running, but it is exactly how a Stellar user would silently get Chocka's
  // branding — hence the explicit coverage rather than an implicit assumption.
  it('falls open to the primary tenant when the embed is missing', () => {
    // What a `.select('*, profiles(*)')` that forgot `tenants ( slug )` returns.
    expect(getTenantForRow({} as any).slug).toBe('chocka');
  });

  it('falls open when tenants is null', () => {
    expect(getTenantForRow({ tenants: null }).slug).toBe('chocka');
  });

  it('falls open when the row itself is null or undefined', () => {
    expect(getTenantForRow(null).slug).toBe('chocka');
    expect(getTenantForRow(undefined).slug).toBe('chocka');
  });

  it('falls open on an unknown slug rather than throwing', () => {
    expect(getTenantForRow({ tenants: { slug: 'not-a-tenant' } }).slug).toBe('chocka');
  });

  it('agrees with getTenantBySlug for every known slug', () => {
    for (const slug of ['chocka', 'stellar']) {
      expect(getTenantForRow({ tenants: { slug } })).toEqual(getTenantBySlug(slug));
    }
  });
});

describe('tenant identities are actually distinct', () => {
  // Guards the regression this whole change exists to prevent: if these two
  // ever collapse to the same sender, per-user resolution is working but
  // pointless, and the tests above would still pass.
  it('Chocka and Stellar have different senders and brand names', () => {
    const chocka = getTenantBySlug('chocka');
    const stellar = getTenantBySlug('stellar');
    expect(stellar.emailFrom).not.toBe(chocka.emailFrom);
    expect(stellar.brandName).not.toBe(chocka.brandName);
    expect(stellar.appUrl).not.toBe(chocka.appUrl);
  });
});
