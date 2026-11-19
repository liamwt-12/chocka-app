import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildNetworkSummary, MIN_SHOPS_FOR_TOTALS } from './network-summary';

const NOV = { label: 'November 2026', days: 30, daysBefore: 31, complete: true };

const T = (o: any = {}) => ({ searchViews: 0, mapsViews: 0, views: 0, calls: 0, websiteClicks: 0, directions: 0, conversations: 0, bookings: 0, daysWithData: 30, ...o });
const shop = (id: string, o: any = {}) => ({ retailerId: id, name: `Shop ${id}`, town: 'Town', pilotState: 'live', statusNote: null, connection: null, participating: true, joinedOn: '2026-09-01', scoreAtActivation: 40, postsLast30: 0, repliesLast30: 0, actionsChange: null, viewsChange: null, improvement: null, adStartDate: null, adSpend: null, adChange: null, ...o }) as any;
const entry = (id: string, band: string, change: number, rank = 1) => ({ rank, retailerId: id, name: `Shop ${id}`, town: 'Town', actionsChange: change, viewsChange: null, band }) as any;

describe('the monthly network summary', () => {
  it('counts shops by state', () => {
    const s = buildNetworkSummary([shop('a'), shop('b', { pilotState: 'connected_not_live', statusNote: { label: 'Check listing', why: '', action: '' } }), shop('c', { pilotState: 'invited', participating: false, statusNote: { label: 'Not opened', why: '', action: '' } }), shop('d', { pilotState: 'invite_expired', participating: false, statusNote: { label: 'Link expired', why: '', action: '' } }), shop('e', { pilotState: 'not_invited', participating: false })], { ranked: [] }, [], 'November 2026');
    expect(s.shops).toEqual({ total: 5, live: 1, connectedNotLive: 1, invited: 2, notInvited: 1 });
    expect(s.notLive).toEqual({ total: 3, byReason: [{ label: 'Check listing', count: 1 }, { label: 'Link expired', count: 1 }, { label: 'Not opened', count: 1 }] });
  });

  const M = (id: string, now: any, before: any) => ({ retailerId: id, thisMonth: T({ daysWithData: 30, ...now }), lastMonth: T({ daysWithData: 31, ...before }) });
  const line = (s: any, label: RegExp) => s.totals.lines.find((l: any) => label.test(l.label))!;

  it('adds up the month, and compares the same shops per day', () => {
    const s = buildNetworkSummary([], { ranked: [] }, [
      M('a', { views: 1000, calls: 30 }, { views: 1033, calls: 31 }),
      M('b', { views: 500, calls: 30 }, { views: 517, calls: 31 }),
      M('c', { views: 300, calls: 30 }, { views: 310, calls: 0 }),
      { retailerId: 'd', thisMonth: T({ views: 7777, calls: 77, daysWithData: 5 }), lastMonth: T() }, // five days: not counted at all
    ], NOV);
    expect(line(s, /seen/)).toMatchObject({ thisMonth: 1800, sameShopsThisMonth: 1800, lastMonth: 1860, change: 0 }); // 30 days against 31: no change per day
    expect(line(s, /Calls/)).toMatchObject({ thisMonth: 90, lastMonth: 62, change: 50 });
    expect(s.totals).toMatchObject({ shopsCounted: 3, shopsCompared: 3 });
    expect(s.totals.note).toMatch(/same shops, per day/);
  });

  it('a row reconciles: the comparison shows this month for the SAME shops, beside the all-shops total', () => {
    const joined = (id: string) => ({ retailerId: id, thisMonth: T({ views: 100, daysWithData: 30 }), lastMonth: T({ views: 999, daysWithData: 10 }) });
    const s = buildNetworkSummary([], { ranked: [] }, [M('a', { views: 300 }, { views: 310 }), M('b', { views: 300 }, { views: 310 }), M('c', { views: 300 }, { views: 310 }), joined('x'), joined('y'), joined('z')], NOV);
    expect(line(s, /seen/)).toEqual({ label: 'Times shops were seen on Google', thisMonth: 1200, sameShopsThisMonth: 900, lastMonth: 930, change: 0 });
    expect(s.totals.note).toMatch(/uses the 3 that have two full months/);
  });

  it('never shows a total that is one or two shops\' own figures, or lets one be had by subtraction', () => {
    expect(MIN_SHOPS_FOR_TOTALS).toBe(3);
    const two = buildNetworkSummary([], { ranked: [] }, [M('a', { calls: 30 }, { calls: 30 }), M('b', { calls: 30 }, { calls: 30 })], NOV);
    expect(two.totals.lines).toEqual([]);
    expect(two.totals.note).toMatch(/Only 2 shops have a full month/);
    // Four counted, three comparable: the fourth's figures would be total minus the rest. No comparison.
    const four = buildNetworkSummary([], { ranked: [] }, [M('a', { calls: 30 }, { calls: 30 }), M('b', { calls: 30 }, { calls: 30 }), M('c', { calls: 30 }, { calls: 30 }), { retailerId: 'x', thisMonth: T({ calls: 9, daysWithData: 30 }), lastMonth: T({ daysWithData: 3 }) }], NOV);
    expect(line(four, /Calls/)).toMatchObject({ thisMonth: 99, sameShopsThisMonth: null, lastMonth: null, change: null });
  });

  it('holds the comparison until Google\'s late days are in, and gives no percentage on a small base', () => {
    const three = [M('a', { calls: 3 }, { calls: 2 }), M('b', { calls: 3 }, { calls: 2 }), M('c', { calls: 3 }, { calls: 2 })];
    const early = buildNetworkSummary([], { ranked: [] }, three, { ...NOV, complete: false });
    expect(line(early, /Calls/)).toMatchObject({ thisMonth: 9, lastMonth: null, change: null });
    expect(early.totals.note).toMatch(/not all in yet/);
    expect(line(buildNetworkSummary([], { ranked: [] }, three, NOV), /Calls/)).toMatchObject({ lastMonth: 6, change: null });
    expect(buildNetworkSummary([], { ranked: [] }, [], NOV).totals.note).toMatch(/No shop has a full month/);
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
    expect(src).not.toMatch(/worth it/);
    expect(page).not.toMatch(/because of (your|the) ads|thanks to|driven by/i);
  });
});
