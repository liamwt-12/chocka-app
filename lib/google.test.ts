import { describe, it, expect, afterEach, vi } from 'vitest';
import { getManageableListings, getLocationFull, GbpError, placeIdFromMapsUri } from './google';

// ── Mock helpers ──────────────────────────────────────────────────────────
// These stub Google's HTTP responses in the exact shapes each scenario
// produces. They prove the enumeration / filter / error-mapping LOGIC given
// those shapes — they do NOT prove the shapes match real Google (that's the
// live matrix in TEST_MATRIX.md).

type Loc = { name: string; title?: string; storefrontAddress?: any; latlng?: any; categories?: any };
type Acct = { name: string; accountName?: string; type?: string; role?: string };

function resp(ok: boolean, status: number, body: any, text?: string) {
  return { ok, status, json: async () => body, text: async () => text ?? JSON.stringify(body) } as any;
}

function accountFromLocationsUrl(u: string): string {
  return u.match(/(accounts\/[^/]+)\/locations/)?.[1] ?? '';
}

function mockGoogle(opts: {
  accounts?: Acct[];
  accountsStatus?: number;
  locationsByAccount?: Record<string, Loc[]>;
  failLocationsFor?: string[];
}) {
  const { accounts = [], accountsStatus = 200, locationsByAccount = {}, failLocationsFor = [] } = opts;
  global.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('mybusinessaccountmanagement')) {
      if (accountsStatus !== 200) return resp(false, accountsStatus, { error: { status: 'UNAUTHENTICATED' } }, 'invalid_grant');
      return resp(true, 200, { accounts });
    }
    if (u.includes('/locations?readMask')) {
      const acct = accountFromLocationsUrl(u);
      if (failLocationsFor.includes(acct)) return resp(false, 500, { error: { status: 'INTERNAL' } });
      return resp(true, 200, { locations: locationsByAccount[acct] || [] });
    }
    return resp(false, 404, { error: { status: 'NOT_FOUND' } }, JSON.stringify({ error: { status: 'NOT_FOUND' } }));
  }) as any;
}

const loc = (name: string, title: string): Loc => ({
  name, title,
  storefrontAddress: { addressLines: ['1 High St'], locality: 'Leeds', postalCode: 'LS1 1AA' },
  latlng: { latitude: 53.8, longitude: -1.5 },
  categories: { primaryCategory: { displayName: 'Flooring store' } },
});

afterEach(() => { vi.restoreAllMocks(); delete (global as any).fetch; });

// ── getManageableListings: enumeration + role filter (cases 1–8) ────────────
describe('getManageableListings', () => {
  it('Case 1 — owner with one location: returns that one listing', async () => {
    mockGoogle({
      accounts: [{ name: 'accounts/own', type: 'PERSONAL', role: 'PRIMARY_OWNER' }],
      locationsByAccount: { 'accounts/own': [loc('locations/1', 'My Shop')] },
    });
    const out = await getManageableListings('t');
    expect(out).toHaveLength(1);
    expect(out[0].locationName).toBe('locations/1');
    expect(out[0].address).toBe('1 High St, Leeds, LS1 1AA');
    expect(out[0].category).toBe('Flooring store');
  });

  it('Case 2 — manager with an EMPTY personal account first + one managed group location: picks the managed one, never the empty personal', async () => {
    mockGoogle({
      accounts: [
        { name: 'accounts/personal', type: 'PERSONAL', role: 'PRIMARY_OWNER' }, // empty, sorts first
        { name: 'accounts/group', type: 'LOCATION_GROUP', role: 'MANAGER', accountName: 'Tarkett Group' },
      ],
      locationsByAccount: {
        'accounts/personal': [],
        'accounts/group': [loc('locations/shop', 'Retailer Shop')],
      },
    });
    const out = await getManageableListings('t');
    expect(out).toHaveLength(1);
    expect(out[0].locationName).toBe('locations/shop');   // the regression the old accounts[0]/locations[0] caused
    expect(out[0].accountName).toBe('accounts/group');
    expect(out[0].accountDisplay).toBe('Tarkett Group');
  });

  it('Case 3 — manager with several locations: returns all of them', async () => {
    mockGoogle({
      accounts: [{ name: 'accounts/group', type: 'LOCATION_GROUP', role: 'MANAGER' }],
      locationsByAccount: { 'accounts/group': [loc('locations/a', 'Shop A'), loc('locations/b', 'Shop B'), loc('locations/c', 'Shop C')] },
    });
    const out = await getManageableListings('t');
    expect(out.map(l => l.locationName)).toEqual(['locations/a', 'locations/b', 'locations/c']);
  });

  it('Case 4 — group-manager: location under a LOCATION_GROUP is enumerated', async () => {
    mockGoogle({
      accounts: [{ name: 'accounts/grp', type: 'LOCATION_GROUP', role: 'MANAGER' }],
      locationsByAccount: { 'accounts/grp': [loc('locations/grouped', 'Grouped Shop')] },
    });
    const out = await getManageableListings('t');
    expect(out).toHaveLength(1);
    expect(out[0].accountType).toBe('LOCATION_GROUP');
  });

  it('Case 5 — empty personal account only: returns nothing (→ no_profile, not a crash)', async () => {
    mockGoogle({
      accounts: [{ name: 'accounts/personal', type: 'PERSONAL', role: 'PRIMARY_OWNER' }],
      locationsByAccount: { 'accounts/personal': [] },
    });
    const out = await getManageableListings('t');
    expect(out).toHaveLength(0);
  });

  it('Case 7 — mixed owner + group: returns listings from both accounts', async () => {
    mockGoogle({
      accounts: [
        { name: 'accounts/own', type: 'PERSONAL', role: 'PRIMARY_OWNER' },
        { name: 'accounts/grp', type: 'LOCATION_GROUP', role: 'MANAGER' },
      ],
      locationsByAccount: {
        'accounts/own': [loc('locations/mine', 'My Own Shop')],
        'accounts/grp': [loc('locations/managed', 'Managed Shop')],
      },
    });
    const out = await getManageableListings('t');
    expect(out.map(l => l.locationName).sort()).toEqual(['locations/managed', 'locations/mine']);
  });

  it('Case 8a — role filter: accounts without a management role are excluded even if they hold locations', async () => {
    mockGoogle({
      accounts: [
        { name: 'accounts/mgr', type: 'LOCATION_GROUP', role: 'MANAGER' },
        { name: 'accounts/comm', type: 'LOCATION_GROUP', role: 'COMMUNITY_MANAGER' }, // not a manage role
        { name: 'accounts/norole', type: 'LOCATION_GROUP' },                          // no role at all
      ],
      locationsByAccount: {
        'accounts/mgr': [loc('locations/ok', 'Manageable')],
        'accounts/comm': [loc('locations/no1', 'Excluded 1')],
        'accounts/norole': [loc('locations/no2', 'Excluded 2')],
      },
    });
    const out = await getManageableListings('t');
    expect(out.map(l => l.locationName)).toEqual(['locations/ok']);
  });

  it('all-or-nothing — a per-account locations failure aborts enumeration (never a partial set → wrong auto-bind)', async () => {
    mockGoogle({
      accounts: [
        { name: 'accounts/good', type: 'LOCATION_GROUP', role: 'MANAGER' },
        { name: 'accounts/bad', type: 'LOCATION_GROUP', role: 'MANAGER' },
      ],
      locationsByAccount: { 'accounts/good': [loc('locations/good', 'Good Shop')] },
      failLocationsFor: ['accounts/bad'],
    });
    await expect(getManageableListings('t')).rejects.toThrow();
  });

  it('pagination — follows accounts.list nextPageToken across pages', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('mybusinessaccountmanagement')) {
        return u.includes('pageToken')
          ? resp(true, 200, { accounts: [{ name: 'accounts/b', type: 'LOCATION_GROUP', role: 'MANAGER' }] })
          : resp(true, 200, { accounts: [{ name: 'accounts/a', type: 'PERSONAL', role: 'PRIMARY_OWNER' }], nextPageToken: 'p2' });
      }
      if (u.includes('/locations')) {
        const acct = accountFromLocationsUrl(u);
        return resp(true, 200, { locations: acct === 'accounts/a' ? [loc('locations/a', 'A')] : [loc('locations/b', 'B')] });
      }
      return resp(false, 404, {});
    }) as any;
    const out = await getManageableListings('t');
    expect(out.map(l => l.locationName).sort()).toEqual(['locations/a', 'locations/b']);
  });

  it('pagination — follows locations.list nextPageToken within one account', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('mybusinessaccountmanagement')) return resp(true, 200, { accounts: [{ name: 'accounts/grp', type: 'LOCATION_GROUP', role: 'MANAGER' }] });
      if (u.includes('/locations')) {
        return u.includes('pageToken')
          ? resp(true, 200, { locations: [loc('locations/2', 'Two')] })
          : resp(true, 200, { locations: [loc('locations/1', 'One')], nextPageToken: 'p2' });
      }
      return resp(false, 404, {});
    }) as any;
    const out = await getManageableListings('t');
    expect(out.map(l => l.locationName)).toEqual(['locations/1', 'locations/2']);
  });

  it('Case 6 — revoked/expired token: accounts.list fails, enumeration throws (→ mapped to reconnect upstream)', async () => {
    mockGoogle({ accountsStatus: 401 });
    await expect(getManageableListings('t')).rejects.toThrow();
  });
});

// ── getLocationFull: status-aware errors the audit route maps to codes ───────
describe('getLocationFull error mapping', () => {
  it('Case 8b — 403 PERMISSION_DENIED → GbpError carrying status 403 + PERMISSION_DENIED', async () => {
    global.fetch = vi.fn(async () => resp(false, 403, {}, JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }))) as any;
    const err = await getLocationFull('t', 'locations/x').catch(e => e);
    expect(err).toBeInstanceOf(GbpError);
    expect(err.status).toBe(403);
    expect(err.googleStatus).toBe('PERMISSION_DENIED');
  });

  it('404 NOT_FOUND → GbpError carrying status 404 + NOT_FOUND', async () => {
    global.fetch = vi.fn(async () => resp(false, 404, {}, JSON.stringify({ error: { status: 'NOT_FOUND' } }))) as any;
    const err = await getLocationFull('t', 'locations/x').catch(e => e);
    expect(err).toBeInstanceOf(GbpError);
    expect(err.status).toBe(404);
    expect(err.googleStatus).toBe('NOT_FOUND');
  });

  it('200 → returns the location payload', async () => {
    global.fetch = vi.fn(async () => resp(true, 200, { name: 'locations/x', title: 'Shop' })) as any;
    const out = await getLocationFull('t', 'locations/x');
    expect(out.title).toBe('Shop');
  });
});

describe('placeIdFromMapsUri', () => {
  // The place id rides in free on the location enumeration every signup already
  // makes. Before this, google_place_id was set only by a conditional fallback
  // buried in the dashboard, so 1 of 6 production profiles had one.

  it('pulls the id out of a real mapsUri', () => {
    expect(placeIdFromMapsUri('https://maps.google.com/?cid=123&place_id=ChIJabc123')).toBe('ChIJabc123');
  });

  it('accepts the colon form as well as the equals form', () => {
    expect(placeIdFromMapsUri('https://maps.google.com/?q=place_id:ChIJxyz789')).toBe('ChIJxyz789');
  });

  it('stops at the next parameter rather than swallowing the rest of the URL', () => {
    expect(placeIdFromMapsUri('https://maps.google.com/?place_id=ChIJabc&hl=en')).toBe('ChIJabc');
  });

  it('returns undefined — never an empty string — when there is nothing to find', () => {
    // undefined and '' are different downstream: one writes NULL, the other
    // writes a resolved-but-empty id that would compare equal to nothing.
    expect(placeIdFromMapsUri('https://maps.google.com/?cid=123')).toBeUndefined();
    expect(placeIdFromMapsUri('')).toBeUndefined();
    expect(placeIdFromMapsUri(null)).toBeUndefined();
    expect(placeIdFromMapsUri(undefined)).toBeUndefined();
  });
});
