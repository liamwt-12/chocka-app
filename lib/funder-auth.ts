/**
 * The Tarkett console's own login, kept apart from shop logins on purpose.
 *
 *   - FLAG. Everything here is behind TARKETT_CONSOLE_ENABLED=on, which is off.
 *     While it is off, every console page and API answers 404 and no sign-in
 *     link is ever emailed. Per-shop data is exposed nowhere until it is on.
 *   - WHO. Only people in `funder_users` (added by Liam with
 *     scripts/add-funder-user.ts) can sign in. No self-registration.
 *   - HOW. A one-time link emailed to that address. The token is 32 random
 *     bytes; only its HMAC is stored; it works once and expires after 15
 *     minutes. The link opens a confirm page, and the POST signs in, so email
 *     scanners that open links cannot use it up or sign anyone in.
 *   - SESSION. A separate cookie, `stellar_funder_session`, signed in its own
 *     namespace, valid 12 hours. A shop's session cookie can never be read as a
 *     funder session, or the other way round.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextResponse } from 'next/server';

export const FUNDER_COOKIE = 'stellar_funder_session';
export const FUNDER_SESSION_SECONDS = 12 * 3600;
export const LOGIN_TOKEN_MINUTES = 15;
export const MAX_LINKS_PER_HOUR = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Off unless Liam sets TARKETT_CONSOLE_ENABLED=on. */
export function consoleEnabled(): boolean {
  return (process.env.TARKETT_CONSOLE_ENABLED || '').trim().toLowerCase() === 'on';
}

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.CANCEL_HASH_SECRET;
  if (!s) throw new Error('SESSION_SECRET (or CANCEL_HASH_SECRET) is not set');
  return s;
}

const hmac = (ns: string, value: string) => createHmac('sha256', secret()).update(`${ns}:${value}`).digest('hex');

export function newLoginToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashLoginToken(token: string): string {
  return hmac('funder-login', token);
}

export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200 ? e : null;
}

export function createFunderSession(funderId: string, now: number = Date.now()): string {
  if (!UUID_RE.test(funderId)) throw new Error('funder id is not a UUID');
  const exp = Math.floor(now / 1000) + FUNDER_SESSION_SECONDS;
  return `f1.${funderId}.${exp}.${hmac('funder-session', `${funderId}:${exp}`)}`;
}

/** The funder id from a valid, unexpired session cookie value, or null. Never throws. */
export function verifyFunderSession(value: string | undefined | null, now: number = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'f1') return null;
  const [, id, expRaw, sig] = parts;
  if (!UUID_RE.test(id) || !/^\d{1,12}$/.test(expRaw) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (Number(expRaw) * 1000 <= now) return null;
  let expected: string;
  try { expected = hmac('funder-session', `${id}:${expRaw}`); } catch { return null; }
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

type CookieReader = { cookies: { get(name: string): { value: string } | undefined } };

export function getFunderId(request: CookieReader): string | null {
  return verifyFunderSession(request.cookies.get(FUNDER_COOKIE)?.value);
}

export function setFunderCookie(response: NextResponse, funderId: string): void {
  response.cookies.set(FUNDER_COOKIE, createFunderSession(funderId), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: FUNDER_SESSION_SECONDS,
  });
}

export function clearFunderCookie(response: NextResponse): void {
  response.cookies.delete(FUNDER_COOKIE);
}
