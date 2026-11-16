/**
 * Bank holidays in England and Wales, so the dashboard can ask a shop in good
 * time "are you open on these days?" instead of leaving its listing showing
 * normal hours on Christmas Day.
 *
 * A fixed list on purpose: no outside service to call, nothing to go wrong at
 * run time. It runs to the end of 2028 and needs topping up before then (there
 * is a test that fails from mid-2028 to say so). Scotland and Northern Ireland
 * have some different days; a shop there can add any date it likes by hand.
 *
 * This only ever produces a prompt on the shop's own dashboard. It sends
 * nothing and writes nothing.
 */
export interface BankHoliday { date: string; name: string }

export const BANK_HOLIDAYS: BankHoliday[] = [
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-28', name: 'Boxing Day (bank holiday)' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-03-29', name: 'Easter Monday' },
  { date: '2027-05-03', name: 'Early May bank holiday' },
  { date: '2027-05-31', name: 'Spring bank holiday' },
  { date: '2027-08-30', name: 'Summer bank holiday' },
  { date: '2027-12-27', name: 'Christmas Day (bank holiday)' },
  { date: '2027-12-28', name: 'Boxing Day (bank holiday)' },
  { date: '2028-01-03', name: "New Year's Day (bank holiday)" },
  { date: '2028-04-14', name: 'Good Friday' },
  { date: '2028-04-17', name: 'Easter Monday' },
  { date: '2028-05-01', name: 'Early May bank holiday' },
  { date: '2028-05-29', name: 'Spring bank holiday' },
  { date: '2028-08-28', name: 'Summer bank holiday' },
  { date: '2028-12-25', name: 'Christmas Day' },
  { date: '2028-12-26', name: 'Boxing Day' },
];

/** How far ahead to start asking. Long enough to act on, short enough to feel current. */
export const PROMPT_DAYS_AHEAD = 35;

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Bank holidays from today up to PROMPT_DAYS_AHEAD days out. Pure. */
export function upcomingBankHolidays(today: string, daysAhead: number = PROMPT_DAYS_AHEAD): BankHoliday[] {
  const until = addDays(today, daysAhead);
  return BANK_HOLIDAYS.filter((h) => h.date >= today && h.date <= until);
}

/**
 * The prompt for a shop's dashboard: upcoming bank holidays its listing says
 * nothing about. `coveredDates` are the dates Google already holds special
 * hours for (single days or ranges, expanded by the caller). Null when there
 * is nothing to ask. Pure.
 */
export function holidayPrompt(today: string, coveredDates: Set<string>): { days: BankHoliday[]; title: string; message: string } | null {
  const days = upcomingBankHolidays(today).filter((h) => !coveredDates.has(h.date));
  if (!days.length) return null;
  const names = days.map((d) => `${d.name.replace(/ \(bank holiday\)$/, '')} (${new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })})`);
  return {
    days,
    title: days.length === 1 ? 'A bank holiday is coming up' : 'Bank holidays are coming up',
    message: `Your Google listing will show your normal opening hours on ${names.join(', ').replace(/, ([^,]*)$/, ' and $1')} unless you say otherwise. If you are closed, or open different hours, it takes a minute to set.`,
  };
}

/** Every date covered by Google's special-hours periods, ranges included. Pure. */
export function datesCovered(specialHourPeriods: unknown): Set<string> {
  const out = new Set<string>();
  const iso = (d: any) => (d?.year && d?.month && d?.day ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null);
  for (const p of (Array.isArray(specialHourPeriods) ? specialHourPeriods : []) as any[]) {
    const s = iso(p?.startDate), e = iso(p?.endDate) ?? s;
    if (!s || !e) continue;
    for (let d = s, i = 0; d <= e && i < 60; d = addDays(d, 1), i++) out.add(d);
  }
  return out;
}
