import { describe, it, expect } from 'vitest';
import { decideRecheck, recheckConnection } from './connection-check';

const L = (o: any = {}) => ({ accountName: 'accounts/1', accountDisplay: '', accountType: '', accountRole: 'OWNER', locationName: 'locations/1', title: 'Bare Carpets', address: '', category: '', placeId: 'PID-B', hasVoiceOfMerchant: true, ...o });

describe('decideRecheck', () => {
  it('right listing, verified: connected', () => {
    expect(decideRecheck([L()], 'locations/1', 'PID-B').status).toBe('connected');
  });
  it('Google finishes verifying: waiting turns into connected', () => {
    expect(decideRecheck([L({ hasVoiceOfMerchant: false })], 'locations/1', 'PID-B').status).toBe('waiting_google');
    expect(decideRecheck([L({ hasVoiceOfMerchant: true })], 'locations/1', 'PID-B').status).toBe('connected');
  });
  it('a different listing stays "check listing"', () => {
    expect(decideRecheck([L({ placeId: 'PID-OTHER' })], 'locations/1', 'PID-B')).toMatchObject({ status: 'check_listing' });
  });
  it('the listing has gone from the account', () => {
    expect(decideRecheck([L({ locationName: 'locations/2' })], 'locations/1', 'PID-B').detail).toMatch(/no longer manages the listing/);
    expect(decideRecheck([], 'locations/1', 'PID-B').detail).toMatch(/no longer manages any listing/);
  });
  it('nothing to compare against is never taken as a match', () => {
    // No expected listing on record: nothing to match, so a person confirms it.
    expect(decideRecheck([L()], 'locations/1', null).status).toBe('check_listing');
    // Google giving nothing to compare with is NOT a match: the hold stays until a person looks.
    expect(decideRecheck([L({ placeId: undefined })], 'locations/1', 'PID-B').status).toBe('check_listing');
  });
});

describe('recheckConnection', () => {
  const db = () => { const updates: any[] = []; return { updates, from: () => ({ update: (p: any) => ({ eq: async (_c: string, id: string) => { updates.push({ id, ...p }); return { error: null }; } }) }) }; };
  const now = new Date('2026-11-20T10:00:00Z');

  it('records the new status and when it was checked', async () => {
    const d = db();
    const r = await recheckConnection(d, { id: 'shop', place_id: 'PID-B', connection_status: 'waiting_google' }, 'locations/1', async () => [L()], now);
    expect(r?.status).toBe('connected');
    expect(d.updates[0]).toMatchObject({ id: 'shop', connection_status: 'connected', connection_checked_at: now.toISOString() });
    expect('listing_confirmed_at' in d.updates[0]).toBe(false);
  });

  it('a shop with no expected listing is "check listing", and a person\'s confirmation is left alone day after day', async () => {
    const d = db();
    const r = await recheckConnection(d, { id: 'shop', place_id: null, connection_status: 'connected' }, 'locations/1', async () => [L()], now);
    expect(r?.status).toBe('check_listing');
    expect(d.updates[0]).toMatchObject({ connection_status: 'check_listing' });
    expect('listing_confirmed_at' in d.updates[0]).toBe(false); // never cleared by this
  });

  it('a busy Google changes nothing', async () => {
    const d = db();
    expect(await recheckConnection(d, { id: 'shop', place_id: 'PID-B' }, 'locations/1', async () => { throw new Error('429'); }, now)).toBeNull();
    expect(d.updates).toEqual([]);
  });

  it('a listing that has gone withdraws an earlier "this is right"', async () => {
    const d = db();
    await recheckConnection(d, { id: 'shop', place_id: 'PID-B', connection_status: 'check_listing' }, 'locations/1', async () => [], now);
    expect(d.updates[0].listing_confirmed_at).toBeNull();
  });

  it('a mismatch that a person confirmed keeps its confirmation', async () => {
    const d = db();
    await recheckConnection(d, { id: 'shop', place_id: 'PID-B', connection_status: 'check_listing' }, 'locations/1', async () => [L({ placeId: 'PID-OTHER' })], now);
    expect('listing_confirmed_at' in d.updates[0]).toBe(false);
  });
});
