/**
 * Who has had this month's report: the record that lets the monthly report job
 * stop when its time is up and carry on at the next run.
 *
 * WHY IT NEEDS A RECORD. The other scheduled jobs can tell what they have
 * already done from what they leave behind (a post, a stats row, a seen
 * review). A report email leaves nothing behind, so a second run could not
 * know who had been sent one, and would have sent some shops two. The job
 * therefore ran once, got through about 35 shops in Netlify's 60 seconds, and
 * the rest got nothing (docs/scale-check.md).
 *
 * THE RECORD is one column, profiles.monthly_report_sent_for, holding the month
 * the last report covered, as 'YYYY-MM'.
 *
 * THE ORDER IS: claim, then send. A shop's month is written BEFORE its email
 * goes, and only if it was not already written. So:
 *   - two runs overlapping cannot both send: only one claim succeeds;
 *   - if the job dies between claiming and sending, that shop misses one
 *     report. That is the deliberate choice: a missing report is a smaller
 *     harm than a shop getting the same report twice, or every five minutes;
 *   - if the email is refused, the claim is put back, so the next run tries
 *     again.
 * If the claim cannot be made at all (the column is missing because the
 * migration has not been applied, or the database is down), nothing is sent.
 */

export interface ReportDb { from(table: string): any }

/** 'YYYY-MM' for the month a report covers, from the first day of that month ('YYYY-MM-DD'). */
export function reportMonthKey(monthFrom: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monthFrom)) throw new Error(`not a date: ${monthFrom}`);
  return monthFrom.slice(0, 7);
}

/** Has this listing already had (or been claimed for) the report for this month? */
export function alreadyReported(profile: { monthly_report_sent_for?: string | null } | null | undefined, monthKey: string): boolean {
  return profile?.monthly_report_sent_for === monthKey;
}

export type Claim = { ok: true; previous: string | null } | { ok: false; reason: 'already-claimed' | 'error'; detail?: string };

/**
 * Mark this listing as reported for the month, if nobody has already. Returns
 * ok only when THIS call made the mark. Never throws.
 */
export async function claimMonthlyReport(db: ReportDb, profile: { id: string; monthly_report_sent_for?: string | null }, monthKey: string): Promise<Claim> {
  // Read before the write: the caller's object may be the very row being changed.
  const previous = profile.monthly_report_sent_for ?? null;
  try {
    const { data, error } = await db
      .from('profiles')
      .update({ monthly_report_sent_for: monthKey })
      .eq('id', profile.id)
      // Only a row not already marked for this month. This is what makes two
      // overlapping runs safe: the database lets one of them through.
      .or(`monthly_report_sent_for.is.null,monthly_report_sent_for.neq.${monthKey}`)
      .select('id');
    if (error) return { ok: false, reason: 'error', detail: String(error.message).slice(0, 200) };
    if (!data?.length) return { ok: false, reason: 'already-claimed' };
    return { ok: true, previous };
  } catch (err: any) {
    return { ok: false, reason: 'error', detail: String(err?.message ?? err).slice(0, 200) };
  }
}

/**
 * Undo a claim whose email did not go, so the next run tries again. Only undoes
 * a mark that is still this month's. Never throws; returns false if it could
 * not be undone (the shop then misses this month's report, and that is logged).
 */
export async function releaseMonthlyReport(db: ReportDb, profileId: string, monthKey: string, previous: string | null): Promise<boolean> {
  try {
    const { error } = await db.from('profiles').update({ monthly_report_sent_for: previous }).eq('id', profileId).eq('monthly_report_sent_for', monthKey);
    return !error;
  } catch {
    return false;
  }
}

/** Run `fn` over `items`, at most `size` at a time, keeping the results in order. */
export async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(...(await Promise.all(items.slice(i, i + Math.max(1, size)).map(fn))));
  return out;
}
