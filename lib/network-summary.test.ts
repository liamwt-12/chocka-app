import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildNetworkSummary, MIN_DAYS_IN_MONTH } from './network-summary';

const T = (o: any = {}) => ({ searchViews: 0, mapsViews: 0, views: 0, calls: 0, websiteClicks: 0, directions: 0, conversations: 0, bookings: 0, daysWithData: 30, ...o });
const shop = (id: string, o: any = {}) => ({ retailerId: id, name: `Shop ${id}`, town: 'Town', pilotState: 'live', statusNote: null, connection: null, participating: true, joinedOn: '2026-09-01', scoreAtActivation: 40, postsLast30: 0, repliesLast30: 0, actionsChange: null, viewsChange: null, improvement: null, adStartDate: null, adSpend: null, adChange: null, ...o }) as any;
const entry = (id: string, band: string, change: number, rank = 1) => ({ rank, retailerId: id, name: `Shop ${id}`, town: 'Town', actionsChange: change, viewsChange: null, band }) as any;

describe('the monthly network summary', () => {
  it('counts shops by state', () => {
    const s = buildNetworkSummary([shop('a'), shop('b', { pilotState: 'connected_not_live', statusNote: { label: 'Check listing', why: '', action: '' } }), shop('c', { pilotState: 'invited', participating: false, statusNote: { label: 'Not opened', why: '', action: '' } }), shop('d', { pilotState: 'invite_expired', participating: false, statusNote: { label: 'Link expired', why: '', action: '' } }), shop('e', { pilotState: 'not_invited', participating: false })], { ranked: [] }, [], 'November 2026');
    expect(s.shops).toEqual({ total: 5, live: 1, connectedNotLive: 1, invited: 2, notInvited: 1 });
    expect(s.needingHelp).toEqual({ total: 3, byReason: [{ label: 'Check listing', count: 1 }, { label: 'Link expired', count: 1 }, { label: 'Not opened', count: 1 }] });
  });

  it('adds up the month across shops with a full month of figures only', () => {
    const s = buildNetworkSummary([shop('a'), shop('b'), shop('c')], { ranked: [] }, [
      { retailerId: 'a', thisMonth: T({ views: 1000, calls: 30, websiteClicks: 40, directions: 20 }), lastMonth: T({ views: 800, calls: 20, websiteClicks: 40, directions: 25 }) },
      { retailerId: 'b', thisMonth: T({ views: 500, calls: 10, websiteClicks: 5, directions: 5 }), lastMonth: T({ views: 9999, calls: 99, daysWithData: MIN_DAYS_IN_MONTH - 1 }) },
      { retailerId: 'c', thisMonth: T({ views: 7777, calls: 77, daysWithData: 5 }), lastMonth: T() },
    ], 'November 2026');
    const line = (label: RegExp) => s.totals.lines.find((l) => label.test(l.label))!;
    expect(line(/seen/).thisMonth).toBe(1500); // a + b; c has five days
    expect(line(/Calls/).thisMonth).toBe(40);
    // Compared like for like: only shop a has two full months. b joining part-way must not look like growth.
    expect(line(/seen/)).toMatchObject({ lastMonth: 800, change: 25 });
    expect(line(/Calls/)).toMatchObject({ lastMonth: 20, change: 50 });
    expect(line(/Website/)).toMatchObject({ change: 0 });
    expect(line(/Direction/)).toMatchObject({ change: -20 });
    expect(s.totals).toMatchObject({ shopsCounted: 2, shopsCompared: 1 });
    expect(s.totals.note).toMatch(/uses the 1 that have two full months/);
  });

  it('gives no percentage on a small base, and says so when there is nothing to compare', () => {
    const small = buildNetworkSummary([shop('a')], { ranked: [] }, [{ retailerId: 'a', thisMonth: T({ calls: 9 }), lastMonth: T({ calls: 3 }) }], 'm');
    expect(small.totals.lines.find((l) => /Calls/.test(l.label))).toMatchObject({ thisMonth: 9, lastMonth: 3, change: null });
    const first = buildNetworkSummary([shop('a')], { ranked: [] }, [{ retailerId: 'a', thisMonth: T({ calls: 9 }), lastMonth: T({ daysWithData: 0 }) }], 'm');
    expect(first.totals.lines[1]).toMatchObject({ lastMonth: null, change: null });
    expect(first.totals.note).toMatch(/No comparison yet/);
    expect(buildNetworkSummary([shop('a')], { ranked: [] }, [], 'm').totals.note).toMatch(/No shop has a full month/);
  });

  it('summarises improvement against each shop\'s own start, and the top five movers', () => {
    const ranked = [entry('a', 'Strong rise', 60, 1), entry('b', 'Rising', 20, 2), entry('c', 'Steady', 2, 3), entry('d', 'Falling', -30, 4), entry('e', 'Rising', 12, 5), entry('f', 'Steady', 0, 6)];
    const s = buildNetworkSummary(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => shop(id)), { ranked }, [], 'm');
    expect(s.improvement).toEqual({ rising: 3, steady: 2, falling: 1, tooEarly: 2, medianActionsChange: 7 });
    expect(s.topMovers.map((m) => m.name)).toEqual(['Shop a', 'Shop b', 'Shop c', 'Shop d', 'Shop e']);
  });

  it('lists shops with ads, their spend as entered, and what changed alongside', () => {
    const s = buildNetworkSummary([
      shop('a', { adStartDate: '2026-10-01', adSpend: '£250', adChange: { key: 'clear_rise', label: 'Clear rise', detail: 'up 30%', flag: false } }),
      shop('b', { adStartDate: '2026-10-01', adSpend: '£250', adChange: { key: 'no_clear_change', label: 'No clear change', detail: 'up 2%', flag: true } }),
      shop('c', { adStartDate: '2026-11-10', adSpend: null, adChange: { key: 'too_early', label: 'Too early to say', detail: '', flag: false } }),
      shop('d'),
    ], { ranked: [] }, [], 'm');
    expect(s.ads).toMatchObject({ withSpend: 2, clearRise: 1, noClearChange: 1, tooEarlyOrFew: 1, flagged: 1 });
    expect(s.ads.shops.map((a) => a.name)).toEqual(['Shop a', 'Shop b', 'Shop c']);
  });

  it('carries no contact detail and claims no cause', () => {
    const src = readFileSync(new URL('./network-summary.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/contact_email|phone_number|\.email\b/);
    const page = readFileSync(new URL('../app/console/console-client.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/They show what happened, not what caused it/);
    expect(page).not.toMatch(/because of (your|the) ads|thanks to|driven by/i);
  });
});
