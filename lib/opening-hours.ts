/**
 * Opening hours the shop types in and confirms. Nothing else.
 *
 * WHY THIS EXISTS. Until now, a listing with no hours (or fewer than five days)
 * had "Monday to Friday 08:00 to 18:00, Saturday 09:00 to 13:00" written to it:
 * the same for every shop, never shown, not editable. Publishing made-up
 * opening times on a real shop's Google listing sends customers to a locked
 * door. So there is no default any more. The app shows seven days, starting
 * from whatever Google already holds, and writes only what the shop has filled
 * in and confirmed.
 *
 * WHAT IT HANDLES. One opening period per day, opening and closing on the same
 * day. That covers a flooring shop. A listing whose hours on Google are more
 * detailed than that (closed for lunch, open past midnight, open 24 hours) is
 * marked `complex` and is NOT offered for editing here, because writing our
 * simpler version over it would lose something the shop set deliberately.
 *
 * Google's format (Business Information API v1): regularHours.periods[], each
 * { openDay, openTime: { hours, minutes }, closeDay, closeTime: { hours, minutes } }.
 * Times are TimeOfDay objects; missing fields mean zero. Older code here sent
 * "08:00" strings, which is not that format; both are read, only objects are written.
 */

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABELS: Record<Day, string> = { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday' };

/** One day as the shop edits it. `open` false means closed that day. Times are 24-hour "HH:MM". */
export interface DayHours { day: Day; open: boolean; from: string; to: string }
export type HoursDraft = DayHours[];

export interface HoursFromGoogle {
  /** Seven days, Monday first. Days Google has nothing for are closed with empty times. */
  draft: HoursDraft;
  /** How many days Google currently has hours for. */
  daysSet: number;
  /** True when Google's hours are more detailed than this editor can express: do not offer to overwrite. */
  complex: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function timeToText(t: unknown): string | null {
  if (typeof t === 'string') return TIME_RE.test(t) ? t : null;
  if (t && typeof t === 'object') {
    const h = Number((t as any).hours ?? 0), m = Number((t as any).minutes ?? 0);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  // A missing openTime means midnight in Google's format.
  if (t === undefined || t === null) return '00:00';
  return null;
}

export function emptyDraft(): HoursDraft {
  return DAYS.map((day) => ({ day, open: false, from: '', to: '' }));
}

/** Read Google's periods into an editable week. Pure. */
export function fromGooglePeriods(periods: unknown): HoursFromGoogle {
  const draft = emptyDraft();
  const list = Array.isArray(periods) ? periods : [];
  let complex = false;
  const seen = new Set<string>();
  for (const p of list as any[]) {
    const day = p?.openDay as Day;
    const row = draft.find((d) => d.day === day);
    const from = timeToText(p?.openTime), to = timeToText(p?.closeTime);
    if (!row || from === null || to === null) { complex = true; continue; }
    // A second period on the same day (closed for lunch), a close on another
    // day (past midnight) or a 24:00 close (open all day) cannot be shown here.
    if (seen.has(day) || (p?.closeDay && p.closeDay !== day) || to === '24:00' || from >= to) { complex = true; continue; }
    seen.add(day);
    row.open = true; row.from = from; row.to = to;
  }
  return { draft, daysSet: seen.size, complex };
}

/** Why this week cannot be saved, in words for the shop; null if it can. */
export function validateHoursDraft(input: unknown): { ok: true; value: HoursDraft } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length !== 7) return { ok: false, error: 'Please set all seven days, marking the days you are closed.' };
  const value: HoursDraft = [];
  for (let i = 0; i < 7; i++) {
    const d: any = input[i];
    if (!d || d.day !== DAYS[i]) return { ok: false, error: 'Please set all seven days, marking the days you are closed.' };
    if (d.open !== true) { value.push({ day: DAYS[i], open: false, from: '', to: '' }); continue; }
    const from = String(d.from || ''), to = String(d.to || '');
    if (!TIME_RE.test(from) || !TIME_RE.test(to)) return { ok: false, error: `Please give an opening and a closing time for ${DAY_LABELS[DAYS[i]]}, or mark it closed.` };
    if (from >= to) return { ok: false, error: `${DAY_LABELS[DAYS[i]]}: the closing time needs to be later than the opening time.` };
    value.push({ day: DAYS[i], open: true, from, to });
  }
  if (!value.some((d) => d.open)) return { ok: false, error: 'Please mark at least one day as open.' };
  return { ok: true, value };
}

const tod = (text: string) => { const [h, m] = text.split(':').map(Number); return m ? { hours: h, minutes: m } : { hours: h }; };

/** The week as Google wants it. Closed days are simply absent. Pure. */
export function toGooglePeriods(draft: HoursDraft): Array<{ openDay: Day; openTime: { hours: number; minutes?: number }; closeDay: Day; closeTime: { hours: number; minutes?: number } }> {
  return draft.filter((d) => d.open).map((d) => ({ openDay: d.day, openTime: tod(d.from), closeDay: d.day, closeTime: tod(d.to) }));
}

/** Do two sets of periods mean the same week? Used to check Google holds what the shop confirmed. */
export function samePeriods(a: unknown, b: unknown): boolean {
  const norm = (x: unknown) => {
    const r = fromGooglePeriods(x);
    return r.complex ? null : JSON.stringify(r.draft);
  };
  const na = norm(a), nb = norm(b);
  return na !== null && na === nb;
}

/** One plain line per day, for confirm screens and the change log view: "Monday 9:00 to 17:30". */
export function describeHours(draft: HoursDraft): string[] {
  const nice = (t: string) => { const [h, m] = t.split(':'); return `${Number(h)}:${m}`; };
  return draft.map((d) => (d.open ? `${DAY_LABELS[d.day]} ${nice(d.from)} to ${nice(d.to)}` : `${DAY_LABELS[d.day]} closed`));
}

// ── Holiday (special) hours ────────────────────────────────────────────────

/** One date the shop is closed, or open different hours. */
export interface SpecialDay { date: string; open: boolean; from: string; to: string }

export function validateSpecialDays(input: unknown, today: string): { ok: true; value: SpecialDay[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Please add at least one date.' };
  if (input.length > 30) return { ok: false, error: 'That is more dates than we can save at once (30).' };
  const value: SpecialDay[] = [];
  const seen = new Set<string>();
  for (const d of input as any[]) {
    const date = String(d?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return { ok: false, error: 'One of the dates does not look right.' };
    if (date < today) return { ok: false, error: 'One of the dates is in the past.' };
    if (seen.has(date)) return { ok: false, error: 'The same date is listed twice.' };
    seen.add(date);
    if (d.open !== true) { value.push({ date, open: false, from: '', to: '' }); continue; }
    const from = String(d.from || ''), to = String(d.to || '');
    if (!TIME_RE.test(from) || !TIME_RE.test(to) || from >= to) return { ok: false, error: `Please give an opening time and a later closing time for ${date}, or mark it closed.` };
    value.push({ date, open: true, from, to });
  }
  return { ok: true, value: value.sort((a, b) => a.date.localeCompare(b.date)) };
}

const gdate = (iso: string) => { const [year, month, day] = iso.split('-').map(Number); return { year, month, day }; };

/** Google's specialHours.specialHourPeriods for these dates. Pure. */
export function toGoogleSpecialPeriods(days: SpecialDay[]) {
  return days.map((d) => (d.open
    ? { startDate: gdate(d.date), endDate: gdate(d.date), openTime: tod(d.from), closeTime: tod(d.to) }
    : { startDate: gdate(d.date), endDate: gdate(d.date), closed: true }));
}

/** Read Google's special periods back into dates, keeping only today onwards. Anything spanning several days is kept as-is by the caller. */
export function fromGoogleSpecialPeriods(periods: unknown, today: string): { days: SpecialDay[]; complex: boolean } {
  const days: SpecialDay[] = [];
  let complex = false;
  for (const p of (Array.isArray(periods) ? periods : []) as any[]) {
    const s = p?.startDate, e = p?.endDate ?? p?.startDate;
    if (!s?.year || !s?.month || !s?.day) { complex = true; continue; }
    const iso = (d: any) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    if (iso(s) !== iso(e)) { if (iso(e) >= today) complex = true; continue; }
    if (iso(s) < today) continue;
    if (p.closed) { days.push({ date: iso(s), open: false, from: '', to: '' }); continue; }
    const from = timeToText(p.openTime), to = timeToText(p.closeTime);
    if (from === null || to === null || from >= to) { complex = true; continue; }
    days.push({ date: iso(s), open: true, from, to });
  }
  return { days: days.sort((a, b) => a.date.localeCompare(b.date)), complex };
}
