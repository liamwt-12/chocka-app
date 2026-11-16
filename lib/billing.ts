/**
 * A reliable monthly count of live shops, by name.
 *
 * THE RECORD. Once a day, every shop that is live (lib/shop-status.ts, the one
 * definition) has its row for the current month marked for that day. The row
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
 * NO PRICE AND NO CAP IS WRITTEN IN THIS CODE. The repository is public. Both
 * are settings, in whole pence:
 *     BILLING_PRICE_PENCE_PER_SHOP   unset = counts only, no money shown
 *     BILLING_MONTHLY_CAP_PENCE      unset = no cap
 *
 * It produces a statement for a person to check. It does not raise an invoice,
 * charge anything or send anything.
 */
import { shopStatus, liveRulesFromEnv, type LiveRules, type StatusInvite, type StatusUser } from './shop-status';
import { MANAGER_EMBED } from './managed-access';

export interface BillingSettings { pricePence: number | null; capPence: number | null }

const wholeNumber = (v: string | undefined, min: number): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= min ? n : null;
};

export function billingSettingsFromEnv(env: Record<string, string | undefined> = process.env): BillingSettings {
  return {
    pricePence: wholeNumber(env.BILLING_PRICE_PENCE_PER_SHOP, 0),
    capPence: wholeNumber(env.BILLING_MONTHLY_CAP_PENCE, 0),
  };
}

export const monthOf = (isoDay: string) => isoDay.slice(0, 7);
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
      .not('user_id', 'is', null);
    if (error) throw new Error(error.message);
    const candidates = (retailers || []).filter((r: any) => !r.exclude_from_count);
    if (!candidates.length) return { live: 0, marked: 0, firstLive: 0 };

    const userIds = candidates.map((r: any) => r.user_id);
    const { data: users, error: usersError } = await db.from('users')
      .select(`id, google_refresh_token, token_status, token_invalid_at, managed_by_user_id, ${MANAGER_EMBED}, profiles ( google_location_name )`)
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
  /** Shops whose charge falls wholly or partly above the cap. */
  shopsAboveCap: number;
  /** Money, only when a price is set. */
  money: { grossPence: number; creditPence: number; totalPence: number } | null;
}

/** Build the statement for one month from its rows. Pure. */
export function buildStatement(month: string, rows: LiveMonthRow[], settings: BillingSettings, today: string = ukDay()): Statement {
  const mine = rows.filter((r) => r.month === month);
  const line = (r: LiveMonthRow, aboveCap = false): StatementLine => ({ name: r.name, town: r.town, liveDays: r.live_days, firstLiveOn: r.first_live_on, lastLiveOn: r.last_live_on, aboveCap });
  // Earliest in the month first, then by name, so who falls above a cap is stable and explainable.
  const order = (a: LiveMonthRow, b: LiveMonthRow) => a.first_live_on.localeCompare(b.first_live_on) || a.name.localeCompare(b.name) || a.retailer_id.localeCompare(b.retailer_id);
  const counted = mine.filter((r) => countsForMonth(r, month, today)).sort(order);
  const liveShops = counted.length;
  const { pricePence, capPence } = settings;
  let money: Statement['money'] = null;
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
    liveShops, shopsAboveCap: liveShops - withinCap, money,
  };
}

const pounds = (pence: number) => (pence / 100).toFixed(2);
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // A plain number (including a negative credit) is safe as it is. Anything
  // else that starts like a formula is quoted with a leading apostrophe.
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  const risky = /^[=+\-@]/.test(s);
  return risky || /[",\n]/.test(s) ? `"${(risky ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

/** The statement as a spreadsheet file. Names are escaped so one cannot be read as a formula. Pure. */
export function statementCsv(s: Statement): string {
  const rows: unknown[][] = [['Month', s.month], [s.provisional ? 'Provisional: shops live now' : 'Shops live on the last day of the month', s.decidedOn], [], ['Shop', 'Town', 'Days live', 'First live', 'Last live', 'Above the cap']];
  for (const l of s.lines) rows.push([l.name, l.town ?? '', l.liveDays, l.firstLiveOn, l.lastLiveOn, l.aboveCap ? 'yes' : '']);
  rows.push([], ['Live shops', s.liveShops]);
  if (s.money && s.settings.pricePence !== null) {
    rows.push([], [`Live shops x ${pounds(s.settings.pricePence)}`, pounds(s.money.grossPence)]);
    if (s.settings.capPence !== null) rows.push(['Monthly cap', pounds(s.settings.capPence)]);
    if (s.money.creditPence) rows.push([`Credit: above the monthly cap (${s.shopsAboveCap} shop${s.shopsAboveCap === 1 ? '' : 's'})`, `-${pounds(s.money.creditPence)}`]);
    rows.push(['Total', pounds(s.money.totalPence)]);
  }
  if (s.notCounted.length) { rows.push([], [s.provisional ? 'Not counted: live earlier this month, not live now' : 'Not counted: live during the month, not on its last day']); for (const l of s.notCounted) rows.push([l.name, l.town ?? '', l.liveDays, l.firstLiveOn, l.lastLiveOn]); }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export async function loadStatement(db: BillingDb, tenantId: string, month: string, settings: BillingSettings = billingSettingsFromEnv()): Promise<Statement> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Use a month like 2026-12');
  const { data, error } = await db.from('live_months').select('*').eq('tenant_id', tenantId).eq('month', month);
  if (error) throw new Error(error.message);
  return buildStatement(month, data || [], settings, ukDay());
}
