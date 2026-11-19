/**
 * Review requests: the parts that read the database and send. The rules and
 * the wording are in lib/review-requests.ts; read that first.
 *
 * Every database read and write goes through a RequestStore, so the sending
 * loop can be tested with an in-memory store and a stub mailer: nothing in the
 * tests reaches Supabase or Resend.
 */
import { randomUUID } from 'crypto';
import type { Tenant } from './tenant';
import { shopContactEmail } from './shop-notices';
import { googleReviewLink, isPlaceId } from './review-link';
import {
  reviewRequestsEnabled, parseRequestCsv, planRequests, hashEmail, emailProblem, retentionCutoffs,
  requestFromName, requestSubject, requestText, unsubscribeHeaders, unsubscribeUrl,
  REASK_DAYS, SEND_GAP_MS, SEND_BUDGET_MS, type Plan, type ParsedFile, type PlanLine,
} from './review-requests';

export const MIGRATION = '20261121100000_review_requests';
const T_REQUESTS = 'review_requests';
const T_HISTORY = 'review_request_history';
const T_SUPPRESS = 'review_request_suppressions';

export interface RequestStore {
  suppressedAmong(hashes: string[]): Promise<Set<string>>;
  isSuppressed(hash: string): Promise<boolean>;
  /** Put a hash on the do-not-email list. Idempotent. False only if it could not be recorded. */
  suppress(hash: string, source: SuppressionSource): Promise<boolean>;
  /** Hashes this shop asked on or after `since`, with when. */
  askedBefore(retailerId: string, hashes: string[], since: string): Promise<Map<string, string>>;
  /** Emails sent since `since`: for one shop, or for every shop when retailerId is null. */
  sentSince(retailerId: string | null, since: string): Promise<number>;
  /** Mark this address as asked by this shop. False if it already was (within the window): then do not send. */
  claim(retailerId: string, tenantId: string, hash: string, at: string, since: string): Promise<boolean>;
  /** Undo a claim after a send that failed, so the address can be tried again. */
  release(retailerId: string, hash: string, at: string): Promise<void>;
  record(row: { retailer_id: string; tenant_id: string; email_hash: string; batch_id: string; status: 'sent' | 'failed'; created_at: string }): Promise<void>;
}

/** Hashes are 64 characters; 100 of them keep each query's address short. */
const CHUNK = 100;
const chunks = <T,>(xs: T[]) => { const out: T[][] = []; for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK)); return out; };
const fail = (what: string, error: { message?: string } | null) => {
  if (error) throw new Error(`could not ${what} (${String(error.message || 'error').slice(0, 120)}). If the tables are missing, apply migration ${MIGRATION}.`);
};

export function supabaseStore(db: any): RequestStore {
  return {
    async suppressedAmong(hashes) {
      const out = new Set<string>();
      for (const part of chunks(hashes)) {
        const { data, error } = await db.from(T_SUPPRESS).select('email_hash').in('email_hash', part);
        fail('read the unsubscribe list', error);
        for (const r of data || []) out.add(r.email_hash);
      }
      return out;
    },
    async isSuppressed(hash) {
      const { data, error } = await db.from(T_SUPPRESS).select('email_hash').eq('email_hash', hash).limit(1);
      fail('read the unsubscribe list', error);
      return !!data?.length;
    },
    suppress: (hash, source) => suppress(db, hash, source),
    async askedBefore(retailerId, hashes, since) {
      const out = new Map<string, string>();
      for (const part of chunks(hashes)) {
        const { data, error } = await db.from(T_HISTORY).select('email_hash, first_asked_at').eq('retailer_id', retailerId).gte('first_asked_at', since).in('email_hash', part);
        fail('read who this shop has asked', error);
        for (const r of data || []) out.set(r.email_hash, r.first_asked_at);
      }
      return out;
    },
    async sentSince(retailerId, since) {
      let q = db.from(T_REQUESTS).select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', since);
      if (retailerId) q = q.eq('retailer_id', retailerId);
      const { count, error } = await q;
      fail('count what has been sent', error);
      return count ?? 0;
    },
    async claim(retailerId, tenantId, hash, at, since) {
      const { error } = await db.from(T_HISTORY).insert({ retailer_id: retailerId, tenant_id: tenantId, email_hash: hash, first_asked_at: at });
      if (!error) return true;
      if (error.code !== '23505') fail('record the request', error);
      // Already there. Only an entry older than the window (not yet deleted by
      // the daily clear-out) may be taken over.
      const { data, error: e2 } = await db.from(T_HISTORY).update({ first_asked_at: at }).eq('retailer_id', retailerId).eq('email_hash', hash).lt('first_asked_at', since).select('email_hash');
      fail('record the request', e2);
      return !!data?.length;
    },
    async release(retailerId, hash, at) {
      const { error } = await db.from(T_HISTORY).delete().eq('retailer_id', retailerId).eq('email_hash', hash).eq('first_asked_at', at);
      if (error) console.error(`[review-requests] could not release a claim after a failed send: ${error.message}`);
    },
    async record(row) {
      const { error } = await db.from(T_REQUESTS).insert(row);
      if (error) console.error(`[review-requests] could not record a ${row.status} send: ${error.message}`);
    },
  };
}

// ── The shop ────────────────────────────────────────────────────────────────

export interface RequestShop {
  id: string;
  tenantId: string;
  name: string;
  town: string | null;
  /** The shop's own address: replies go here. */
  contactEmail: string;
  reviewLink: string;
}

/**
 * The shop, if requests can be sent for it at all. Refused, with the reason,
 * if it is not this tenant's, has gone, has not connected its own Google
 * listing (the link must be the listing the shop manages, not one we matched),
 * or has no address that is certainly its own to take the replies.
 */
export async function loadRequestShop(db: any, tenantId: string, retailerId: unknown): Promise<{ ok: true; shop: RequestShop } | { ok: false; error: string }> {
  if (typeof retailerId !== 'string' || !retailerId) return { ok: false, error: 'No shop chosen.' };
  const { data: r, error } = await db.from('retailers').select('id, name, town, user_id, delisted_at').eq('id', retailerId).eq('tenant_id', tenantId).maybeSingle();
  if (error) return { ok: false, error: `Could not read the shop (${error.message}).` };
  if (!r) return { ok: false, error: 'Shop not found.' };
  if (r.delisted_at) return { ok: false, error: 'This shop is no longer listed.' };
  if (!r.user_id) return { ok: false, error: 'This shop has not connected yet, so there is no listing to send people to and no address of its own for replies.' };
  const { data: u, error: uErr } = await db.from('users').select('id, email, managed_by_user_id, profiles ( google_place_id )').eq('id', r.user_id).maybeSingle();
  if (uErr || !u) return { ok: false, error: 'Could not read the shop\'s account.' };
  const contactEmail = shopContactEmail(u);
  if (!contactEmail) return { ok: false, error: 'This shop has no address of its own on record (it was set up through an operator account, or the address is missing), so replies could not go to it. Nothing can be sent for it.' };
  const placeId = u.profiles?.[0]?.google_place_id;
  const reviewLink = isPlaceId(placeId) ? googleReviewLink(placeId) : null;
  if (!reviewLink) return { ok: false, error: 'This shop\'s connected listing has no Google place ID, so there is no review link to send.' };
  return { ok: true, shop: { id: r.id, tenantId, name: r.name, town: r.town ?? null, contactEmail, reviewLink } };
}

// ── Dry run ─────────────────────────────────────────────────────────────────

export interface Prepared { parsed: ParsedFile; plan: Plan | null }

/** Read the file and decide who would get the email. Reads the database; sends nothing; writes nothing. */
export async function prepareRequests(store: RequestStore, shop: RequestShop, csv: unknown, now: Date): Promise<Prepared> {
  const parsed = parseRequestCsv(csv);
  if (parsed.error) return { parsed, plan: null };
  const hashes = Array.from(new Set(parsed.rows.filter((r) => !r.problem).map((r) => hashEmail(r.email))));
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const windowStart = new Date(now.getTime() - REASK_DAYS * 86_400_000).toISOString();
  const [suppressed, askedBefore, sentTodayShop, sentTodayPlatform] = await Promise.all([
    store.suppressedAmong(hashes),
    store.askedBefore(shop.id, hashes, windowStart),
    store.sentSince(shop.id, dayAgo),
    store.sentSince(null, dayAgo),
  ]);
  return { parsed, plan: planRequests(parsed.rows, { shopEmail: shop.contactEmail, suppressed, askedBefore, sentTodayShop, sentTodayPlatform }) };
}

/** Exactly what one recipient would receive. */
export function composeRequest(shop: RequestShop, line: Pick<PlanLine, 'email' | 'firstName' | 'hash'>, tenant: Tenant) {
  const unsub = unsubscribeUrl(tenant.appUrl, line.hash!);
  return {
    to: line.email,
    fromName: requestFromName(shop.name, tenant),
    replyTo: shop.contactEmail,
    subject: requestSubject(shop.name),
    text: requestText({ shopName: shop.name, town: shop.town, firstName: line.firstName, reviewLink: shop.reviewLink, unsubscribeUrl: unsub, tenant }),
    headers: unsubscribeHeaders(unsub),
    tenant,
  };
}

export type Composed = ReturnType<typeof composeRequest>;

/** The confirmation the operator must type: the number of emails that will go. */
export function confirmationMatches(plan: Plan, typed: unknown): boolean {
  return plan.toSend.length > 0 && String(typed ?? '').trim() === String(plan.toSend.length);
}

// ── Send ────────────────────────────────────────────────────────────────────

export interface SendDeps {
  /** The mailer. lib/email.ts sendEmail in the app; a stub in tests. */
  send: (email: Composed) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  gapMs?: number;
  budgetMs?: number;
}

export interface SendResult {
  refused: string | null;
  batchId: string | null;
  sent: number;
  failed: Array<{ row: number; email: string }>;
  skipped: Array<{ row: number; email: string; reason: string }>;
  notReached: Array<{ row: number; email: string }>;
}

/**
 * Send to everyone the plan says, one at a time. Refuses outright unless the
 * switch is on. Before EACH send: the unsubscribe list is checked again, and
 * the address is claimed for this shop, so two sends at once cannot both ask
 * it. A failed send gives the claim back, so it can be tried again.
 */
export async function sendRequests(store: RequestStore, shop: RequestShop, plan: Plan, tenant: Tenant, deps: SendDeps): Promise<SendResult> {
  const result: SendResult = { refused: null, batchId: null, sent: 0, failed: [], skipped: [], notReached: [] };
  if (!reviewRequestsEnabled(deps.env ?? process.env)) return { ...result, refused: 'Review requests are switched off (REVIEW_REQUESTS). Nothing was sent.' };
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const gap = deps.gapMs ?? SEND_GAP_MS;
  const budget = deps.budgetMs ?? SEND_BUDGET_MS;
  const started = now().getTime();
  const batchId = randomUUID();
  result.batchId = batchId;

  for (let i = 0; i < plan.toSend.length; i++) {
    const line = plan.toSend[i];
    if (!line.hash) continue;
    if (now().getTime() - started >= budget) { result.notReached.push(...plan.toSend.slice(i).map((l) => ({ row: l.row, email: l.email }))); break; }
    const at = now().toISOString();
    const windowStart = new Date(now().getTime() - REASK_DAYS * 86_400_000).toISOString();
    if (!(await store.claim(shop.id, shop.tenantId, line.hash, at, windowStart))) { result.skipped.push({ row: line.row, email: line.email, reason: 'already asked by this shop' }); continue; }
    // The do-not-email list, read again for this one address as the very last
    // step before its email goes: whatever the dry run said, someone added
    // since (by their link, or by an operator) is not sent to. If the list
    // cannot be read, the claim is given back and nothing more is sent.
    let suppressed: boolean;
    try { suppressed = await store.isSuppressed(line.hash); } catch (e) { await store.release(shop.id, line.hash, at); throw e; }
    if (suppressed) { await store.release(shop.id, line.hash, at); result.skipped.push({ row: line.row, email: line.email, reason: 'unsubscribed' }); continue; }
    const ok = await deps.send(composeRequest(shop, line, tenant));
    await store.record({ retailer_id: shop.id, tenant_id: shop.tenantId, email_hash: line.hash, batch_id: batchId, status: ok ? 'sent' : 'failed', created_at: at });
    if (ok) result.sent++;
    else { result.failed.push({ row: line.row, email: line.email }); await store.release(shop.id, line.hash, at); }
    if (i < plan.toSend.length - 1 && gap > 0) await sleep(gap);
  }
  return result;
}

// ── Retention ───────────────────────────────────────────────────────────────

/**
 * Delete per-email rows older than 30 days, and "already asked" entries older
 * than 365 days. The do-not-email list is NEVER touched, here or anywhere: an
 * unsubscribe is permanent (a test reads the code to hold it to that). Called once a day by
 * the onboarding-sequence job (two deletes, well inside its time). Never
 * throws: a failure is returned and logged, and tried again the next day.
 */
export async function purgeReviewRequests(db: any, now: Date): Promise<{ ok: boolean; requestsDeleted: number; historyDeleted: number; detail?: string }> {
  const c = retentionCutoffs(now);
  try {
    const a = await db.from(T_REQUESTS).delete({ count: 'exact' }).lt('created_at', c.requestRowsBefore);
    if (a.error) return { ok: false, requestsDeleted: 0, historyDeleted: 0, detail: a.error.message };
    const b = await db.from(T_HISTORY).delete({ count: 'exact' }).lt('first_asked_at', c.historyBefore);
    if (b.error) return { ok: false, requestsDeleted: a.count ?? 0, historyDeleted: 0, detail: b.error.message };
    return { ok: true, requestsDeleted: a.count ?? 0, historyDeleted: b.count ?? 0 };
  } catch (e: any) {
    return { ok: false, requestsDeleted: 0, historyDeleted: 0, detail: String(e?.message || e) };
  }
}

// ── The do-not-email list ───────────────────────────────────────────────────

/** How an address came to be on the list: its own unsubscribe link, or an operator by hand. */
export type SuppressionSource = 'link' | 'operator';

/**
 * Add an address's hash to the do-not-email list. Doing it twice is harmless:
 * the first entry, with its time and source, is kept, and the answer is the
 * same either way. There is deliberately no function that takes one off: an
 * unsubscribe is permanent.
 */
export async function suppress(db: any, emailHash: string, source: SuppressionSource): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(emailHash)) return false;
  const { error } = await db.from(T_SUPPRESS).upsert({ email_hash: emailHash, source }, { onConflict: 'email_hash', ignoreDuplicates: true });
  if (error) { console.error(`[review-requests] do-not-email entry not recorded: ${error.message}`); return false; }
  return true;
}

/**
 * An operator adds an address by hand (someone replied "stop" to a shop).
 * The address goes through exactly the same emailProblem and hashEmail as a
 * row in an uploaded file, so case and surrounding spaces never matter and the
 * hash is the one every send checks. The answer never says whether it was on
 * the list already. Works whether or not REVIEW_REQUESTS is on.
 */
export async function addToDoNotEmail(store: Pick<RequestStore, 'suppress'>, raw: unknown): Promise<{ ok: true } | { ok: false; status: 400 | 500; error: string }> {
  if (typeof raw !== 'string' || raw.length > 320) return { ok: false, status: 400, error: 'That is not an email address. Nothing was added.' };
  const problem = emailProblem(raw);
  if (problem) return { ok: false, status: 400, error: problem === 'no email address' ? 'Type an email address first. Nothing was added.' : `That is ${problem}. Nothing was added.` };
  if (!(await store.suppress(hashEmail(raw), 'operator'))) return { ok: false, status: 500, error: 'Could not record it just now. Try again in a minute.' };
  return { ok: true };
}
