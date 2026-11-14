import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseMultiDailyMetrics, totalsFor, previousMonth, lastReportableDate, syncDailyMetrics,
  pickProfilesToSync, addDaysIso, HISTORY_DAYS, RESYNC_DAYS, type MetricRow,
} from './metrics';
import { fetchDailyMetrics, getPerformanceMetrics } from './google';
import { monthlyReportEmail } from './email';

/** A Google fetchMultiDailyMetricsTimeSeries body for the given metric -> {date: value}. */
function googleBody(series: Record<string, Record<string, number | undefined>>) {
  return {
    multiDailyMetricTimeSeries: [{
      dailyMetricTimeSeries: Object.entries(series).map(([dailyMetric, days]) => ({
        dailyMetric,
        timeSeries: {
          datedValues: Object.entries(days).map(([d, v]) => {
            const [year, month, day] = d.split('-').map(Number);
            return v === undefined ? { date: { year, month, day } } : { date: { year, month, day }, value: String(v) };
          }),
        },
      })),
    }],
  };
}

describe('parseMultiDailyMetrics', () => {
  it('flattens the response and treats a missing value as zero', () => {
    const rows = parseMultiDailyMetrics(googleBody({ CALL_CLICKS: { '2026-10-01': 3, '2026-10-02': undefined } }));
    expect(rows).toEqual([
      { date: '2026-10-01', metric: 'CALL_CLICKS', value: 3 },
      { date: '2026-10-02', metric: 'CALL_CLICKS', value: 0 },
    ]);
  });
  it('survives an empty or odd body', () => {
    expect(parseMultiDailyMetrics({})).toEqual([]);
    expect(parseMultiDailyMetrics(null)).toEqual([]);
  });
});

describe('totalsFor', () => {
  const rows: MetricRow[] = [];
  // October 2026: every day 10 search, 5 maps, 1 call, 2 clicks, 1 direction.
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    rows.push({ date, metric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', value: 6 });
    rows.push({ date, metric: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', value: 4 });
    rows.push({ date, metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 5 });
    rows.push({ date, metric: 'CALL_CLICKS', value: 1 });
    rows.push({ date, metric: 'WEBSITE_CLICKS', value: 2 });
    rows.push({ date, metric: 'BUSINESS_DIRECTION_REQUESTS', value: 1 });
  }

  it('sums a month exactly once per day: the 4x overcount cannot happen', () => {
    const t = totalsFor(rows, '2026-10-01', '2026-10-31');
    expect(t).toMatchObject({ searchViews: 310, mapsViews: 155, views: 465, calls: 31, websiteClicks: 62, directions: 31, daysWithData: 31 });
  });

  it('counts Google Search, not only Maps', () => {
    expect(totalsFor(rows, '2026-10-01', '2026-10-01').searchViews).toBe(10);
  });

  it('respects the period boundaries', () => {
    expect(totalsFor(rows, '2026-10-10', '2026-10-16').calls).toBe(7);
  });
});

describe('dates', () => {
  it('previousMonth', () => {
    expect(previousMonth(new Date('2026-12-01T09:00:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(previousMonth(new Date('2026-01-01T09:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('never reports the most recent days', () => {
    expect(lastReportableDate(new Date('2026-11-14T12:00:00Z'))).toBe('2026-11-09');
  });
});

function fakeDb() {
  const upserts: any[] = [];
  const updates: any[] = [];
  return {
    upserts, updates,
    from: (t: string) => ({
      upsert: async (rows: any[]) => { upserts.push(...rows.map((r) => ({ t, ...r }))); return { error: null }; },
      update: (patch: any) => ({ eq: async (_c: string, id: string) => { updates.push({ t, id, ...patch }); return { error: null }; } }),
    }),
  };
}

describe('syncDailyMetrics', () => {
  const NOW = new Date('2026-11-14T06:00:00Z');

  it('first sync pulls about 18 months and records the baseline start', async () => {
    const db = fakeDb();
    const fetchRange = vi.fn(async () => [{ date: '2025-06-01', metric: 'CALL_CLICKS', value: 2 }, { date: '2026-11-12', metric: 'CALL_CLICKS', value: 1 }]);
    const r = await syncDailyMetrics(db, { id: 'p1', metrics_backfilled_at: null }, fetchRange, NOW);
    expect(r.mode).toBe('backfill');
    expect(fetchRange).toHaveBeenCalledWith(addDaysIso('2026-11-13', -HISTORY_DAYS), '2026-11-13');
    expect(db.upserts).toHaveLength(2);
    expect(db.updates[0]).toMatchObject({ id: 'p1', metrics_history_start: '2025-06-01' });
    expect(db.updates[0].metrics_backfilled_at).toBeTruthy();
  });

  it('later syncs re-fetch only the last few days, and leave the baseline alone', async () => {
    const db = fakeDb();
    const fetchRange = vi.fn(async () => []);
    const r = await syncDailyMetrics(db, { id: 'p1', metrics_backfilled_at: '2026-11-01T00:00:00Z' }, fetchRange, NOW);
    expect(r.mode).toBe('resync');
    expect(fetchRange).toHaveBeenCalledWith(addDaysIso('2026-11-13', -RESYNC_DAYS), '2026-11-13');
    expect(db.updates[0].metrics_history_start).toBeUndefined();
  });
});

describe('pickProfilesToSync', () => {
  const NOW = new Date('2026-11-14T12:00:00Z');
  const u = (id: string, p: any) => ({ id, profiles: [{ id, google_location_name: 'locations/x', ...p }] });

  it('puts never-backfilled first, skips recently synced, and skips unbound listings', () => {
    const users = [
      u('old', { metrics_backfilled_at: '2026-10-01', metrics_synced_at: '2026-11-12T00:00:00Z' }),
      u('fresh', { metrics_backfilled_at: '2026-10-01', metrics_synced_at: '2026-11-14T10:00:00Z' }),
      u('new', { metrics_backfilled_at: null }),
      { id: 'unbound', profiles: [{ id: 'unbound', google_location_name: null }] },
    ];
    expect(pickProfilesToSync(users, NOW).map((x) => x.profile.id)).toEqual(['new', 'old']);
  });
});

describe('fetchDailyMetrics (mocked Google)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('asks for every metric, including Search, in one request', async () => {
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: any) => { urls.push(String(url)); return new Response(JSON.stringify(googleBody({ CALL_CLICKS: { '2026-11-01': 4 } })), { status: 200 }); }) as any;
    const rows = await fetchDailyMetrics('t', 'locations/1', '2026-10-01', '2026-11-13');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('fetchMultiDailyMetricsTimeSeries');
    expect(urls[0]).toContain('dailyMetrics=BUSINESS_IMPRESSIONS_DESKTOP_SEARCH');
    expect(urls[0]).toContain('dailyMetrics=BUSINESS_IMPRESSIONS_MOBILE_SEARCH');
    expect(urls[0]).toContain('dailyRange.startDate.year=2026&dailyRange.startDate.month=10&dailyRange.startDate.day=1');
    expect(rows).toEqual([{ date: '2026-11-01', metric: 'CALL_CLICKS', value: 4 }]);
  });

  it('retries a refused 18-month range with 12 months, then 6', async () => {
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      return urls.length < 3 ? new Response('range too long', { status: 400 }) : new Response(JSON.stringify({}), { status: 200 });
    }) as any;
    await fetchDailyMetrics('t', 'locations/1', addDaysIso('2026-11-13', -540), '2026-11-13');
    expect(urls).toHaveLength(3);
    expect(urls[1]).toContain('startDate.year=2025&dailyRange.startDate.month=11&dailyRange.startDate.day=13');
  });

  it('does not retry other errors', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 403 })) as any;
    await expect(fetchDailyMetrics('t', 'locations/1', '2025-01-01', '2026-11-13')).rejects.toThrow(/403/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('getPerformanceMetrics now includes Search in views', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const today = new Date();
    const d = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    global.fetch = vi.fn(async () => new Response(JSON.stringify(googleBody({
      BUSINESS_IMPRESSIONS_MOBILE_SEARCH: { [d]: 40 }, BUSINESS_IMPRESSIONS_MOBILE_MAPS: { [d]: 10 }, CALL_CLICKS: { [d]: 2 },
    })), { status: 200 })) as any;
    const m = await getPerformanceMetrics('t', 'locations/1');
    expect(m).toMatchObject({ views: 50, searchViews: 40, mapsViews: 10, calls: 2 });
  });
});

describe('monthly email with too little data', () => {
  it('shows a plain note instead of numbers', () => {
    const html = monthlyReportEmail({ businessName: 'Arbons', month: 'November 2026', postsPublished: 1, reviewsReplied: 0, totalViews: null, totalCalls: null });
    expect(html).toContain("hasn't given us a full month of figures");
    expect(html).toContain('&ndash;');
  });
  it('shows the Search share when known', () => {
    const html = monthlyReportEmail({ businessName: 'Arbons', month: 'November 2026', postsPublished: 1, reviewsReplied: 0, totalViews: 465, searchViews: 310, totalCalls: 31, totalDirections: 31, totalWebsiteClicks: 62 });
    expect(html).toContain('310 from Google Search');
    expect(html).toContain('Website Clicks');
  });
});
