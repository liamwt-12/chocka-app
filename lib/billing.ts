/**
 * A reliable monthly count of live shops, by name.
 *
 * THE RECORD. Once a day, every shop that is live (lib/shop-status.ts, the one
 * definition: connected, the right listing, verified by Google, access
 * working) has its row for the current month marked for that day. What the
 * shop has switched on does not come into it, and pausing does not stop it:
 * only disconnecting does. The row
 * copies the shop's name and does not depend on the shop's record continuing
 * to exist, so a past month's count survives a shop leaving or deleting its
 * account. Marking is safe to repeat: a second run on the same day changes
 * nothing.
 *
 * THE STATEMENT. For a month: every shop that was LIVE ON THE LAST DAY of that
 * month, by name. That one rule is `countsForMonth` below, and nothing else
 * decides it. A shop that was live for three weeks and then lost its
 * connection does not count; a shop that connected on the last day does. For
 * the month still in progress the statement is provisional, and shows who is
 * live now.
 *
 * If a monthly cap is set, it is an amount of money. Every live shop is still
 * listed and priced, and anything above the cap is taken back off as a credit
 * line, so the statement adds up in the open:
 *
 *     live shops x price            (every live shop)
 *     credit: above the monthly cap (whatever takes the total back to the cap)
 *     total
 *
 * THE CAP BELONGS TO A TERM. It applies only to months inside a term window,
 * and stops applying, with its credit line, once the term has ended. A month
 * is inside the term if its LAST DAY is on or between the two dates, which is
 * the same day that decides who counts. A cap with no term dates is NOT
 * applied, and the statement says so in words: a cap that quietly applied for
 * ever would become the price.
 *
 * A TOTAL CEILING FOR THE TERM. If BILLING_TOTAL_CEILING_PENCE is set, the
 * fees across the term (what each month inside the term charges, AFTER the
 * monthly cap and its credit line) stop at it. The term then ends at
 * whichever comes first: BILLING_TERM_END, or the month in which the fees
 * reach the ceiling. In that month only what is left of the ceiling is
 * charged, and the rest is one more credit line:
 *
 *     live shops x price
 *     credit: above the monthly cap
 *     credit: above the total ceiling for the term   (only in the month it is reached)
 *     total
 *
 * What earlier months charged is worked out from the same daily record and
 * the same rules as their own statements (totalCeilingForMonth); if an
 * earlier month cannot be worked out (it has not ended, or no count was taken
 * on its last day) there is no statement, rather than a guess.
 *
 * AFTER THE TERM, NO STATEMENT. Once the term has ended, whether at
 * BILLING_TERM_END or in the month the total ceiling was reached, no
 * statement is produced for any later month: not one at the full price with
 * no cap, and not one charging nothing. Either would be a decision nobody
 * made. The page says the term has ended and that the next term must be set
 * (termEndedProblem, and totalCeilingForMonth for the ceiling). The daily
 * record of who is live is still kept.
 *
 * NO STATEMENT WITHOUT THE TERM. Until both term dates are set, no statement
 * is produced at all (termProblem), and the launch check shows a cross. A
 * total ceiling that is not a whole number of pence also stops it. The
 * daily record of who is live is still kept, so nothing is lost meanwhile.
 *
 * NO PRICE, NO CAP, NO CEILING AND NO DATE IS WRITTEN IN THIS CODE. The
 * repository is public. All five are settings, with no defaults:
 *     BILLING_PRICE_PENCE_PER_SHOP   whole pence. Unset = counts only, no money shown
 *     BILLING_MONTHLY_CAP_PENCE      whole pence. Unset = no cap
 *     BILLING_TERM_START             a day, YYYY-MM-DD. The first day of the term
 *     BILLING_TERM_END               a day, YYYY-MM-DD. The last day of the term
 *     BILLING_TOTAL_CEILING_PENCE    whole pence, above nought. Unset = no total ceiling
 *
 * It produces a statement for a person to check. It does not raise an invoice,
 * charge anything or send anything.
 */
import { shopStatus, liveRulesFromEnv, STATUS_USER_COLUMNS, type LiveRules, type StatusInvite, type StatusUser } from './shop-status';
import { MANAGER_EMBED } from './managed-access';

export interface BillingSettings { pricePence: number | null; capPence: number | null; /** First and last day of the term the cap belongs to. Optional so a caller with no cap need not name them. */ termStart?: string | null; termEnd?: string | null;
  /** The most the whole term can charge, after the monthly cap. Optional: unset means no total ceiling. */
  totalCeilingPence?: number | null;
  /** True when BILLING_TOTAL_CEILING_PENCE is there but is not a whole number of pence above nought. No statement then. */
  totalCeilingInvalid?: boolean }

const wholeNumber = (v: string | undefined, min: number): number | null => {
  if (v === undefined || v.trim() === '') return null;
  // Digits only: "1e3" and "0x10" are numbers to a computer and typing mistakes to a person.
  if (!/^\d+$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) && n >= min ? n : null;
};

/** A real calendar day written YYYY-MM-DD, or null. "2027-02-30" is not a day. */
const dayOrNull = (v: string | undefined | null): string | null => {
  const text = (v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? null : text;
};

export function billingSettingsFromEnv(env: Record<string, string | undefined> = process.env): BillingSettings {
  return {
    pricePence: wholeNumber(env.BILLING_PRICE_PENCE_PER_SHOP, 0),
    capPence: wholeNumber(env.BILLING_MONTHLY_CAP_PENCE, 0),
    termStart: dayOrNull(env.BILLING_TERM_START),
    termEnd: dayOrNull(env.BILLING_TERM_END),
    totalCeilingPence: wholeNumber(env.BILLING_TOTAL_CEILING_PENCE, 1),
    // Unlike the price and the cap, a ceiling typed wrongly must not quietly
    // become "no ceiling": that would charge past it. It stops the statement.
    totalCeilingInvalid: (env.BILLING_TOTAL_CEILING_PENCE ?? '').trim() !== '' && wholeNumber(env.BILLING_TOTAL_CEILING_PENCE, 1) === null,
  };
}

/**
 * Why no statement can be produced yet, or null if one can. A statement needs
 * the term it belongs to: BILLING_TERM_START and BILLING_TERM_END, both real
 * days, in order. There are no defaults. Until they are set there is no
 * statement at all, so that one cannot be produced, and used, on a guess
 * about when the term runs.
 */
export function termProblem(settings: BillingSettings): string | null {
  if (settings.totalCeilingInvalid) return 'No statement can be produced: BILLING_TOTAL_CEILING_PENCE is set but is not a whole number of pence above nought. Correct it, or remove it.';
  const start = dayOrNull(settings.termStart), end = dayOrNull(settings.termEnd);
  if (!start && !end && settings.totalCeilingPence != null) return 'No statement can be produced: a total ceiling is set (BILLING_TOTAL_CEILING_PENCE) but the term it belongs to is not. Set BILLING_TERM_START and BILLING_TERM_END, each a day written YYYY-MM-DD.';
  if (!start && !end) return 'No statement can be produced until the term is set: BILLING_TERM_START and BILLING_TERM_END, each a day written YYYY-MM-DD.';
  if (!start || !end) return `No statement can be produced until both ends of the term are set: ${!start ? 'BILLING_TERM_START' : 'BILLING_TERM_END'} is missing, or is not a real day written YYYY-MM-DD.`;
  if (end < start) return 'No statement can be produced: the term ends before it starts (BILLING_TERM_START and BILLING_TERM_END).';
  return null;
}

export type CapReason = 'no_cap' | 'in_term' | 'no_term' | 'bad_term' | 'before_term' | 'after_term';
export interface CapForMonth {
  /** Is the cap applied to this month? */
  applies: boolean;
  reason: CapReason;
  /** A sentence for the statement when a cap is set and is NOT applied; otherwise null. */
  note: string | null;
}

/**
 * THE rule for whether the cap applies to a month. One place.
 *
 * It applies only when a cap is set, both term dates are set and in order,
 * and the month's last day falls on or between them.
 */
export function capForMonth(settings: BillingSettings, month: string): CapForMonth {
  if (settings.capPence === null) return { applies: false, reason: 'no_cap', note: null };
  const start = dayOrNull(settings.termStart), end = dayOrNull(settings.termEnd);
  if (!start || !end) return { applies: false, reason: 'no_term', note: 'A monthly cap is set but the term it belongs to is not (BILLING_TERM_START and BILLING_TERM_END), so the cap has NOT been applied. Set both dates, or remove the cap.' };
  if (end < start) return { applies: false, reason: 'bad_term', note: 'The term ends before it starts (BILLING_TERM_START and BILLING_TERM_END), so the monthly cap has NOT been applied. Correct the dates.' };
  const last = lastDayOfMonth(month);
  if (last < start) return { applies: false, reason: 'before_term', note: `The monthly cap is not applied: this month ends before the term starts on ${start}.` };
  if (last > end) return { applies: false, reason: 'after_term', note: `The monthly cap is not applied: the term ended on ${end}, and this month ends after it.` };
  return { applies: true, reason: 'in_term', note: null };
}

export const monthOf = (isoDay: string) => isoDay.slice(0, 7);

/** What to set to bill for months after a term. One sentence, used wherever a term has ended. */
const NEXT_TERM = 'Nothing is billed automatically after a term ends. To produce statements for later months, set the next term: BILLING_TERM_START and BILLING_TERM_END (and BILLING_TOTAL_CEILING_PENCE if the next term has one).';

/**
 * Why there is no statement for a month after the term ended at
 * BILLING_TERM_END, or null. A month is after the term when its last day is
 * after the term's last day: the same rule that decides whether it is inside.
 * Only when both term dates are set and in order; otherwise termProblem
 * already says what is missing. Pure.
 */
export function termEndedProblem(settings: BillingSettings, month: string): string | null {
  const start = dayOrNull(settings.termStart), end = dayOrNull(settings.termEnd);
  if (!start || !end || end < start) return null;
  if (lastDayOfMonth(month) <= end) return null;
  return `No statement for ${monthName(month)}: the term ended on ${end}. ${NEXT_TERM}`;
}
/** The day in UK time, since "live in November" should mean November here. */
export function ukDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export interface LiveMonthRow { month: string; retailer_id: string; tenant_id: string; name: string; town: string | null; live_days: number; first_live_on: string; last_live_on: string }

/**
 * Given who is live today and this month's existing rows, the rows to write.
 * A shop already marked for today is left out, which is what makes a second
 * run on the same day a no-op. Pure.
 */
export function planLiveMarks(
  liveToday: Array<{ retailerId: string; tenantId: string; name: string; town: string | null }>,
  existing: LiveMonthRow[],
  today: string,
): LiveMonthRow[] {
  const month = monthOf(today);
  const byId = new Map(existing.filter((r) => r.month === month).map((r) => [r.retailer_id, r]));
  const out: LiveMonthRow[] = [];
  for (const s of liveToday) {
    const row = byId.get(s.retailerId);
    if (row && row.last_live_on >= today) continue;
    out.push(row
      // The name is refreshed, so a statement uses the shop's current name.
      ? { ...row, name: s.name, town: s.town, live_days: row.live_days + 1, last_live_on: today }
      : { month, retailer_id: s.retailerId, tenant_id: s.tenantId, name: s.name, town: s.town, live_days: 1, first_live_on: today, last_live_on: today });
  }
  return out;
}

export interface BillingDb { from(table: string): any }

/**
 * Mark today's live shops. Three reads and at most two writes however many
 * shops there are, so it is cheap enough to run with the hourly job; only the
 * first run of the day writes anything. Never throws: a failed count must not
 * stop the figures job it rides on.
 */
export async function recordLiveToday(db: BillingDb, now: Date = new Date(), rules: LiveRules = liveRulesFromEnv()): Promise<{ live: number; marked: number; firstLive: number } | null> {
  try {
    const today = ukDay(now);
    const { data: retailers, error } = await db.from('retailers')
      .select('id, tenant_id, name, town, user_id, connection_status, listing_confirmed_at, first_live_on, exclude_from_count')
      .not('user_id', 'is', null)
      // A shop no longer on the funder's list is not counted, like everywhere else.
      .is('delisted_at', null);
    if (error) throw new Error(error.message);
    const candidates = (retailers || []).filter((r: any) => !r.exclude_from_count);
    if (!candidates.length) return { live: 0, marked: 0, firstLive: 0 };

    const userIds = candidates.map((r: any) => r.user_id);
    const { data: users, error: usersError } = await db.from('users')
      .select(`id, google_refresh_token, token_status, token_invalid_at, managed_by_user_id, ${STATUS_USER_COLUMNS}, ${MANAGER_EMBED}, profiles ( google_location_name )`)
      .in('id', userIds);
    if (usersError) throw new Error(usersError.message);
    const userById = new Map<string, StatusUser>((users || []).map((u: any) => [u.id, u]));

    const live = candidates.filter((r: any) => shopStatus(r, userById.get(r.user_id) ?? null, [] as StatusInvite[], now, rules).live);
    const { data: existing, error: rowsError } = await db.from('live_months').select('*').eq('month', monthOf(today));
    if (rowsError) throw new Error(rowsError.message);

    const marks = planLiveMarks(live.map((r: any) => ({ retailerId: r.id, tenantId: r.tenant_id, name: r.name, town: r.town ?? null })), existing || [], today);
    if (marks.length) {
      const { error: writeError } = await db.from('live_months').upsert(marks.map((m) => ({ ...m, updated_at: now.toISOString() })), { onConflict: 'month,retailer_id' });
      if (writeError) throw new Error(writeError.message);
    }
    const newlyLive = live.filter((r: any) => !r.first_live_on).map((r: any) => r.id);
    if (newlyLive.length) {
      const { error: firstError } = await db.from('retailers').update({ first_live_on: today }).in('id', newlyLive).is('first_live_on', null);
      if (firstError) console.error(`[billing] could not record first-live dates: ${firstError.message}`);
    }
    return { live: live.length, marked: marks.length, firstLive: newlyLive.length };
  } catch (e) {
    console.error('[billing] could not mark today\'s live shops:', String((e as any)?.message).slice(0, 200));
    return null;
  }
}

/** The last calendar day of a month given as "YYYY-MM". */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
const dayBefore = (isoDay: string) => { const d = new Date(`${isoDay}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/**
 * THE rule for whether a shop counts for a month. One place.
 *
 *   a month that has ended   live on its last day
 *   the month in progress    live now (marked today, or yesterday if today's
 *                            mark has not been made yet); provisional
 *   a month not yet begun    never
 */
export function countsForMonth(row: Pick<LiveMonthRow, 'month' | 'last_live_on'>, month: string, today: string): boolean {
  if (row.month !== month) return false;
  const thisMonth = monthOf(today);
  if (month > thisMonth) return false;
  if (month < thisMonth) return row.last_live_on === lastDayOfMonth(month);
  return row.last_live_on >= dayBefore(today);
}

export interface StatementLine { name: string; town: string | null; liveDays: number; firstLiveOn: string; lastLiveOn: string; aboveCap: boolean }
export interface Statement {
  month: string;
  /** True for the month still in progress: who is live now, not who will be on the last day. */
  provisional: boolean;
  /** The day that decides it: the month's last day, or today for a month in progress. */
  decidedOn: string;
  settings: BillingSettings;
  lines: StatementLine[];
  /** Shops live at some point in the month but not on the deciding day: listed so nothing is hidden, not counted. */
  notCounted: StatementLine[];
  liveShops: number;
  /**
   * True when the month has ended, shops were live during it, and NOT ONE was
   * marked on its last day. That is what a day with no count looks like (the
   * hourly job did not run), not a network that all went dark at once. The
   * statement must not be used as it stands.
   */
  noCountOnLastDay: boolean;
  /** Whether the cap applies to this month, and if a cap is set and does not, why (capForMonth). */
  cap: CapForMonth;
  /** Shops whose charge falls wholly or partly above the cap. */
  shopsAboveCap: number;
  /** Money, only when a price is set. creditPence is above the monthly cap; ceilingCreditPence above the total ceiling. */
  money: { grossPence: number; creditPence: number; ceilingCreditPence: number; totalPence: number } | null;
  /** Where this month stands against the total ceiling for the term (totalCeilingForMonth). */
  ceiling: TotalCeiling;
}

export type CeilingState =
  | 'none'          // no total ceiling is set
  | 'no_price'      // set, but with no price there is nothing to limit
  | 'outside_term'  // this month does not end inside the term
  | 'under'         // inside the term, and the fees stay below the ceiling
  | 'reached';      // the fees reach the ceiling this month: the term ends with it
// A month after the one that reached it has no statement at all (StatementNotAvailable).
export interface TotalCeiling {
  state: CeilingState;
  ceilingPence: number | null;
  /** What the earlier months of the term charged, after the monthly cap. */
  chargedBeforePence: number;
  /** What is left of the ceiling once this month is charged; null when no ceiling applies. */
  leftAfterPence: number | null;
  /** The month in which the ceiling was (or is) reached, which is the month the term ends. */
  reachedIn: string | null;
  /** A sentence for the statement, or null. */
  note: string | null;
}

type MonthStatement = Omit<Statement, 'money' | 'ceiling'> & { money: { grossPence: number; creditPence: number; totalPence: number } | null };

/** "2031-03" as "March 2031". */
export function monthName(month: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}
const nextMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const poundsSign = (pence: number) => `£${pounds(pence)}`;

/**
 * THE rule for the total ceiling. One place.
 *
 * Walks the months of the term before this one, in order, working out what
 * each charged with exactly the rules its own statement uses (monthly cap
 * and all), from the rows given, which must therefore cover every month from
 * the start of the term. If the ceiling was reached in one of them, the term
 * ended there and there is no statement for this month: StatementNotAvailable,
 * saying the next term must be set. If one of them cannot be
 * worked out (it has not ended, or no count was taken on its last day), no
 * statement: StatementNotAvailable, never a guess. Pure.
 */
export function totalCeilingForMonth(month: string, rows: LiveMonthRow[], settings: BillingSettings, today: string, thisMonthPence: number | null): TotalCeiling {
  const ceilingPence = settings.totalCeilingPence ?? null;
  const off = (state: CeilingState): TotalCeiling => ({ state, ceilingPence, chargedBeforePence: 0, leftAfterPence: null, reachedIn: null, note: null });
  if (settings.totalCeilingInvalid) throw new StatementNotAvailable(termProblem(settings)!);
  if (ceilingPence === null) return off('none');
  const problem = termProblem(settings);
  if (problem) throw new StatementNotAvailable(problem);
  if (settings.pricePence === null || thisMonthPence === null) return off('no_price');
  const start = settings.termStart!, end = settings.termEnd!;
  const last = lastDayOfMonth(month);
  if (last < start || last > end) return off('outside_term');

  let before = 0;
  // The first month of the term is the one holding its first day: that month's last day is inside the term.
  for (let m = monthOf(start); m < month; m = nextMonth(m)) {
    if (m >= monthOf(today)) throw new StatementNotAvailable(`No statement can be produced for ${monthName(month)} yet: the total ceiling for the term needs what every earlier month of the term charged, and ${monthName(m)} has not ended.`);
    const earlier = monthStatement(m, rows, settings, today);
    if (earlier.noCountOnLastDay) throw new StatementNotAvailable(`No statement can be produced for ${monthName(month)}: the total ceiling for the term needs what every earlier month of the term charged, and no count was taken on the last day of ${monthName(m)}, so what it charged is not known.`);
    before += earlier.money!.totalPence;
    if (before >= ceilingPence) {
      throw new StatementNotAvailable(`No statement for ${monthName(month)}: the term ended in ${monthName(m)}, when the total ceiling for the term (${poundsSign(ceilingPence)}) was reached. ${NEXT_TERM}`);
    }
  }
  const left = ceilingPence - before;
  if (thisMonthPence >= left) {
    const name = monthName(month);
    return { state: 'reached', ceilingPence, chargedBeforePence: before, leftAfterPence: 0, reachedIn: month,
      note: thisMonthPence === left
        ? `The total ceiling for the term (${poundsSign(ceilingPence)}) is reached exactly in ${name}. The term ends with ${name}.`
        : `The total ceiling for the term (${poundsSign(ceilingPence)}) is reached in ${name}. Earlier months of the term charged ${poundsSign(before)}, so this month charges only the ${poundsSign(left)} that was left, and the rest is a credit. The term ends with ${name}.` };
  }
  return { state: 'under', ceilingPence, chargedBeforePence: before, leftAfterPence: left - thisMonthPence, reachedIn: null,
    note: `Total ceiling for the term: ${poundsSign(ceilingPence)}. Charged in earlier months of the term: ${poundsSign(before)}. Left after this month: ${poundsSign(left - thisMonthPence)}.` };
}

/**
 * Build the statement for one month. Pure. With a total ceiling set, `rows`
 * must hold every month from the start of the term up to this one (as
 * loadStatement reads them); without one, this month's rows are enough.
 */
export function buildStatement(month: string, rows: LiveMonthRow[], settings: BillingSettings, today: string = ukDay()): Statement {
  // After the term: no statement, full price or free. The next term has to be set.
  const ended = termEndedProblem(settings, month);
  if (ended) throw new StatementNotAvailable(ended);
  const base = monthStatement(month, rows, settings, today);
  const ceiling = totalCeilingForMonth(month, rows, settings, today, base.money ? base.money.totalPence : null);
  if (!base.money) return { ...base, money: null, ceiling };
  const ceilingCreditPence = ceiling.state === 'reached' ? base.money.totalPence - (ceiling.ceilingPence! - ceiling.chargedBeforePence) : 0;
  return { ...base, money: { ...base.money, ceilingCreditPence, totalPence: base.money.totalPence - ceilingCreditPence }, ceiling };
}

/** One month on its own: who counts, the price and the monthly cap. Every earlier month's charge is worked out with it too. Pure. */
function monthStatement(month: string, rows: LiveMonthRow[], settings: BillingSettings, today: string): MonthStatement {
  const mine = rows.filter((r) => r.month === month);
  const line = (r: LiveMonthRow, aboveCap = false): StatementLine => ({ name: r.name, town: r.town, liveDays: r.live_days, firstLiveOn: r.first_live_on, lastLiveOn: r.last_live_on, aboveCap });
  // Earliest in the month first, then by name, so who falls above a cap is stable and explainable.
  const order = (a: LiveMonthRow, b: LiveMonthRow) => a.first_live_on.localeCompare(b.first_live_on) || a.name.localeCompare(b.name) || a.retailer_id.localeCompare(b.retailer_id);
  const counted = mine.filter((r) => countsForMonth(r, month, today)).sort(order);
  const liveShops = counted.length;
  const { pricePence } = settings;
  // The cap only counts inside its term. Outside it, the month is priced as if there were none.
  const cap = capForMonth(settings, month);
  const capPence = cap.applies ? settings.capPence : null;
  let money: MonthStatement['money'] = null;
  let withinCap = liveShops;
  if (pricePence !== null) {
    const grossPence = liveShops * pricePence;
    const totalPence = capPence === null ? grossPence : Math.min(grossPence, capPence);
    money = { grossPence, creditPence: grossPence - totalPence, totalPence };
    // How many shops fit wholly inside the cap. The rest are marked, in the order above.
    if (capPence !== null && pricePence > 0) withinCap = Math.min(liveShops, Math.floor(capPence / pricePence));
  }
  const lines = counted.map((r, i) => line(r, i >= withinCap));
  const provisional = month === monthOf(today);
  return {
    month, provisional, decidedOn: provisional ? today : lastDayOfMonth(month), settings, lines,
    notCounted: mine.filter((r) => !countsForMonth(r, month, today)).sort(order).map((r) => line(r)),
    liveShops, cap, shopsAboveCap: liveShops - withinCap, money,
    noCountOnLastDay: !provisional && month < monthOf(today) && mine.length > 0 && liveShops === 0,
  };
}

const pounds = (pence: number) => (pence / 100).toFixed(2);
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // A plain number (including a negative credit) is safe as it is. Anything
  // else that starts like a formula is quoted with a leading apostrophe.
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  // Leading spaces, tabs and returns do not stop a spreadsheet reading what follows as a formula.
  const risky = /^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s);
  return risky || /[",\n\r]/.test(s) ? `"${(risky ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

/** The statement as a spreadsheet file. Names are escaped so one cannot be read as a formula. Pure. */
export function statementCsv(s: Statement): string {
  const rows: unknown[][] = [...(s.noCountOnLastDay ? [['WARNING: no count was taken on the last day of this month, so nobody is shown as live. Do not use this statement as it stands.'], []] : []), ['Month', s.month], [s.provisional ? 'Provisional: shops live now' : 'Shops live on the last day of the month', s.decidedOn], ['Live means connected to a verified listing we can reach. It does not depend on what the shop has switched on.'], [], ['Shop', 'Town', 'Days live', 'First live', 'Last live', 'Above the cap']];
  for (const l of s.lines) rows.push([l.name, l.town ?? '', l.liveDays, l.firstLiveOn, l.lastLiveOn, l.aboveCap ? 'yes' : '']);
  rows.push([], ['Live shops', s.liveShops]);
  if (s.money && s.settings.pricePence !== null) {
    rows.push([], [`Live shops x ${pounds(s.settings.pricePence)}`, pounds(s.money.grossPence)]);
    if (s.cap.applies && s.settings.capPence !== null) {
      rows.push(['Monthly cap', pounds(s.settings.capPence)]);
      rows.push(['The cap applies for the term', `${s.settings.termStart} to ${s.settings.termEnd}`]);
    } else if (s.cap.note) rows.push([s.cap.note]);
    if (s.money.creditPence) rows.push([`Credit: above the monthly cap (${s.shopsAboveCap} shop${s.shopsAboveCap === 1 ? '' : 's'})`, `-${pounds(s.money.creditPence)}`]);
    if (s.ceiling.note) rows.push([s.ceiling.note]);
    if (s.money.ceilingCreditPence) rows.push(['Credit: above the total ceiling for the term', `-${pounds(s.money.ceilingCreditPence)}`]);
    rows.push(['Total', pounds(s.money.totalPence)]);
  }
  if (s.notCounted.length) { rows.push([], [s.provisional ? 'Not counted: live earlier this month, not live now' : 'Not counted: live during the month, not on its last day']); for (const l of s.notCounted) rows.push([l.name, l.town ?? '', l.liveDays, l.firstLiveOn, l.lastLiveOn]); }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Thrown instead of a statement when the term has not been set, or has ended. Not a fault: something to set. */
export class StatementNotAvailable extends Error {}

export async function loadStatement(db: BillingDb, tenantId: string, month: string, settings: BillingSettings = billingSettingsFromEnv(), today: string = ukDay()): Promise<Statement> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Use a month like 2026-12');
  const problem = termProblem(settings) ?? termEndedProblem(settings, month);
  if (problem) throw new StatementNotAvailable(problem);
  // With a total ceiling, every month of the term up to this one is needed, to know what has been charged.
  if (settings.totalCeilingPence != null && settings.pricePence !== null) {
    const first = monthOf(settings.termStart!) < month ? monthOf(settings.termStart!) : month;
    return buildStatement(month, await liveMonthsBetween(db, tenantId, first, month), settings, today);
  }
  const { data, error } = await db.from('live_months').select('*').eq('tenant_id', tenantId).eq('month', month);
  if (error) throw new Error(error.message);
  return buildStatement(month, data || [], settings, today);
}

/** Every row for a run of months, a page at a time: a term of rows can be more than one read returns. */
export async function liveMonthsBetween(db: BillingDb, tenantId: string, first: string, last: string): Promise<LiveMonthRow[]> {
  const PAGE = 1000;
  const out: LiveMonthRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('live_months').select('*').eq('tenant_id', tenantId).gte('month', first).lte('month', last)
      .order('month').order('retailer_id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}
