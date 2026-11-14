import { describe, it, expect, vi } from 'vitest';
import { detectOwnership, statusForChosenListing, SHOP_MESSAGES, ADMIN_LABELS } from './ownership';
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
    const r = detectOwnership([L('Other'), L('Arbons', 'ChIJ1'), L('Third')], 'ChIJ1');
    expect(r.status).toBe('connected');
    expect(r.bind?.title).toBe('Arbons');
    expect(r.needsPicker).toBe(false);
  });

  it('expected listing not verified yet: waiting on Google (still bound, so it picks up later)', () => {
    const r = detectOwnership([L('Arbons', 'ChIJ1', false)], 'ChIJ1');
    expect(r.status).toBe('waiting_google');
    expect(r.bind?.title).toBe('Arbons');
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
    expect(detectOwnership([L('Arbons', 'ChIJ1', undefined)], 'ChIJ1').status).toBe('connected');
  });
});

describe('statusForChosenListing', () => {
  it('matches, mismatches, unverified, and no baseline', () => {
    expect(statusForChosenListing(L('Arbons', 'ChIJ1'), 'ChIJ1').status).toBe('connected');
    expect(statusForChosenListing(L('Other', 'ChIJ2'), 'ChIJ1').status).toBe('check_listing');
    expect(statusForChosenListing(L('Arbons', 'ChIJ1', false), 'ChIJ1').status).toBe('waiting_google');
    expect(statusForChosenListing(L('Arbons'), null).status).toBe('connected');
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
        { name: 'locations/1', title: 'Arbons', metadata: { placeId: 'ChIJ1', hasVoiceOfMerchant: false } },
        { name: 'locations/2', title: 'Other', metadata: { mapsUri: 'https://maps.google.com/maps?cid=1&place_id=ChIJ2' } },
      ] }), { status: 200 });
    }) as any;
    const ls = await getManageableListings('t');
    expect(ls[0]).toMatchObject({ placeId: 'ChIJ1', hasVoiceOfMerchant: false });
    expect(ls[1].hasVoiceOfMerchant).toBeUndefined();
  });
});
