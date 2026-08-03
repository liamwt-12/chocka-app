import { describe, it, expect } from 'vitest';
import { resolveTenantSlug, PRIMARY_TENANT_SLUG } from './tenant-registry';

describe('resolveTenantSlug', () => {
  it('resolves the live hosts', () => {
    expect(resolveTenantSlug('app.chocka.co.uk')).toBe('chocka');
    expect(resolveTenantSlug('app.stellarlocal.co.uk')).toBe('stellar');
  });

  it('strips the port before lookup', () => {
    expect(resolveTenantSlug('stellar.localhost:3000')).toBe('stellar');
    expect(resolveTenantSlug('localhost:3000')).toBe('chocka');
  });

  it('is case-insensitive', () => {
    expect(resolveTenantSlug('APP.StellarLocal.CO.UK')).toBe('stellar');
  });

  it('gives local development a Stellar host', () => {
    // The point of the entry: plain localhost is Chocka, so without a distinct
    // local host there is no way to render Stellar on a dev machine.
    expect(resolveTenantSlug('localhost')).toBe('chocka');
    expect(resolveTenantSlug('stellar.localhost')).toBe('stellar');
  });

  it('fails safe to the primary tenant on an unknown host', () => {
    // Documented behaviour, and the reason a typo'd local host silently renders
    // as Chocka rather than erroring — worth an explicit test so a future change
    // to a 404 is a deliberate break rather than a surprise.
    expect(resolveTenantSlug('stellar.local')).toBe(PRIMARY_TENANT_SLUG);
    expect(resolveTenantSlug('')).toBe(PRIMARY_TENANT_SLUG);
    expect(resolveTenantSlug('example.com')).toBe(PRIMARY_TENANT_SLUG);
  });
});
