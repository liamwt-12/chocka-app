import { describe, it, expect, vi } from 'vitest';
import { detectOwnership, statusForChosenListing, SHOP_MESSAGES, ADMIN_LABELS, shopConnectionMessage } from './ownership';
import { getManageableListings, type Listing } from './google';

const L = (title: string, placeId?: string, hasVoiceOfMerchant?: boolean): Listing => ({
  accountName: 'accounts/1', accountDisplay: '', accountType: 'PERSONAL', accountRole: 'OWNER',
  locationName: `locations/${title}`, title, address: '', category: '', placeId, hasVoiceOfMerchant,
});

describe('detectOwnership', () => {
  it('no listings: no access found', () => {
    expect(detectOwnership([], 'ChIJ1')).toMatchObject({ status: 'no_access', bind: null, needsPicker: false });
  });

  it('binds the expected listing even when the account manages several', () => {
    const r = detectOwnership([L('Other'), L('Testwell', 'ChIJ1'), L('Third')], 'ChIJ1');
    expect(r.status).toBe('connected');
    expect(r.bind?.title).toBe('Testwell');
    expect(r.needsPicker).toBe(false);
  });

  it('expected listing not verified yet: waiting on Google (still bound, so it picks up later)', () => {
    const r = detectOwnership([L('Testwell', 'ChIJ1', false)], 'ChIJ1');
    expect(r.status).toBe('waiting_google');
    expect(r.bind?.title).toBe('Testwell');
  });

  it('one listing that is not the expected one: bound, but flagged to check', () => {
    expect(detectOwnership([L('Someone Else', 'ChIJ9')], 'ChIJ1')).toMatchObject({ status: 'check_listing', needsPicker: false });
  });

  it('several listings, none matching: the shop picks, flagged to check', () => {
    expect(detectOwnership([L('A', 'x'), L('B', 'y')], 'ChIJ1')).toMatchObject({ status: 'check_listing', needsPicker: true, bind: null });
  });

  it('ordinary sign-in (no expected shop) keeps the old behaviour', () => {
    expect(detectOwnership([L('A')], null)).toMatchObject({ status: 'connected', bind: { title: 'A' } });
    expect(detectOwnership([L('A'), L('B')], null)).toMatchObject({ needsPicker: true });
  });

  it('undefined verification is unknown, never "waiting"', () => {
    expect(detectOwnership([L('Testwell', 'ChIJ1', undefined)], 'ChIJ1').status).toBe('connected');
  });
});

describe('statusForChosenListing', () => {
  it('matches, mismatches, unverified, and no baseline', () => {
    expect(statusForChosenListing(L('Testwell', 'ChIJ1'), 'ChIJ1').status).toBe('connected');
    expect(statusForChosenListing(L('Other', 'ChIJ2'), 'ChIJ1').status).toBe('check_listing');
    expect(statusForChosenListing(L('Testwell', 'ChIJ1', false), 'ChIJ1').status).toBe('waiting_google');
    expect(statusForChosenListing(L('Testwell'), null).status).toBe('connected');
  });
});

describe('messages', () => {
  it('every status has a plain message, a next step and an admin label, with no jargon', () => {
    for (const s of ['invited', 'connected', 'check_listing', 'no_access', 'waiting_google'] as const) {
      expect(SHOP_MESSAGES[s].title).toBeTruthy();
      expect(SHOP_MESSAGES[s].nextStep).toBeTruthy();
      expect(ADMIN_LABELS[s]).toBeTruthy();
      expect(JSON.stringify(SHOP_MESSAGES[s])).not.toMatch(/place[_ ]id|oauth|token|API/i);
    }
  });
});

describe('getManageableListings reads verification and place ID from metadata', () => {
  it('takes metadata.placeId and hasVoiceOfMerchant', async () => {
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/accounts') && !u.includes('/locations')) return new Response(JSON.stringify({ accounts: [{ name: 'accounts/1', role: 'OWNER', type: 'PERSONAL' }] }), { status: 200 });
      return new Response(JSON.stringify({ locations: [
        { name: 'locations/1', title: 'Testwell', metadata: { placeId: 'ChIJ1', hasVoiceOfMerchant: false } },
        { name: 'locations/2', title: 'Other', metadata: { mapsUri: 'https://maps.google.com/maps?cid=1&place_id=ChIJ2' } },
      ] }), { status: 200 });
    }) as any;
    const ls = await getManageableListings('t');
    expect(ls[0]).toMatchObject({ placeId: 'ChIJ1', hasVoiceOfMerchant: false });
    expect(ls[1].hasVoiceOfMerchant).toBeUndefined();
  });
});

describe('a shop we invited but hold no expected listing for', () => {
  const one = [{ accountName: 'accounts/1', accountDisplay: '', accountType: '', accountRole: 'OWNER', locationName: 'locations/1', title: 'Some Floors', address: '', category: '', placeId: 'ChIJx', hasVoiceOfMerchant: true }] as any;
  it('is "check listing" for a person to confirm, never "connected" on trust', () => {
    expect(detectOwnership(one, null, true)).toMatchObject({ status: 'check_listing', bind: one[0], needsPicker: false });
    expect(detectOwnership(one, null, true).detail).toMatch(/no expected listing on record/);
    expect(statusForChosenListing(one[0], null, true)).toMatchObject({ status: 'check_listing' });
  });
  it('an ordinary sign-in with no invitation is unchanged', () => {
    expect(detectOwnership(one, null).status).toBe('connected');
    expect(statusForChosenListing(one[0], null).status).toBe('connected');
  });
  it('still waits on Google if the listing is not verified, and still says so if the account manages nothing', () => {
    expect(detectOwnership([{ ...one[0], hasVoiceOfMerchant: false }], null, true).status).toBe('waiting_google');
    expect(detectOwnership([], null, true).status).toBe('no_access');
  });
  it('both places that bind a listing for an invited shop say so', async () => {
    const { readFileSync } = await import('node:fs');
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('../app/api/auth/callback/google/route.ts').match(/detectOwnership\(listings, expected\?\.placeId \?\? null, !!expected\)/g)).toHaveLength(2);
    expect(src('../app/api/listings/select/route.ts')).toMatch(/statusForChosenListing\(chosen, retailer\.place_id \?\? null, true\)/);
  });
  it('the shop is not told we expected a different listing when we expected none', () => {
    expect(shopConnectionMessage('check_listing', false).message).not.toMatch(/expected a different/);
    expect(shopConnectionMessage('check_listing', false).message).toMatch(/did not have a listing on record/);
    expect(shopConnectionMessage('check_listing', true)).toBe(SHOP_MESSAGES.check_listing);
    expect(shopConnectionMessage('waiting_google', false)).toBe(SHOP_MESSAGES.waiting_google);
  });
});
