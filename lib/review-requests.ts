/**
 * Review requests, version one. Operator-only, and OFF unless REVIEW_REQUESTS=on.
 *
 * WHAT IT DOES. A shop gives its operator a list of its own customers' email
 * addresses (a CSV: email, and optionally first_name). The operator uploads it
 * in /admin/pilot. Each address is checked, and the operator sees exactly who
 * would get the email and who would not, and why. Only after the operator types
 * the number of emails to send, and only with the switch on, is anything sent.
 *
 * WHAT EVERY EMAIL SAYS. One fixed plain-text wording, the same for everyone in
 * the file: it asks for an honest review of the shop on Google, with the shop's
 * Google "write a review" link. The only thing that changes is an optional
 * "Hello <first name>". There is no filtering by how happy a customer was, no
 * "if you were happy" wording, and nothing is offered in return. Review gating
 * and incentives are against Google's policy and, in the UK, can be an unfair
 * commercial practice (DMCC Act 2024). See docs/review-requests-notes.md (kept
 * out of the repository) for the rules this was written against.
 *
 * WHO IT IS FROM. "<Shop name> via Stellar Local", at Stellar Local's own
 * sending address, with replies going to the shop's own address (the one on the
 * account the shop itself signed in with: lib/shop-notices.ts). It is never
 * sent as if from the shop's address: that would be impersonation, and would
 * fail the shop's domain's own mail checks anyway. "via" says plainly that we
 * are sending it for them. A shop with no address of its own on record gets no
 * requests sent at all.
 *
 * UNSUBSCRIBE. Every email has a one-click unsubscribe link (and the
 * List-Unsubscribe headers mail clients use). Anyone who unsubscribes is never
 * sent a review request again by ANY shop on the platform. The suppression list
 * is checked before every single send.
 *
 * WHAT IS STORED. No address is ever stored. Each address is reduced to a hash
 * of its normalised form (hashEmail below) and only the hash is kept:
 *   - review_requests: one row per email sent, for the daily limits and the
 *     record. Deleted after REQUEST_ROW_DAYS (30 days).
 *   - review_request_history: "this shop has asked this address", so the same
 *     address is never asked twice by the same shop. Deleted after REASK_DAYS
 *     (365 days); until then the address is refused for that shop.
 *   - review_request_suppressions: unsubscribed addresses. Kept for as long as
 *     the feature exists: an unsubscribe has to keep working.
 * The uploaded file itself is never stored: it is read, checked and sent from
 * in the same request, and the operator posts it again to send.
 *
 * WHY A PLAIN SHA-256 AND NOT A KEYED HASH. A hash keyed with a secret would be
 * harder to test a guessed address against, but if the secret were ever
 * rotated or lost, every unsubscribe on record would silently stop matching and
 * people who said stop would be emailed again. That is the failure that matters
 * most here, so the hash depends on nothing but the address. The consequence,
 * stated plainly: anyone holding the table and a candidate address can tell
 * whether it is on the list. That is pseudonymisation, not anonymisation, and
 * the hashes are still personal data under UK GDPR; they are protected like the
 * rest of the database (RLS on, no public access).
 *
 * This file is pure: it parses, checks, plans and writes text. It sends nothing
 * and reads no database. lib/review-requests-data.ts does that.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Tenant } from './tenant';

// ── The switch ──────────────────────────────────────────────────────────────

/** Off unless REVIEW_REQUESTS=on. While off, a dry run is the most that can happen. */
export function reviewRequestsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.REVIEW_REQUESTS || '').trim().toLowerCase() === 'on';
}

// ── Limits (constants on purpose: a setting could be raised by accident) ────

/** Rows read from one file. More than this and the file is refused, not cut short. */
export const MAX_ROWS_PER_FILE = 1000;
/** Bytes in one file. */
export const MAX_FILE_BYTES = 200_000;
/** Emails sent by one press of Send. The rest are listed as "over the limit for one send". */
export const MAX_PER_BATCH = 25;
/** Emails one shop's requests may send in any 24 hours. */
export const MAX_PER_SHOP_PER_DAY = 50;
/** Emails all shops' requests together may send in any 24 hours. */
export const MAX_PLATFORM_PER_DAY = 300;
/**
 * Pause between two sends. Resend's default limit is about two requests a
 * second for an account; this stays under it with room for the other emails
 * the app sends at the same time.
 */
export const SEND_GAP_MS = 600;
/** Stop starting new sends after this long. The rest are reported as not reached and can be sent again. */
export const SEND_BUDGET_MS = 20_000;

// ── Retention ───────────────────────────────────────────────────────────────

/** Per-email rows (hash only) are deleted after this many days. */
export const REQUEST_ROW_DAYS = 30;
/** "Already asked by this shop" (hash only) is kept, and blocks a second request, for this many days. */
export const REASK_DAYS = 365;

export function retentionCutoffs(now: Date): { requestRowsBefore: string; historyBefore: string } {
  return {
    requestRowsBefore: new Date(now.getTime() - REQUEST_ROW_DAYS * 86_400_000).toISOString(),
    historyBefore: new Date(now.getTime() - REASK_DAYS * 86_400_000).toISOString(),
  };
}

// ── Addresses ───────────────────────────────────────────────────────────────

/** Trimmed and lower-cased, for comparing. The address is SENT to as written (trimmed). */
export function normaliseEmail(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * The hash stored in place of an address. SHA-256 of the normalised address,
 * with a fixed prefix so it matches no other use of SHA-256 on email addresses.
 * Unkeyed on purpose: see the header.
 */
export function hashEmail(email: string): string {
  return createHash('sha256').update(`review-request-email:v1:${normaliseEmail(email)}`).digest('hex');
}

const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Why an address cannot be used, or null if it can. Ordinary addresses only: no quoted local parts, no IP domains. */
export function emailProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'no email address';
  if (s.length > 254) return 'too long to be an email address';
  const at = s.lastIndexOf('@');
  if (at <= 0 || s.indexOf('@') !== at) return 'not an email address';
  const local = s.slice(0, at), domain = s.slice(at + 1);
  if (local.length > 64) return 'too long to be an email address';
  if (!LOCAL_RE.test(local)) return 'not an email address';
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return 'not an email address';
  if (!/^[A-Za-z]{2,63}$/.test(labels[labels.length - 1])) return 'not an email address';
  return null;
}

/** A first name used only if it is plainly one word of letters (with ' or -). Anything else: no name, "Hello," instead. */
export function cleanFirstName(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  return /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'-]{0,29}$/.test(s) ? s : null;
}

// ── The file ────────────────────────────────────────────────────────────────

export interface ParsedRow {
  /** Line number in the file, counting from 1, header included. What the operator sees. */
  row: number;
  /** The address as written, trimmed. */
  email: string;
  /** The first name, if one was given and it is usable. */
  firstName: string | null;
  /** Set if a first name was given but not used. */
  firstNameDropped: boolean;
  /** Why this row cannot be used, or null. */
  problem: string | null;
}

export interface ParsedFile {
  rows: ParsedRow[];
  headerFound: boolean;
  /** Set if the whole file is refused. */
  error: string | null;
}

/** One CSV line into cells. Handles "quoted, cells" and "" inside quotes. Commas, semicolons or tabs. */
function cells(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : !line.includes(',') && line.includes(';') ? ';' : ',';
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const EMAIL_HEADERS = ['email', 'e-mail', 'email address', 'e-mail address', 'emailaddress'];
const NAME_HEADERS = ['first_name', 'first name', 'firstname', 'forename', 'name'];

/**
 * Read the uploaded file. Columns: email, then optionally first_name. A header
 * row is optional: it is recognised by having no "@" and a column called email.
 * With a header, the columns can be in any order. Blank lines are skipped.
 */
export function parseRequestCsv(text: unknown): ParsedFile {
  if (typeof text !== 'string' || !text.trim()) return { rows: [], headerFound: false, error: 'The file is empty.' };
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return { rows: [], headerFound: false, error: `The file is larger than ${MAX_FILE_BYTES / 1000} KB. Split it into smaller files.` };
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  let emailCol = 0, nameCol: number | null = 1, headerFound = false;
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx >= 0) {
    const head = cells(lines[firstIdx]).map((c) => c.toLowerCase());
    if (!head.some((c) => c.includes('@')) && head.some((c) => EMAIL_HEADERS.includes(c))) {
      headerFound = true;
      emailCol = head.findIndex((c) => EMAIL_HEADERS.includes(c));
      const n = head.findIndex((c) => NAME_HEADERS.includes(c));
      nameCol = n >= 0 ? n : null;
    }
  }
  const rows: ParsedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() || (headerFound && i === firstIdx)) continue;
    if (rows.length >= MAX_ROWS_PER_FILE) return { rows: [], headerFound, error: `The file has more than ${MAX_ROWS_PER_FILE} rows. Split it into smaller files.` };
    const c = cells(lines[i]);
    const email = (c[emailCol] ?? '').trim();
    const rawName = nameCol === null ? '' : (c[nameCol] ?? '').trim();
    const firstName = cleanFirstName(rawName);
    rows.push({ row: i + 1, email, firstName, firstNameDropped: !!rawName && !firstName, problem: emailProblem(email) });
  }
  if (!rows.length) return { rows: [], headerFound, error: 'The file has no rows with an address in.' };
  return { rows, headerFound, error: null };
}

// ── Who gets it ─────────────────────────────────────────────────────────────

export interface PlanContext {
  /** The shop's own address, normalised. A row with it is left out. */
  shopEmail: string | null;
  /** Hashes on the platform-wide unsubscribe list. */
  suppressed: Set<string>;
  /** Hashes this shop has already asked, with when. */
  askedBefore: Map<string, string>;
  /** Emails this shop's requests have sent in the last 24 hours. */
  sentTodayShop: number;
  /** Emails all requests have sent in the last 24 hours. */
  sentTodayPlatform: number;
}

export interface PlanLine {
  row: number;
  email: string;
  firstName: string | null;
  firstNameDropped: boolean;
  hash: string | null;
  send: boolean;
  /** Why it will not be sent, in words for the operator. Null when it will be. */
  reason: string | null;
}

export interface Plan {
  lines: PlanLine[];
  toSend: PlanLine[];
  excluded: PlanLine[];
  /** How much of each limit is left after this batch. */
  limits: { perBatch: number; perShopPerDay: number; platformPerDay: number; shopLeftToday: number; platformLeftToday: number };
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * Decide, row by row, who would be sent the email. Pure. The order of the
 * checks is the order the reasons are reported in: a broken address, the shop's
 * own address, a repeat in this file, unsubscribed, asked before by this shop,
 * then the three limits, filled in file order.
 */
export function planRequests(rows: ParsedRow[], ctx: PlanContext): Plan {
  const seen = new Map<string, number>();
  const shopLeft = Math.max(0, MAX_PER_SHOP_PER_DAY - ctx.sentTodayShop);
  const platformLeft = Math.max(0, MAX_PLATFORM_PER_DAY - ctx.sentTodayPlatform);
  let taken = 0;
  const lines: PlanLine[] = rows.map((r) => {
    const base = { row: r.row, email: r.email, firstName: r.firstName, firstNameDropped: r.firstNameDropped };
    if (r.problem) return { ...base, hash: null, send: false, reason: r.problem };
    const norm = normaliseEmail(r.email);
    const hash = hashEmail(r.email);
    const out = (reason: string) => ({ ...base, hash, send: false, reason });
    if (ctx.shopEmail && norm === normaliseEmail(ctx.shopEmail)) return out("the shop's own address");
    const earlier = seen.get(norm);
    if (earlier !== undefined) return out(`already in this file (row ${earlier})`);
    seen.set(norm, r.row);
    if (ctx.suppressed.has(hash)) return out('unsubscribed from review requests');
    const asked = ctx.askedBefore.get(hash);
    if (asked) return out(`already asked by this shop on ${day(asked)}`);
    if (taken >= MAX_PER_BATCH) return out(`over the limit of ${MAX_PER_BATCH} for one send: send the rest next`);
    if (taken >= shopLeft) return out(`over this shop's limit of ${MAX_PER_SHOP_PER_DAY} in 24 hours`);
    if (taken >= platformLeft) return out(`over the limit of ${MAX_PLATFORM_PER_DAY} in 24 hours for all shops`);
    taken++;
    return { ...base, hash, send: true, reason: null };
  });
  return {
    lines,
    toSend: lines.filter((l) => l.send),
    excluded: lines.filter((l) => !l.send),
    limits: { perBatch: MAX_PER_BATCH, perShopPerDay: MAX_PER_SHOP_PER_DAY, platformPerDay: MAX_PLATFORM_PER_DAY, shopLeftToday: shopLeft - taken, platformLeftToday: platformLeft - taken },
  };
}

// ── The email ───────────────────────────────────────────────────────────────

const oneLine = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

export interface RequestEmailInput {
  shopName: string;
  town?: string | null;
  firstName?: string | null;
  reviewLink: string;
  unsubscribeUrl: string;
  tenant: Tenant;
}

/** The display name: "<Shop> via Stellar Local". The address in front of it is always the tenant's own. */
export function requestFromName(shopName: string, tenant: Tenant): string {
  return `${oneLine(shopName).slice(0, 80)} via ${tenant.brandName}`;
}

export function requestSubject(shopName: string): string {
  return `Would you review ${oneLine(shopName)} on Google?`;
}

/**
 * The one wording. Identical for every recipient apart from the greeting and
 * their own unsubscribe link. Do not add anything that depends on what the
 * customer thought, or offers anything: see the header, and the test that
 * fails if gating or incentive words appear.
 */
export function requestText(p: RequestEmailInput): string {
  const shop = oneLine(p.shopName);
  const town = oneLine(p.town);
  const host = p.tenant.marketingUrl.replace(/^https?:\/\//, '');
  const name = cleanFirstName(p.firstName);
  return [
    name ? `Hello ${name},` : 'Hello,',
    `${shop} asked us to send you this. If you have bought from them or had work done by them, they would be grateful for an honest review on Google, whatever your experience was.`,
    `To leave a review:\n${p.reviewLink}`,
    `If you have a question for ${shop}, reply to this email and it will go to them.`,
    'This is a single request. You will not be sent reminders.',
    `--\nSent on behalf of ${shop}${town ? `, ${town}` : ''}, by ${p.tenant.brandName} (${p.tenant.legalEntity}), ${host}.\nTo stop review requests from every shop that uses ${p.tenant.brandName}:\n${p.unsubscribeUrl}`,
  ].join('\n\n') + '\n';
}

/** Headers that let a mail client offer its own one-click unsubscribe (RFC 2369 and RFC 8058). */
export function unsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

// ── The unsubscribe link ────────────────────────────────────────────────────

/**
 * The token carries the address's hash (never the address) and a signature,
 * so nobody can unsubscribe an address they only guessed the hash of without
 * the link, and the page needs nothing from the database to know who it is
 * for. It does not expire: an unsubscribe link has to keep working.
 *
 * Signed with CANCEL_HASH_SECRET, namespaced, like every other link in our
 * emails. If that secret is ever rotated, links already sent stop verifying;
 * the page then gives the privacy address instead, and the person can still
 * reply to the email. Rotate deliberately.
 */
function secret(): string {
  const raw = process.env.CANCEL_HASH_SECRET;
  if (!raw || !raw.trim()) throw new Error('CANCEL_HASH_SECRET is not set, so unsubscribe links can be neither made nor checked');
  return raw.trim();
}

function signature(hash: string): string {
  return createHmac('sha256', secret()).update(`review-unsubscribe:${hash}`).digest('hex').slice(0, 32);
}

export function unsubscribeToken(emailHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(emailHash)) throw new Error('not an email hash');
  return `${emailHash}.${signature(emailHash)}`;
}

/** The hash the token is for, or null if it is not one of ours. */
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const m = /^([0-9a-f]{64})\.([0-9a-f]{32})$/.exec(token.trim());
  if (!m) return null;
  const expected = Buffer.from(signature(m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1] : null;
}

export function unsubscribeUrl(appUrl: string, emailHash: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/review-requests/unsubscribe?t=${unsubscribeToken(emailHash)}`;
}
