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
 * THE STATEMENT. For a month: every shop live on at least BILLING_MIN_LIVE_DAYS
 * days (default 1), by name, earliest-joined first. If a monthly cap is set,
 * shops beyond it are still listed, and shown again as a credit line, so the
 * statement adds up in the open:
 *
 *     live shops x price            (every live shop)
 *     credit: shops above the cap   (those beyond the cap, at the same price)
 *     total
 *
 * NO PRICE IS WRITTEN IN THIS CODE. The repository is public. The price per
 * shop and the cap are settings:
 *     BILLING_PRICE_PENCE_PER_SHOP   whole pence; unset = counts only, no money
 *     BILLING_MONTHLY_CAP_SHOPS      a number of shops; unset = no cap
 *     BILLING_MIN_LIVE_DAYS          default 1
 *
 * It produces a statement for a person to check. It does not raise an invoice,
 * charge anything or send anything.
 */
import { shopStatus, liveRulesFromEnv, type LiveRules, type StatusInvite, type StatusUser } from './shop-status';
import { MANAGER_EMBED } from './managed-access';

export interface BillingSettings { pricePence: number | null; capShops: number | null; minLiveDays: number }

const wholeNumber = (v: string | undefined, min: number): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= min ? n : null;
};

export function billingSettingsFromEnv(env: Record<string, string | undefined> = process.env): BillingSettings {
  return {
    pricePence: wholeNumber(env.BILLING_PRICE_PENCE_PER_SHOP, 0),
    capShops: wholeNumber(env.BILLING_MONTHLY_CAP_SHOPS, 0),
    minLiveDays: wholeNumber(env.BILLING_MIN_LIVE_DAYS, 1) ?? 1,
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

export interface StatementLine { name: string; town: string | null; liveDays: number; firstLiveOn: string; lastLiveOn: string; aboveCap: boolean }
export interface Statement {
  month: string;
  settings: BillingSettings;
  lines: StatementLine[];
  /** Shops live for fewer days than the minimum: listed so nothing is hidden, not counted. */
  notCounted: StatementLine[];
  liveShops: number;
  shopsAboveCap: number;
  billableShops: number;
  /** Money, only when a price is set. */
  money: { grossPence: number; creditPence: number; totalPence: number } | null;
}

/** Build the statement for one month from its rows. Pure. */
export function buildStatement(month: string, rows: LiveMonthRow[], settings: BillingSettings): Statement {
  const mine = rows.filter((r) => r.month === month);
  const line = (r: LiveMonthRow, aboveCap = false): StatementLine => ({ name: r.name, town: r.town, liveDays: r.live_days, firstLiveOn: r.first_live_on, lastLiveOn: r.last_live_on, aboveCap });
  // Earliest in the month first, then by name, so who falls above a cap is stable and explainable.
  const order = (a: LiveMonthRow, b: LiveMonthRow) => a.first_live_on.localeCompare(b.first_live_on) || a.name.localeCompare(b.name) || a.retailer_id.localeCompare(b.retailer_id);
  const counted = mine.filter((r) => r.live_days >= settings.minLiveDays).sort(order);
  const cap = settings.capShops;
  const lines = counted.map((r, i) => line(r, cap !== null && i >= cap));
  const shopsAboveCap = lines.filter((l) => l.aboveCap).length;
  const liveShops = lines.length;
  const money = settings.pricePence === null ? null : {
    grossPence: liveShops * settings.pricePence,
    creditPence: shopsAboveCap * settings.pricePence,
    totalPence: (liveShops - shopsAboveCap) * settings.pricePence,
  };
  return { month, settings, lines, notCounted: mine.filter((r) => r.live_days < settings.minLiveDays).sort(order).map((r) => line(r)), liveShops, shopsAboveCap, billableShops: liveShops - shopsAboveCap, money };
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
  const rows: unknown[][] = [['Month', s.month], [], ['Shop', 'Town', 'Days live', 'First live', 'Last live', 'Above cap']];
  for (const l of s.lines) rows.push([l.name, l.town ?? '', l.liveDays, l.firstLiveOn, l.lastLiveOn, l.aboveCap ? 'yes' : '']);
  rows.push([], ['Live shops', s.liveShops]);
  if (s.settings.capShops !== null) rows.push(['Monthly cap (shops)', s.settings.capShops], ['Shops above the cap', s.shopsAboveCap], ['Shops charged', s.billableShops]);
  if (s.money && s.settings.pricePence !== null) {
    rows.push([], [`Live shops x ${pounds(s.settings.pricePence)}`, pounds(s.money.grossPence)]);
    if (s.shopsAboveCap) rows.push([`Credit: ${s.shopsAboveCap} shop${s.shopsAboveCap === 1 ? '' : 's'} above the cap`, `-${pounds(s.money.creditPence)}`]);
    rows.push(['Total', pounds(s.money.totalPence)]);
  }
  if (s.notCounted.length) { rows.push([], [`Not counted: live fewer than ${s.settings.minLiveDays} day(s)`]); for (const l of s.notCounted) rows.push([l.name, l.town ?? '', l.liveDays, l.firstLiveOn, l.lastLiveOn]); }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export async function loadStatement(db: BillingDb, tenantId: string, month: string, settings: BillingSettings = billingSettingsFromEnv()): Promise<Statement> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Use a month like 2026-12');
  const { data, error } = await db.from('live_months').select('*').eq('tenant_id', tenantId).eq('month', month);
  if (error) throw new Error(error.message);
  return buildStatement(month, data || [], settings);
}
