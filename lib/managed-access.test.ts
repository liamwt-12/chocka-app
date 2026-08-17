import { describe, it, expect } from 'vitest';
import { resolveAccess, MANAGER_EMBED } from './managed-access';

// This decides which credential we act with on somebody else's Google listing.
// The cases are weighted towards proving it refuses: every ambiguous, missing or
// half-loaded shape must resolve to ok:false rather than to a plausible guess.

const SELF = {
  id: 'user-1',
  google_refresh_token: 'v1.selfcipher',
  token_status: 'valid',
  managed_by_user_id: null,
};

const MANAGED = {
  id: 'retailer-1',
  google_refresh_token: null,
  token_status: null,
  managed_by_user_id: 'operator-1',
  manager: { id: 'operator-1', google_refresh_token: 'v1.opcipher', token_status: 'valid' },
};

describe('resolveAccess — self-managed', () => {
  it('uses the user own token, bound to their own id', () => {
    const r = resolveAccess(SELF);
    expect(r).toMatchObject({
      ok: true,
      via: 'self',
      encryptedToken: 'v1.selfcipher',
      aadUserId: 'user-1',
    });
  });

  it('refuses when the own token has gone bad', () => {
    for (const status of ['invalid', 'offboarded', null, undefined, 'pending']) {
      const r = resolveAccess({ ...SELF, token_status: status as any });
      expect(r.ok).toBe(false);
    }
  });

  it('does NOT fall back to a manager when the user own token is bad', () => {
    // A self-managed user whose token expired needs to reconnect. Silently
    // acting with someone else's credential is a substitution they never agreed
    // to, not a repair.
    const r = resolveAccess({
      ...SELF,
      token_status: 'invalid',
      managed_by_user_id: 'operator-1',
      manager: { id: 'operator-1', google_refresh_token: 'v1.opcipher', token_status: 'valid' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('reconnect');
  });
});

describe('resolveAccess — managed', () => {
  // THE POINT OF THE MODULE. The ciphertext lives on the manager row, so the AAD
  // must be the manager's id. Binding it to the retailer's id fails at decrypt
  // time and looks like a corrupt secret rather than a wiring mistake.
  it('borrows the manager token and binds the AAD to the MANAGER, not the retailer', () => {
    const r = resolveAccess(MANAGED);
    expect(r.ok).toBe(true);
    expect(r.via).toBe('manager');
    expect(r.encryptedToken).toBe('v1.opcipher');
    expect(r.aadUserId).toBe('operator-1');
    expect(r.aadUserId).not.toBe('retailer-1');
  });

  it('accepts the embed as an array, which is how PostgREST may return it', () => {
    const r = resolveAccess({ ...MANAGED, manager: [MANAGED.manager] });
    expect(r.ok).toBe(true);
    expect(r.aadUserId).toBe('operator-1');
  });

  it('refuses when the manager row was not embedded by the query', () => {
    const r = resolveAccess({ ...MANAGED, manager: undefined });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('manager row was not loaded');
  });

  it('refuses an empty embed array rather than reading it as fine', () => {
    expect(resolveAccess({ ...MANAGED, manager: [] }).ok).toBe(false);
  });

  it('refuses when the manager holds no token', () => {
    const r = resolveAccess({
      ...MANAGED,
      manager: { id: 'operator-1', google_refresh_token: null, token_status: 'valid' },
    });
    expect(r.ok).toBe(false);
  });

  it('refuses when the manager token has gone bad, and says it is fleet-wide', () => {
    const r = resolveAccess({
      ...MANAGED,
      manager: { id: 'operator-1', google_refresh_token: 'v1.opcipher', token_status: 'invalid' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('every retailer managed by this account');
  });

  it('refuses when the manager row has no id — there is no AAD to build', () => {
    const r = resolveAccess({
      ...MANAGED,
      manager: { google_refresh_token: 'v1.opcipher', token_status: 'valid' },
    });
    expect(r.ok).toBe(false);
  });
});

describe('resolveAccess — nothing to act with', () => {
  it('refuses a user with neither a token nor a manager', () => {
    const r = resolveAccess({ id: 'u', google_refresh_token: null, managed_by_user_id: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no Google access at all');
  });

  it('refuses null, undefined and an id-less row rather than throwing', () => {
    expect(resolveAccess(null).ok).toBe(false);
    expect(resolveAccess(undefined).ok).toBe(false);
    expect(resolveAccess({}).ok).toBe(false);
    expect(resolveAccess({ google_refresh_token: 'v1.x', token_status: 'valid' }).ok).toBe(false);
  });

  it('never returns a token without an AAD id, or an AAD id without a token', () => {
    // The two must travel together or the trap at the top of the module reopens.
    const rows = [
      SELF,
      MANAGED,
      {},
      null,
      { ...MANAGED, manager: undefined },
      { ...SELF, token_status: 'invalid' },
    ];
    for (const row of rows) {
      const r = resolveAccess(row as any);
      expect(Boolean(r.encryptedToken)).toBe(Boolean(r.aadUserId));
      expect(Boolean(r.encryptedToken)).toBe(r.ok);
    }
  });

  it('always gives a reason, including on success', () => {
    expect(resolveAccess(SELF).reason).toBeTruthy();
    expect(resolveAccess(MANAGED).reason).toBeTruthy();
    expect(resolveAccess(null).reason).toBeTruthy();
  });
});

describe('MANAGER_EMBED', () => {
  it('names every field resolveAccess reads off the manager', () => {
    // If a field is added to ManagerRow without being added here, managed users
    // fail at runtime and the query is the last place anyone looks.
    for (const field of ['id', 'google_refresh_token', 'token_status']) {
      expect(MANAGER_EMBED).toContain(field);
    }
    expect(MANAGER_EMBED).toContain('managed_by_user_id');
  });
});
