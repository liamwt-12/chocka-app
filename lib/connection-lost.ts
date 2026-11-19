/**
 * "Your Google connection has stopped working": a plain-text email to the shop.
 *
 * OFF BY DEFAULT. Unless CONNECTION_LOST_EMAILS=on, the job only counts and
 * logs what it would send, and sends nothing and writes nothing.
 *
 * WHEN. Once when access breaks (users.token_status becomes 'invalid'), then
 * at most once every RESEND_DAYS while it stays broken. When the shop
 * reconnects (token_status is 'valid' again) the marker is cleared, so the
 * reminders stop and a later break is told about straight away.
 *
 * WHO. Only the shop's own address (shopContactEmail, lib/shop-notices.ts):
 * never an account made through an operator account, never an operator
 * account itself (a rep's sign-in: its own lost access is for us to sort
 * out, not something to email the rep about every week), never a shop we have
 * taken off the list (retailers.delisted_at), never an account we offboarded
 * (token_status 'offboarded', which is not 'invalid'), and never a deleted
 * account (the row is gone). It must be a shop we invited: an account with no
 * shop record gets nothing.
 *
 * THE MARKER. users.connection_lost_notice_at, from migration
 * 20261121090000_connection_lost_notice_marker. It is claimed with a
 * conditional update BEFORE sending (same as the welcome email), so two runs
 * together cannot both send and a failure means a missed email, never a
 * duplicate. Until the migration is applied the read fails, and then nothing
 * is sent: without the marker there is no way to keep it to once a week.
 *
 * Runs from the hourly metrics-sync job (app/api/cron/metrics-sync/route.ts),
 * the job that notices lost access in the first place.
 */
import { shopContactEmail, connectionLostNotice, type Notice } from './shop-notices';
import { getTenantForRow, type Tenant } from './tenant';

export const CONNECTION_LOST_MIGRATION = '20261121090000_connection_lost_notice_marker';
/** At most one email a week while access stays broken. */
export const RESEND_DAYS = 7;
/** A cap per run, so this never takes over the job it runs inside. */
export const MAX_PER_RUN = 25;
const DAY = 86_400_000;

export function connectionLostEmailsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CONNECTION_LOST_EMAILS || '').trim().toLowerCase() === 'on';
}

type OneOrMany<T> = T | T[] | null | undefined;
const many = <T>(x: OneOrMany<T>): T[] => (Array.isArray(x) ? x : x ? [x] : []);

export interface LostRow {
  id: string;
  email?: string | null;
  managed_by_user_id?: string | null;
  token_status?: string | null;
  connection_lost_notice_at?: string | null;
  tenants?: { slug?: string | null } | null;
  retailers?: OneOrMany<{ name?: string | null; delisted_at?: string | null }>;
  profiles?: OneOrMany<{ business_name?: string | null }>;
}

/**
 * Is this account owed a connection-lost email now? Pure.
 * `operatorIds` are accounts that manage other accounts: never emailed.
 */
export function connectionLostDue(row: LostRow, now: Date, operatorIds: Set<string> = new Set()): boolean {
  if (row.token_status !== 'invalid') return false;
  if (!shopContactEmail(row)) return false;
  if (operatorIds.has(row.id)) return false;
  const shops = many(row.retailers);
  if (!shops.length || shops.some((s) => !!s.delisted_at)) return false;
  const last = row.connection_lost_notice_at ? Date.parse(row.connection_lost_notice_at) : NaN;
  return !Number.isFinite(last) || now.getTime() - last >= RESEND_DAYS * DAY;
}

/** The email for one account. Pure. */
export function noticeFor(row: LostRow): { to: string; notice: Notice; tenant: Tenant } | null {
  const to = shopContactEmail(row);
  if (!to) return null;
  const tenant = getTenantForRow(row);
  const businessName = many(row.profiles).find((p) => p.business_name)?.business_name || many(row.retailers).find((r) => r.name)?.name || 'your shop';
  return { to, tenant, notice: connectionLostNotice({ businessName, settingsUrl: `${tenant.appUrl}/settings`, tenant }) };
}

export interface ConnectionLostDb { from(table: string): any }
export interface ConnectionLostResult { enabled: boolean; due: number; sent: number; cleared: number; problem?: string }

const COLUMNS = 'id, email, managed_by_user_id, token_status, connection_lost_notice_at, tenants ( slug ), retailers ( name, delisted_at ), profiles ( business_name )';

/**
 * One pass: clear the marker for shops that have reconnected, then send what
 * is due. Never throws: a failure is logged and this pass sends nothing more.
 */
export async function runConnectionLostNotices(
  db: ConnectionLostDb,
  opts: { now: Date; enabled: boolean; send: (m: { to: string; subject: string; text: string; tenant: Tenant }) => Promise<boolean>; timeLeft?: () => boolean; max?: number },
): Promise<ConnectionLostResult> {
  const { now, enabled } = opts;
  const timeLeft = opts.timeLeft ?? (() => true);
  const max = opts.max ?? MAX_PER_RUN;
  const out: ConnectionLostResult = { enabled, due: 0, sent: 0, cleared: 0 };
  const stop = (problem: string) => { out.problem = problem; console.error(`[connection-lost] ${problem}`); return out; };
  try {
    // A shop that has reconnected: stop the reminders, and be ready to tell it about a later break.
    if (enabled) {
      const { data, error } = await db.from('users').update({ connection_lost_notice_at: null }).eq('token_status', 'valid').not('connection_lost_notice_at', 'is', null).select('id');
      if (error) return stop(`NOTHING SENT: could not use the marker (${error.message}). Apply migration ${CONNECTION_LOST_MIGRATION}.`);
      out.cleared = (data || []).length;
    }

    const read = (cols: string) => db.from('users').select(cols).eq('token_status', 'invalid').is('managed_by_user_id', null);
    let { data: rows, error } = await read(COLUMNS);
    // Switched off and the migration not applied yet: still count, as if none had been sent.
    if (error && !enabled) {
      ({ data: rows, error } = await read(COLUMNS.replace(' connection_lost_notice_at,', '')));
      if (!error) console.log(`[connection-lost] the marker is not in the database yet: apply migration ${CONNECTION_LOST_MIGRATION} before switching CONNECTION_LOST_EMAILS on`);
    }
    if (error) return stop(`NOTHING SENT: could not read the accounts that lost access (${error.message}). If the column is missing, apply migration ${CONNECTION_LOST_MIGRATION}.`);
    const candidates = (rows || []) as LostRow[];
    if (!candidates.length) return out;

    // An operator account (it manages other accounts) is a rep's sign-in, not a shop.
    const ids = candidates.map((r) => r.id);
    const { data: managed, error: opErr } = await db.from('users').select('managed_by_user_id').in('managed_by_user_id', ids);
    if (opErr) return stop(`NOTHING SENT: could not tell shops from operator accounts (${opErr.message}).`);
    const operators = new Set<string>((managed || []).map((m: any) => m.managed_by_user_id).filter(Boolean));

    const due = candidates.filter((r) => connectionLostDue(r, now, operators));
    out.due = due.length;
    if (!enabled) {
      if (due.length) console.log(`[connection-lost] ${due.length} connection-lost email(s) due, NOT sent: CONNECTION_LOST_EMAILS is off`);
      return out;
    }

    const nowIso = now.toISOString();
    for (const row of due) {
      if (out.sent >= max || !timeLeft()) break;
      const mail = noticeFor(row);
      if (!mail) continue;
      // Claim first, against the value we read, so only one run sends.
      let claim = db.from('users').update({ connection_lost_notice_at: nowIso }).eq('id', row.id).eq('token_status', 'invalid');
      claim = row.connection_lost_notice_at ? claim.eq('connection_lost_notice_at', row.connection_lost_notice_at) : claim.is('connection_lost_notice_at', null);
      const { data: claimed, error: claimErr } = await claim.select('id');
      if (claimErr) { console.error(`[connection-lost] could not claim the email for ${row.id}: ${claimErr.message}`); continue; }
      if (!claimed?.length) continue;
      const ok = await opts.send({ to: mail.to, subject: mail.notice.subject, text: mail.notice.text, tenant: mail.tenant });
      if (ok) out.sent++;
      else console.error(`[connection-lost] the email for ${row.id} was not accepted for sending; the next try is in ${RESEND_DAYS} days`);
    }
    if (out.due > out.sent) console.log(`[connection-lost] ${out.sent} of ${out.due} due sent this run`);
    return out;
  } catch (e: any) {
    return stop(`NOTHING MORE SENT this run: ${String(e?.message).slice(0, 200)}`);
  }
}
