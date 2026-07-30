/**
 * Single-use invite tokens for the Stellar retailer onboarding flow.
 *
 * The token is what a Tarkett retailer receives in an email and carries in a URL:
 *
 *     https://app.stellarlocal.co.uk/invite/<token>
 *
 * Only the HMAC of the token is stored (`retailer_invites.token_hash`). The
 * plaintext exists in exactly two places — the email that was sent, and the URL
 * the retailer clicks — so a leaked database dump yields no working invite links.
 * `generateInviteToken` returns it once; if it is lost before the email goes out,
 * re-issue rather than trying to recover it.
 *
 * WHAT THE SECRET IS AND IS NOT DOING. The security here rests on the token being
 * 32 bytes of CSPRNG output, not on the HMAC key. Guessing a token is infeasible
 * regardless of the key, and an attacker holding `token_hash` cannot invert
 * SHA-256 over a 256-bit random preimage even with the key in hand. The HMAC is
 * defence-in-depth and consistency with the existing signed-link convention in
 * lib/cron.ts — it is deliberately NOT load-bearing, so nobody later reads this
 * file and concludes that rotating the secret invalidates outstanding invites in
 * a security-relevant way. (It does invalidate them — see rotation note below —
 * just not because the secret was protecting much.)
 *
 * NAMESPACING. Tokens are hashed as `invite:<token>`, following
 * generateReviewHash's `review:<id>` convention in lib/cron.ts, so one secret can
 * serve several link types without a token minted for one being replayable as
 * another.
 *
 * NOT TRUNCATED. generateCancelHash cuts its digest to 16 hex chars (64 bits).
 * That is a reasonable trade for a link that cancels one scheduled post; it is
 * not one for a link that establishes who somebody is. The full 64-hex digest is
 * stored.
 *
 * ROTATION. Changing CANCEL_HASH_SECRET makes every outstanding invite
 * unverifiable, because the stored hashes were computed under the old key. That
 * is recoverable — revoke and re-issue the pending rows, of which there is at
 * most one per retailer — but it is not free, so rotate deliberately.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** 32 bytes = 256 bits of entropy, base64url-encoded to 43 URL-safe chars. */
const TOKEN_BYTES = 32;

/** Hex SHA-256 digest length. A stored hash of any other length is malformed. */
const HASH_HEX_LENGTH = 64;

const NAMESPACE = 'invite';
const ENV_VAR = 'CANCEL_HASH_SECRET';

/** Single-use, 30-day window, re-issuable — the agreed invite policy. */
export const DEFAULT_TTL_DAYS = 30;

/**
 * Read the signing secret. Called per operation rather than at module load, for
 * the same reason as lib/secrets.ts loadKey(): a top-level throw would fail
 * `next build` on any deploy missing the variable, converting a runtime
 * misconfiguration into a build error with a far worse message.
 */
function loadSecret(): string {
  const raw = process.env[ENV_VAR];
  if (!raw || !raw.trim()) {
    throw new Error(
      `${ENV_VAR} is not set — invite tokens can be neither issued nor verified. ` +
        `Set it in the environment (Netlify: marked secret) and in .env.local for local runs.`,
    );
  }
  return raw.trim();
}

/**
 * Mint a new invite token. Returns the plaintext, which is never persisted —
 * store `hashInviteToken(token)` and put the token itself only in the email.
 */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * The value to store in `retailer_invites.token_hash`.
 *
 * Rejects an empty token rather than hashing it: `hashInviteToken('')` would
 * otherwise produce a stable, valid-looking digest that any other empty token
 * would match, so a bug that lost the token would create an invite openable by
 * anyone who guessed the empty string.
 */
export function hashInviteToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('hashInviteToken: refusing to hash an empty token.');
  }
  return createHmac('sha256', loadSecret()).update(`${NAMESPACE}:${token}`).digest('hex');
}

/**
 * Constant-time check of a presented token against a stored hash.
 *
 * Returns false rather than throwing for anything malformed — a caller handling
 * an untrusted URL segment should get "no" for a bad token, not an exception that
 * has to be distinguished from a genuine server error. The one exception is a
 * missing secret, which is a deployment fault rather than a bad request and must
 * not be swallowed into a silent "invalid invite" for every retailer.
 *
 * timingSafeEqual throws on length mismatch, so lengths are checked first; a
 * differing length is a non-match, and leaks nothing beyond what the fixed digest
 * length already implies.
 */
export function verifyInviteToken(
  token: string | null | undefined,
  storedHash: string | null | undefined,
): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  if (typeof storedHash !== 'string' || storedHash.length !== HASH_HEX_LENGTH) return false;
  if (!/^[0-9a-f]+$/.test(storedHash)) return false;

  const expected = Buffer.from(hashInviteToken(token), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * The `expires_at` to persist alongside a freshly minted token.
 *
 * `from` is injectable so tests do not depend on the clock, and so a backfill can
 * date a window from when an invite was actually sent rather than from now.
 */
export function inviteExpiresAt(from: Date = new Date(), ttlDays: number = DEFAULT_TTL_DAYS): Date {
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    throw new Error(`inviteExpiresAt: ttlDays must be a positive number, got ${ttlDays}.`);
  }
  return new Date(from.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

/**
 * Whether an invite's window has closed.
 *
 * Expiry is computed from `expires_at`, never read from `status` — the migration
 * deliberately omits an 'expired' status so there is one source of truth that
 * cannot drift when a sweep job runs late. An unparseable or absent timestamp
 * counts as expired: a row we cannot date is one we must not honour.
 */
export function isInviteExpired(expiresAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}

// ── Carrying the invite through Google OAuth ─────────────────────────────────
//
// After acceptance the retailer is sent to Google, and something has to survive
// that round trip so the callback knows which invite they came from. That
// something is the OAuth `state` parameter, which lib/google.ts already accepts
// and app/api/auth/callback/google already round-trips as `{ action, plan }`.
//
// WHY NOT A COOKIE. A pre-auth cookie would have to be SameSite=Lax to survive a
// cross-site top-level redirect back from Google. That probably works — but
// `state` is round-tripped by the OAuth spec itself, so using it removes the
// question instead of leaving it resting on browser behaviour nobody tested.
//
// WHAT TRAVELS. The invite's id and an HMAC of it. NEVER the token: `state` goes
// through Google's systems, server logs and browser history, and a token there
// would be a credential in three places it has no business being. The id is a
// uuid — not a secret — so the signature is doing integrity, not confidentiality:
// without it, anyone could edit `state` to nominate a different retailer's invite
// and have their Google account linked to it.
//
// The namespace differs from the token's on purpose. A token hash must not verify
// as a ref, nor a ref as a token hash, even though one secret signs both.

const REF_NAMESPACE = 'invite-ref';
const REF_SEPARATOR = '.';

function refMac(inviteId: string): string {
  return createHmac('sha256', loadSecret()).update(`${REF_NAMESPACE}:${inviteId}`).digest('hex');
}

/** `<inviteId>.<hmac>` — safe to put in an OAuth state parameter. */
export function signInviteRef(inviteId: string): string {
  if (typeof inviteId !== 'string' || inviteId.length === 0) {
    throw new Error('signInviteRef: refusing to sign an empty invite id.');
  }
  if (inviteId.includes(REF_SEPARATOR)) {
    // A uuid never contains '.', so this is a bug rather than input to tolerate —
    // and tolerating it would make the split below ambiguous.
    throw new Error(`signInviteRef: invite id must not contain '${REF_SEPARATOR}': ${inviteId}`);
  }
  return `${inviteId}${REF_SEPARATOR}${refMac(inviteId)}`;
}

/**
 * The invite id from a signed ref, or null if it is absent, malformed or the
 * signature does not verify.
 *
 * Returns null rather than throwing for bad input, because this parses a value
 * that came back through Google and is therefore attacker-influenced. A missing
 * secret still throws, as everywhere else in this module.
 *
 * The caller MUST still load the invite and re-check it. A valid signature proves
 * only that this id was issued by us, not that the invite is still pending,
 * unexpired or unclaimed.
 */
export function parseInviteRef(ref: string | null | undefined): string | null {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  const cut = ref.lastIndexOf(REF_SEPARATOR);
  if (cut <= 0 || cut === ref.length - 1) return null;

  const inviteId = ref.slice(0, cut);
  const presented = ref.slice(cut + 1);
  if (presented.length !== HASH_HEX_LENGTH || !/^[0-9a-f]+$/.test(presented)) return null;

  const expected = Buffer.from(refMac(inviteId), 'hex');
  const actual = Buffer.from(presented, 'hex');
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? inviteId : null;
}

export interface InviteRedeemability {
  redeemable: boolean;
  /** Machine-readable reason when not redeemable, for logging and tests. */
  reason?: 'not-pending' | 'already-accepted' | 'expired' | 'bad-token';
}

/**
 * The whole gate in one place: is this presented token good for this invite row?
 *
 * Kept here rather than inline in the route so the four ways an invite can fail
 * are enumerated in one testable function. Order matters: the token is checked
 * last so that a caller cannot use response timing to learn whether a given
 * retailer has a pending invite before proving they hold its token.
 */
export function checkInviteRedeemable(
  invite: { status?: string | null; accepted_at?: string | Date | null; expires_at?: string | Date | null; token_hash?: string | null } | null | undefined,
  presentedToken: string | null | undefined,
  now: Date = new Date(),
): InviteRedeemability {
  if (!invite) return { redeemable: false, reason: 'bad-token' };
  if (invite.accepted_at) return { redeemable: false, reason: 'already-accepted' };
  if (invite.status !== 'pending') return { redeemable: false, reason: 'not-pending' };
  if (isInviteExpired(invite.expires_at, now)) return { redeemable: false, reason: 'expired' };
  if (!verifyInviteToken(presentedToken, invite.token_hash)) {
    return { redeemable: false, reason: 'bad-token' };
  }
  return { redeemable: true };
}
