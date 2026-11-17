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
    expect(line(s, /seen/)).toMatchObject({ thisMonth: 1800, sameShopsThisMonth: 1800, before: 1860, change: 0 }); // 30 days against 31: no change per day
    expect(line(s, /Calls/)).toMatchObject({ thisMonth: 90, before: 62, change: 50 });
    expect(s.totals).toMatchObject({ shopsCounted: 3, shopsCompared: 3 });
    // None of these shops has figures from last year, so it falls back to the month before, and says so.
    expect(s.totals).toMatchObject({ basis: 'month_before', beforeLabel: 'the month before' });
    expect(s.totals.note).toMatch(/Too few shops have figures from the same month last year, so this is compared with the month before, per day/);
  });

  it('a row reconciles: the comparison shows this month for the SAME shops, beside the all-shops total', () => {
    const joined = (id: string) => ({ retailerId: id, thisMonth: T({ views: 100, daysWithData: 30 }), lastMonth: T({ views: 999, daysWithData: 10 }) });
    const s = buildNetworkSummary([], { ranked: [] }, [M('a', { views: 300 }, { views: 310 }), M('b', { views: 300 }, { views: 310 }), M('c', { views: 300 }, { views: 310 }), joined('x'), joined('y'), joined('z')], NOV);
    expect(line(s, /seen/)).toEqual({ label: 'Times shops were seen on Google', thisMonth: 1200, sameShopsThisMonth: 900, before: 930, change: 0 });
    expect(s.totals.note).toMatch(/uses the 3 that have both months in full/);
  });

  it('never shows a total that is one or two shops\' own figures, or lets one be had by subtraction', () => {
    expect(MIN_SHOPS_FOR_TOTALS).toBe(3);
    const two = buildNetworkSummary([], { ranked: [] }, [M('a', { calls: 30 }, { calls: 30 }), M('b', { calls: 30 }, { calls: 30 })], NOV);
    expect(two.totals.lines).toEqual([]);
    expect(two.totals.note).toMatch(/Only 2 shops have a full month/);
    // Four counted, three comparable: the fourth's figures would be total minus the rest. No comparison.
    const four = buildNetworkSummary([], { ranked: [] }, [M('a', { calls: 30 }, { calls: 30 }), M('b', { calls: 30 }, { calls: 30 }), M('c', { calls: 30 }, { calls: 30 }), { retailerId: 'x', thisMonth: T({ calls: 9, daysWithData: 30 }), lastMonth: T({ daysWithData: 3 }) }], NOV);
    expect(line(four, /Calls/)).toMatchObject({ thisMonth: 99, sameShopsThisMonth: null, before: null, change: null });
    expect(four.totals).toMatchObject({ basis: null, beforeLabel: null });
  });

  it('holds the comparison until Google\'s late days are in, and gives no percentage on a small base', () => {
    const three = [M('a', { calls: 3 }, { calls: 2 }), M('b', { calls: 3 }, { calls: 2 }), M('c', { calls: 3 }, { calls: 2 })];
    const early = buildNetworkSummary([], { ranked: [] }, three, { ...NOV, complete: false });
    expect(line(early, /Calls/)).toMatchObject({ thisMonth: 9, before: null, change: null });
    expect(early.totals.note).toMatch(/not all in yet/);
    expect(line(buildNetworkSummary([], { ranked: [] }, three, NOV), /Calls/)).toMatchObject({ before: 6, change: null });
    expect(buildNetworkSummary([], { ranked: [] }, [], NOV).totals.note).toMatch(/No shop has a full month/);
  });

  describe('compared with the same month last year', () => {
    const SPAN = { ...NOV, lastYearLabel: 'November 2025', daysLastYear: 30 };
    const Y = (id: string, now: any, lastYear: any, monthBefore: any = {}) => ({ retailerId: id, thisMonth: T({ daysWithData: 30, ...now }), lastMonth: T({ daysWithData: 31, ...monthBefore }), sameMonthLastYear: T({ daysWithData: 30, ...lastYear }) });

    it('uses last year when three shops have it, and names the month', () => {
      // Against October these shops are well up. Against last November they are level: it was the season.
      const s = buildNetworkSummary([], { ranked: [] }, [
        Y('a', { calls: 60 }, { calls: 60 }, { calls: 31 }), Y('b', { calls: 60 }, { calls: 60 }, { calls: 31 }), Y('c', { calls: 60 }, { calls: 60 }, { calls: 31 }),
      ], SPAN);
      expect(s.totals).toMatchObject({ basis: 'last_year', beforeLabel: 'November 2025', shopsCompared: 3 });
      expect(line(s, /Calls/)).toMatchObject({ thisMonth: 180, sameShopsThisMonth: 180, before: 180, change: 0 });
      expect(s.totals.note).toMatch(/Compared with November 2025 for the same shops, per day, so the time of year is not counted as a change/);
    });

    it('is per day: February in a leap year against an ordinary February is not a rise', () => {
      const FEB = { label: 'February 2028', days: 29, daysBefore: 31, complete: true, lastYearLabel: 'February 2027', daysLastYear: 28 };
      const f = (id: string) => ({ retailerId: id, thisMonth: T({ daysWithData: 29, calls: 290 }), lastMonth: T({ daysWithData: 31 }), sameMonthLastYear: T({ daysWithData: 28, calls: 280 }) });
      expect(line(buildNetworkSummary([], { ranked: [] }, [f('a'), f('b'), f('c')], FEB), /Calls/)).toMatchObject({ before: 840, change: 0 });
    });

    it('uses only the shops that have last year, and never lets the others be had by subtraction', () => {
      const newListing = (id: string) => ({ retailerId: id, thisMonth: T({ daysWithData: 30, calls: 10 }), lastMonth: T({ daysWithData: 31, calls: 10 }), sameMonthLastYear: T({ daysWithData: 0 }) });
      const three = [Y('a', { calls: 60 }, { calls: 40 }), Y('b', { calls: 60 }, { calls: 40 }), Y('c', { calls: 60 }, { calls: 40 })];
      // Three with last year and three without: compared on the three.
      const s = buildNetworkSummary([], { ranked: [] }, [...three, newListing('x'), newListing('y'), newListing('z')], SPAN);
      expect(s.totals).toMatchObject({ basis: 'last_year', shopsCounted: 6, shopsCompared: 3 });
      expect(line(s, /Calls/)).toMatchObject({ thisMonth: 210, sameShopsThisMonth: 180, before: 120, change: 50 });
      // Three with last year and ONE without: that one's figures would be total minus the rest, so
      // last year is not used. All four have the month before, so it falls back to that.
      const s2 = buildNetworkSummary([], { ranked: [] }, [...three, newListing('x')], SPAN);
      expect(s2.totals.basis).toBe('month_before');
    });

    it('a month of noughts from before a listing existed is not "last year": it cannot make a newer shop look like growth', () => {
      // Google can return a nought for every day before a listing existed: 30 stored days, no figures.
      const zeroFilled = (id: string) => ({ retailerId: id, thisMonth: T({ daysWithData: 30, calls: 40, views: 400 }), lastMonth: T({ daysWithData: 31, calls: 40, views: 400 }), sameMonthLastYear: T({ daysWithData: 30 }) });
      const steady = (id: string) => Y(id, { calls: 40, views: 400 }, { calls: 40, views: 400 }, { calls: 40, views: 400 });
      const s = buildNetworkSummary([], { ranked: [] }, [steady('a'), steady('b'), steady('c'), zeroFilled('x'), zeroFilled('y'), zeroFilled('z')], SPAN);
      expect(s.totals).toMatchObject({ basis: 'last_year', shopsCompared: 3 });
      expect(line(s, /Calls/)).toMatchObject({ sameShopsThisMonth: 120, before: 120, change: 0 });   // not 240 against 120
    });

    it('says the real reason when last year is not used because it would leave out only one or two shops', () => {
      const newListing = (id: string) => ({ retailerId: id, thisMonth: T({ daysWithData: 30, calls: 10 }), lastMonth: T({ daysWithData: 31, calls: 10 }), sameMonthLastYear: T({ daysWithData: 0 }) });
      const s = buildNetworkSummary([], { ranked: [] }, [Y('a', { calls: 60 }, { calls: 40 }), Y('b', { calls: 60 }, { calls: 40 }), Y('c', { calls: 60 }, { calls: 40 }), newListing('x')], SPAN);
      expect(s.totals.note).toMatch(/would leave out only one or two shops, whose figures could then be worked out/);
    });

    it('falls back to the month before when fewer than three shops have last year, and says so', () => {
      const s = buildNetworkSummary([], { ranked: [] }, [Y('a', { calls: 60 }, { calls: 40 }, { calls: 62 }), { ...Y('b', { calls: 60 }, {}, { calls: 62 }), sameMonthLastYear: undefined }, { ...Y('c', { calls: 60 }, {}, { calls: 62 }), sameMonthLastYear: T({ daysWithData: 4 }) }], SPAN);
      expect(s.totals).toMatchObject({ basis: 'month_before', beforeLabel: 'the month before' });
      expect(line(s, /Calls/)).toMatchObject({ before: 186, change: 0 });
      expect(s.totals.note).toMatch(/The time of year affects that comparison/);
    });

    it('still waits for Google\'s late days, and still gives no percentage on a small base', () => {
      const three = [Y('a', { calls: 3 }, { calls: 2 }), Y('b', { calls: 3 }, { calls: 2 }), Y('c', { calls: 3 }, { calls: 2 })];
      expect(buildNetworkSummary([], { ranked: [] }, three, { ...SPAN, complete: false }).totals.basis).toBeNull();
      expect(line(buildNetworkSummary([], { ranked: [] }, three, SPAN), /Calls/)).toMatchObject({ before: 6, change: null });
    });
  });

  it('summarises improvement on last year, and the top five movers', () => {
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
