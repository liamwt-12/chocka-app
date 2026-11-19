/**
 * Google Business Profile performance figures, stored by day.
 *
 * WHY THIS EXISTS. The monthly report used to add up every `weekly_stats` row in
 * the month, but each row held a rolling 28-day total (monday-stats wrote what
 * getPerformanceMetrics returned). Four or five overlapping 28-day windows
 * summed to roughly four to five times the real month: views, calls,
 * directions and website clicks were all overstated. "Views" also counted Google
 * Maps only; Google Search impressions were never requested.
 *
 * Now every figure is stored once per day in `daily_metrics`, and any period is
 * a plain sum of the days inside it. Nothing overlaps, so nothing double counts.
 *
 * HISTORY. Google serves about 18 months of daily values. The first sync for a
 * listing asks for all of it, so a shop has a baseline from before it joined.
 *
 * LAG. Google's figures for the last few days are incomplete and get revised.
 * Reports never include the most recent REPORTING_LAG_DAYS, and every sync
 * re-fetches the last RESYNC_DAYS so late corrections overwrite early guesses.
 */

/** Every daily metric the Performance API offers that can apply to a shop. */
export const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  // Google ended Business Messages in 2024 and bookings need a booking
  // integration, so expect zeros for flooring shops. Stored anyway, so the
  // record is complete if either ever starts counting.
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_BOOKINGS',
] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];

export const HISTORY_DAYS = 540; // about 18 months
export const RESYNC_DAYS = 10;
export const REPORTING_LAG_DAYS = 5;

export interface MetricRow { date: string; metric: string; value: number }

export interface MetricTotals {
  searchViews: number;
  mapsViews: number;
  views: number;
  calls: number;
  websiteClicks: number;
  directions: number;
  conversations: number;
  bookings: number;
  /** How many distinct days in the period have any stored figure at all. */
  daysWithData: number;
}

/** YYYY-MM-DD for a UTC date. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Last day that is safe to report on: today minus the reporting lag. */
export function lastReportableDate(now: Date = new Date()): string {
  return addDaysIso(isoDate(now), -REPORTING_LAG_DAYS);
}

/**
 * Parse Google's fetchMultiDailyMetricsTimeSeries response into flat rows.
 * A missing `value` means zero (Google omits zeros). Shapes Google has used for
 * the nesting (object vs array) are both accepted.
 */
export function parseMultiDailyMetrics(body: any): MetricRow[] {
  const rows: MetricRow[] = [];
  const outer = Array.isArray(body?.multiDailyMetricTimeSeries) ? body.multiDailyMetricTimeSeries : [];
  for (const group of outer) {
    const series = Array.isArray(group?.dailyMetricTimeSeries) ? group.dailyMetricTimeSeries : group?.dailyMetricTimeSeries ? [group.dailyMetricTimeSeries] : [];
    for (const s of series) {
      const metric = s?.dailyMetric;
      if (!metric) continue;
      for (const dv of s?.timeSeries?.datedValues || []) {
        const d = dv?.date;
        if (!d?.year || !d?.month || !d?.day) continue;
        const date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        const value = parseInt(dv.value ?? '0', 10);
        rows.push({ date, metric, value: Number.isFinite(value) ? value : 0 });
      }
    }
  }
  return rows;
}

/** Sum stored rows over [from, to], inclusive. Pure. */
export function totalsFor(rows: MetricRow[], from: string, to: string): MetricTotals {
  const t: MetricTotals = { searchViews: 0, mapsViews: 0, views: 0, calls: 0, websiteClicks: 0, directions: 0, conversations: 0, bookings: 0, daysWithData: 0 };
  const days = new Set<string>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    days.add(r.date);
    switch (r.metric) {
      case 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH':
      case 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH': t.searchViews += r.value; break;
      case 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS':
      case 'BUSINESS_IMPRESSIONS_MOBILE_MAPS': t.mapsViews += r.value; break;
      case 'CALL_CLICKS': t.calls += r.value; break;
      case 'WEBSITE_CLICKS': t.websiteClicks += r.value; break;
      case 'BUSINESS_DIRECTION_REQUESTS': t.directions += r.value; break;
      case 'BUSINESS_CONVERSATIONS': t.conversations += r.value; break;
      case 'BUSINESS_BOOKINGS': t.bookings += r.value; break;
    }
  }
  t.views = t.searchViews + t.mapsViews;
  t.daysWithData = days.size;
  return t;
}

/** First and last day of the calendar month before `now` (UTC dates). */
export function previousMonth(now: Date = new Date()): { from: string; to: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: isoDate(first), to: isoDate(last) };
}

/** Database access this module needs, injected so it is testable. */
export interface MetricsDb { from(table: string): any }

/** Read stored rows for a profile over a period. */
export async function loadMetricRows(db: MetricsDb, profileId: string, from: string, to: string): Promise<MetricRow[]> {
  const out: MetricRow[] = [];
  // PostgREST pages at 1,000 rows; a long period is several thousand.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('daily_metrics')
      .select('date, metric, value')
      .eq('profile_id', profileId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      // And by metric: nine rows share each date, so ordering by date alone
      // left page boundaries undefined and a row could be missed past 1,000.
      .order('metric', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`daily_metrics read failed: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Fetch from Google and store. The first sync for a profile pulls the full
 * history; later ones pull the last RESYNC_DAYS. Returns what happened.
 *
 * `fetchRange` is the Google call, injected so tests use mocked responses only.
 */
export async function syncDailyMetrics(
  db: MetricsDb,
  profile: { id: string; metrics_backfilled_at?: string | null },
  fetchRange: (from: string, to: string) => Promise<MetricRow[]>,
  now: Date = new Date(),
): Promise<{ mode: 'backfill' | 'resync'; from: string; to: string; rows: number; earliest: string | null }> {
  const to = addDaysIso(isoDate(now), -1);
  const backfill = !profile.metrics_backfilled_at;
  const from = addDaysIso(to, -(backfill ? HISTORY_DAYS : RESYNC_DAYS));

  const rows = await fetchRange(from, to);
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => ({ profile_id: profile.id, date: r.date, metric: r.metric, value: r.value, fetched_at: now.toISOString() }));
    const { error } = await db.from('daily_metrics').upsert(chunk, { onConflict: 'profile_id,date,metric' });
    if (error) throw new Error(`daily_metrics write failed: ${error.message}`);
  }

  const earliest = rows.length ? rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date) : null;
  const stamp: Record<string, unknown> = { metrics_synced_at: now.toISOString() };
  if (backfill) Object.assign(stamp, { metrics_backfilled_at: now.toISOString(), metrics_history_start: earliest });
  const { error: stampError } = await db.from('profiles').update(stamp).eq('id', profile.id);
  if (stampError) throw new Error(`profile sync stamp failed: ${stampError.message}`);
  return { mode: backfill ? 'backfill' : 'resync', from, to, rows: rows.length, earliest };
}

/** Skip a listing synced more recently than this. */
export const RESYNC_AFTER_HOURS = 20;
/**
 * How long to leave a listing alone after a history pull FAILED. Until this
 * existed, a listing whose pull kept failing was put first in every hourly run
 * for ever, ahead of everyone else: with thirty such listings nobody else's
 * figures were fetched at all.
 */
export const RETRY_FAILED_AFTER_HOURS = 6;

/**
 * Which profiles to sync this run, in order.
 *
 * `metrics_synced_at` is the time of the last ATTEMPT, successful or not
 * (markSyncAttemptFailed stamps it on failure). So:
 *   - never tried at all: first, a new shop gets its history promptly
 *   - tried and failed: again after RETRY_FAILED_AFTER_HOURS, in its turn
 *   - synced: again after RESYNC_AFTER_HOURS
 * and within that, longest-waiting first, so one stuck listing cannot starve
 * the rest.
 */
export function pickProfilesToSync<U extends { profiles?: any[] | null }>(
  users: U[],
  now: Date,
): Array<{ user: U; profile: any }> {
  const resyncCutoff = now.getTime() - RESYNC_AFTER_HOURS * 3_600_000;
  const retryCutoff = now.getTime() - RETRY_FAILED_AFTER_HOURS * 3_600_000;
  const out: Array<{ user: U; profile: any }> = [];
  for (const user of users) {
    const profile = user.profiles?.[0];
    if (!profile?.google_location_name) continue;
    const tried = profile.metrics_synced_at ? Date.parse(profile.metrics_synced_at) : 0;
    if (profile.metrics_backfilled_at ? tried > resyncCutoff : tried > retryCutoff) continue;
    out.push({ user, profile });
  }
  out.sort((a, b) => (a.profile.metrics_synced_at || '').localeCompare(b.profile.metrics_synced_at || ''));
  return out;
}

/** Record that a sync was tried and failed, so the listing takes its turn instead of jumping the queue. */
export async function markSyncAttemptFailed(db: MetricsDb, profileId: string, now: Date = new Date()): Promise<void> {
  const { error } = await db.from('profiles').update({ metrics_synced_at: now.toISOString() }).eq('id', profileId);
  if (error) console.error(`[metrics] could not record a failed sync attempt for profile ${profileId}: ${error.message}`);
}
