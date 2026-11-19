import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { adVerdict, parseSpendPounds, formatPounds, adDatesProblem, CLEAR_CHANGE_PERCENT, MARGIN_OVER_NO_ADS, MIN_BASE_EVENTS, MIN_EXTRA_EVENTS } from './ad-spend';
import type { AdComparison, MetricChange } from './ad-comparison';

const W = { start: '2026-10-01', beforeFrom: '', beforeTo: '', afterFrom: '', afterTo: '', lastYearFrom: '', lastYearTo: '' };
const ch = (calls: [number, number], clicks: [number, number] = [0, 0], dirs: [number, number] = [0, 0]): MetricChange[] => [
  { key: 'views', label: '', before: 1000, after: 5000, percent: 400 }, // views never decide the verdict
  { key: 'calls', label: '', before: calls[0], after: calls[1], percent: null },
  { key: 'websiteClicks', label: '', before: clicks[0], after: clicks[1], percent: null },
  { key: 'directions', label: '', before: dirs[0], after: dirs[1], percent: null },
];
const ok = (shop: MetricChange[], network: MetricChange[] | null = null, basis: 'last_year' | 'weeks_before' = 'last_year'): AdComparison => ({ status: 'ok', basis, windows: W, shop, network: network ? { shops: 5, changes: network } : null });

describe('the "no clear change" rule', () => {
  it('a clear rise: up at least 10%, and at least 5 points better than shops with no ads', () => {
    const v = adVerdict(25000, ok(ch([40, 50], [40, 50], [20, 25]), ch([100, 102])));
    expect(v).toMatchObject({ key: 'clear_rise', change: 25, noAdsChange: 2, flag: false });
  });

  it('a rise the whole network shared is NOT a clear rise, and is flagged when money was spent', () => {
    const v = adVerdict(25000, ok(ch([100, 120]), ch([100, 118])));
    expect(v).toMatchObject({ key: 'no_clear_change', change: 20, noAdsChange: 18, flag: true });
    expect(v.detail).toMatch(/Shops with no ads changed by \+18%/);
  });

  it('a small wobble either way is no clear change', () => {
    expect(adVerdict(25000, ok(ch([100, 106]), ch([100, 100]))).key).toBe('no_clear_change');
    expect(adVerdict(25000, ok(ch([100, 94]), ch([100, 100]))).key).toBe('no_clear_change');
  });

  it('a fall is a fall only if the network did not fall with it', () => {
    expect(adVerdict(25000, ok(ch([100, 80]), ch([100, 100])))).toMatchObject({ key: 'fall', flag: true });
    expect(adVerdict(25000, ok(ch([100, 80]), ch([100, 78]))).key).toBe('no_clear_change'); // a bad month for everyone
  });

  it('with too few no-ads shops to compare, the 10% line alone decides, and it says so', () => {
    const v = adVerdict(25000, ok(ch([100, 115])));
    expect(v.key).toBe('clear_rise');
    expect(v.detail).toMatch(/not enough shops without ads/);
  });

  it('a rise must also be at least three more actions: ten to eleven is one phone call', () => {
    expect(adVerdict(1, ok(ch([10, 11]))).key).toBe('no_clear_change');   // +10%, one more action
    expect(adVerdict(1, ok(ch([10, 12]))).key).toBe('no_clear_change');   // +20%, two more
    expect(adVerdict(1, ok(ch([10, 13]))).key).toBe('clear_rise');        // +30%, three more
    expect(adVerdict(1, ok(ch([20, 22]))).key).toBe('no_clear_change');   // +10%, two more
    expect(adVerdict(1, ok(ch([20, 23]))).key).toBe('clear_rise');
  });
  it('and a fall must be at least three fewer', () => {
    expect(adVerdict(1, ok(ch([10, 8]))).key).toBe('no_clear_change');    // -20%, two fewer
    expect(adVerdict(1, ok(ch([10, 7]))).key).toBe('fall');
    // Harder to earn in both directions, so a spend is still flagged when nothing clearly moved.
    expect(adVerdict(25000, ok(ch([10, 11]))).flag).toBe(true);
  });

  it('says what the change is measured against', () => {
    expect(adVerdict(1, ok(ch([100, 130]))).detail).toMatch(/against the same four weeks last year/);
    const fallback = adVerdict(1, ok(ch([100, 130]), null, 'weeks_before'));
    expect(fallback.detail).toMatch(/against the four weeks before \(there are no figures from the same weeks last year\)/);
    expect(adVerdict(1, ok(ch([4, 9]), null, 'last_year')).detail).toMatch(/same four weeks last year/);
    expect(adVerdict(1, ok(ch([4, 9]), null, 'weeks_before')).detail).toMatch(/four weeks before its ads/);
  });

  it('the thresholds are the documented numbers', () => {
    expect([CLEAR_CHANGE_PERCENT, MARGIN_OVER_NO_ADS, MIN_BASE_EVENTS, MIN_EXTRA_EVENTS]).toEqual([10, 5, 10, 3]);
    expect(adVerdict(1, ok(ch([100, 110]), ch([100, 105]))).key).toBe('clear_rise');
    expect(adVerdict(1, ok(ch([100, 109]), ch([100, 100]))).key).toBe('no_clear_change');
    expect(adVerdict(1, ok(ch([100, 110]), ch([100, 106]))).key).toBe('no_clear_change');
  });
});

describe('never a verdict on thin evidence, and never a flag without spend', () => {
  it('too early, not enough history, and too few actions are said as such and never flagged', () => {
    expect(adVerdict(25000, { status: 'too_early', windows: W, readyOn: '2026-11-05', message: '' })).toMatchObject({ key: 'too_early', flag: false });
    expect(adVerdict(25000, { status: 'not_enough_history', windows: W, message: '' })).toMatchObject({ key: 'not_enough_history', flag: false });
    // Nine customer actions in the four weeks before: too few. Ten: enough.
    expect(adVerdict(25000, ok(ch([4, 9], [3, 9], [2, 3])))).toMatchObject({ key: 'too_few', flag: false, change: null });
    expect(adVerdict(25000, ok(ch([5, 5], [3, 3], [2, 2]))).key).toBe('no_clear_change');
  });
  it('no spend entered: the verdict stands, but nothing is flagged', () => {
    for (const spend of [null, undefined, 0]) expect(adVerdict(spend, ok(ch([100, 100]))).flag).toBe(false);
  });
  it('no ad dates: says so', () => {
    expect(adVerdict(25000, null).key).toBe('no_ads');
  });
  it('never states a raw count, a cost per anything, or a cause', () => {
    const all = [adVerdict(25000, ok(ch([137, 170]), ch([211, 215]))), adVerdict(25000, ok(ch([137, 139]))), adVerdict(25000, ok(ch([137, 90])))];
    for (const v of all) {
      expect(v.detail).not.toMatch(/137|170|211|215|139|\b90\b/);
      expect(`${v.label} ${v.detail}`).not.toMatch(/per call|cost per|because of|caused|thanks to|result of|return on/i);
    }
  });
});

describe('typing the amount in', () => {
  it('reads pounds, with or without the sign, commas or pence', () => {
    expect(parseSpendPounds('250')).toBe(25000);
    expect(parseSpendPounds('£1,250.50')).toBe(125050);
    expect(parseSpendPounds(' 0 ')).toBe(0);
    expect(parseSpendPounds('')).toBeNull();
    expect(parseSpendPounds(null)).toBeNull();
  });
  it('refuses anything that is not a sensible amount', () => {
    for (const bad of ['-5', 'abc', '12.345', '1e6', '99999999', '£']) expect(parseSpendPounds(bad)).toBeUndefined();
  });
  it('shows it back plainly', () => {
    expect(formatPounds(25000)).toBe('£250');
    expect(formatPounds(125050)).toBe('£1,250.50');
    expect(formatPounds(null)).toBe('');
  });
  it('the ads cannot end before they start', () => {
    expect(adDatesProblem('2026-10-01', '2026-09-30')).toMatch(/cannot end before/);
    expect(adDatesProblem(null, '2026-10-30')).toMatch(/started before/);
    expect(adDatesProblem('2026-10-01', '2026-10-30')).toBeNull();
    expect(adDatesProblem('2026-10-01', null)).toBeNull();
  });
});

describe('spend is for Tarkett and admin only', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  it('nothing that writes to a shop ever reads the spend', () => {
    for (const f of ['./email.ts', './ad-comparison.ts', './monthly-report.ts', './welcome.ts', '../app/api/cron/monthly-report/route.ts', '../app/api/cron/monday-stats/route.ts', '../app/api/dashboard/route.ts', '../app/dashboard/page.tsx', '../app/settings/page.tsx']) {
      expect(src(f)).not.toMatch(/ad_spend|adSpend|ad-spend/);
    }
  });
  it('the console shows it, with the "what changed, not what caused it" line', () => {
    expect(src('../app/console/console-client.tsx')).toMatch(/Ad spend/);
    expect(src('../app/console/console-client.tsx')).toMatch(/what changed, not what caused it/);
    expect(src('./console-data.ts')).toMatch(/adVerdict\(/);
  });
});
