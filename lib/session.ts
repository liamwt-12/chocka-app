/**
 * Signed, expiring session cookie.
 *
 * WHY THIS EXISTS. Until this module, the session cookie `chocka_user_id` held
 * the user's raw UUID and nothing else. Every authenticated route read it back
 * and trusted it, so anyone who learned a user's ID could set that cookie in
 * their own browser and act as that user: read the dashboard, write to their
 * Google listing through /api/profile-fix, open the billing portal, or delete
 * the account. UUIDs are not guessable, but they are not secret either: they
 * appear in server logs, in Stripe metadata, in the admin view and in support
 * conversations. An identifier is not a credential.
 *
 * FORMAT of the new cookie `chocka_session`:
 *
 *     v1.<userId>.<expiresAtUnixSeconds>.<hmac-sha256 hex>
 *
 * The HMAC covers `session:v1:<userId>:<expires>` (namespaced in the same way as
 * the invite and review links, so a signature minted for one cannot be replayed
 * as another). Expiry is checked server-side from the signed value, not left to
 * the browser's Max-Age, so a copied cookie stops working on time.
 *
 * KEY. SESSION_SECRET if set, otherwise CANCEL_HASH_SECRET (already set in every
 * environment). The fallback exists so that merging this cannot lock every user
 * out if the new variable has not been added yet; setting SESSION_SECRET is
 * still recommended so that sessions can be rotated on their own. Rotating the
 * key signs everybody out, which is the intended effect of a rotation.
 *
 * TRANSITION. Existing users hold the old unsigned cookie (30-day Max-Age). They
 * are still accepted, with a warning in the logs, until SESSION_ACCEPT_LEGACY_COOKIE
 * is set to "false". Every new sign-in gets the signed cookie and clears the old
 * one. Once the warning stops appearing in the logs (at most 30 days after this
 * is deployed, when the last old cookie expires), set the variable to "false"
 * and the forgeable path is closed. Until then the old risk remains for anyone
 * who has not signed in again, which is why the switch-off should not be left.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'chocka_session';
export const LEGACY_COOKIE = 'chocka_user_id';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const VERSION = 'v1';
const NAMESPACE = 'session';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_RE = /^[0-9a-f]{64}$/;

/** Per call, not at module load, so a missing variable is a runtime error and not a build failure. */
function loadSecret(): string {
  const raw = process.env.SESSION_SECRET || process.env.CANCEL_HASH_SECRET;
  if (!raw || !raw.trim()) {
    throw new Error('SESSION_SECRET (or CANCEL_HASH_SECRET) is not set: sessions can be neither signed nor verified.');
  }
  return raw;
}

function sign(userId: string, expires: number): string {
  return createHmac('sha256', loadSecret()).update(`${NAMESPACE}:${VERSION}:${userId}:${expires}`).digest('hex');
}

/** Build the cookie value for a user. `now` is injectable for tests. */
export function createSessionValue(userId: string, now: number = Date.now()): string {
  if (!UUID_RE.test(userId)) throw new Error('createSessionValue: userId is not a UUID');
  const expires = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${VERSION}.${userId}.${expires}.${sign(userId, expires)}`;
}

/** Return the user ID if the value is a valid, unexpired, correctly signed session; otherwise null. Never throws. */
export function verifySessionValue(value: string | undefined | null, now: number = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [version, userId, expiresRaw, sig] = parts;
  if (version !== VERSION || !UUID_RE.test(userId) || !/^\d{1,12}$/.test(expiresRaw) || !SIG_RE.test(sig)) return null;
  const expires = Number(expiresRaw);
  if (expires * 1000 <= now) return null;
  let expected: string;
  try {
    expected = sign(userId, expires);
  } catch (e) {
    console.error('[session]', (e as Error).message);
    return null;
  }
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

/** True unless Liam has switched the old unsigned cookie off. */
export function legacyCookieAccepted(): boolean {
  return (process.env.SESSION_ACCEPT_LEGACY_COOKIE || '').trim().toLowerCase() !== 'false';
}

type CookieReader = { cookies: { get(name: string): { value: string } | undefined } };

/**
 * The signed-in user's ID for this request, or null.
 *
 * Signed cookie first. The legacy unsigned cookie is only consulted when the
 * signed one is absent, and only while the transition is open.
 */
export function getSessionUserId(request: CookieReader | NextRequest, now: number = Date.now()): string | null {
  const signed = request.cookies.get(SESSION_COOKIE)?.value;
  if (signed) {
    // A present-but-invalid signed cookie does NOT fall through to the legacy
    // one: that would let a tampered session be rescued by a forged ID.
    return verifySessionValue(signed, now);
  }
  const legacy = request.cookies.get(LEGACY_COOKIE)?.value;
  if (legacy && legacyCookieAccepted() && UUID_RE.test(legacy)) {
    console.warn('[session] accepted a legacy unsigned session cookie; this user should sign in again before SESSION_ACCEPT_LEGACY_COOKIE=false');
    return legacy;
  }
  return null;
}

/** Set the signed cookie on a response and clear the legacy one. */
export function setSessionCookie(response: NextResponse, userId: string): void {
  response.cookies.set(SESSION_COOKIE, createSessionValue(userId), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  response.cookies.delete(LEGACY_COOKIE);
}

/** Clear both cookies (account deletion). */
export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(LEGACY_COOKIE);
}
