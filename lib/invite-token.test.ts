import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateInviteToken,
  hashInviteToken,
  verifyInviteToken,
  inviteExpiresAt,
  isInviteExpired,
  checkInviteRedeemable,
  DEFAULT_TTL_DAYS,
} from './invite-token';

const SECRET = 'test-cancel-hash-secret-do-not-use-in-production';
const OTHER_SECRET = 'a-different-secret';

beforeEach(() => {
  process.env.CANCEL_HASH_SECRET = SECRET;
});
afterEach(() => {
  process.env.CANCEL_HASH_SECRET = SECRET;
});

describe('generateInviteToken', () => {
  it('is URL-safe, so it can sit in a path segment unescaped', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInviteToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('encodes 32 bytes as 43 base64url chars with no padding', () => {
    const t = generateInviteToken();
    expect(t).toHaveLength(43);
    expect(t).not.toContain('=');
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateInviteToken()));
    expect(seen.size).toBe(500);
  });
});

describe('hashInviteToken', () => {
  it('produces a 64-char lowercase hex digest', () => {
    expect(hashInviteToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same token and secret', () => {
    expect(hashInviteToken('abc')).toBe(hashInviteToken('abc'));
  });

  it('differs for different tokens', () => {
    expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'));
  });

  // The namespace is what stops a token minted for one link type being replayed
  // as another. If this ever passes, the `invite:` prefix has been dropped.
  it('namespaces the token, so it is not a bare HMAC of the token', async () => {
    const { createHmac } = await import('crypto');
    const bare = createHmac('sha256', SECRET).update('abc').digest('hex');
    expect(hashInviteToken('abc')).not.toBe(bare);
    const namespaced = createHmac('sha256', SECRET).update('invite:abc').digest('hex');
    expect(hashInviteToken('abc')).toBe(namespaced);
  });

  // Guards the failure mode where a bug loses the token and every such invite
  // becomes openable by presenting the empty string.
  it('refuses to hash an empty token', () => {
    expect(() => hashInviteToken('')).toThrow(/refusing to hash an empty token/);
    expect(() => hashInviteToken(undefined as unknown as string)).toThrow();
  });

  it('throws a remediable error when the secret is missing', () => {
    delete process.env.CANCEL_HASH_SECRET;
    expect(() => hashInviteToken('abc')).toThrow(/CANCEL_HASH_SECRET is not set/);
  });
});

describe('verifyInviteToken', () => {
  it('accepts the token that produced the hash', () => {
    const t = generateInviteToken();
    expect(verifyInviteToken(t, hashInviteToken(t))).toBe(true);
  });

  it('rejects a different token', () => {
    const t = generateInviteToken();
    expect(verifyInviteToken(generateInviteToken(), hashInviteToken(t))).toBe(false);
  });

  it('rejects a token hashed under a different secret', () => {
    const t = generateInviteToken();
    process.env.CANCEL_HASH_SECRET = OTHER_SECRET;
    const otherHash = hashInviteToken(t);
    process.env.CANCEL_HASH_SECRET = SECRET;
    expect(verifyInviteToken(t, otherHash)).toBe(false);
  });

  // These must be false, not exceptions: the input is an untrusted URL segment.
  it.each([
    ['empty token', '', 'a'.repeat(64)],
    ['null token', null, 'a'.repeat(64)],
    ['undefined token', undefined, 'a'.repeat(64)],
    ['empty hash', 'tok', ''],
    ['null hash', 'tok', null],
    ['short hash', 'tok', 'abc'],
    ['long hash', 'tok', 'a'.repeat(65)],
    ['non-hex hash', 'tok', 'z'.repeat(64)],
    ['uppercase hex hash', 'tok', 'A'.repeat(64)],
  ])('returns false for %s without throwing', (_label, token, hash) => {
    expect(() => verifyInviteToken(token as string, hash as string)).not.toThrow();
    expect(verifyInviteToken(token as string, hash as string)).toBe(false);
  });

  // A missing secret is a deployment fault, not a bad request. Swallowing it
  // would show every retailer "invalid invite" while looking healthy.
  it('propagates a missing secret rather than reporting an invalid token', () => {
    const t = generateInviteToken();
    const h = hashInviteToken(t);
    delete process.env.CANCEL_HASH_SECRET;
    expect(() => verifyInviteToken(t, h)).toThrow(/CANCEL_HASH_SECRET is not set/);
  });
});

describe('inviteExpiresAt', () => {
  it('defaults to a 30-day window', () => {
    expect(DEFAULT_TTL_DAYS).toBe(30);
    const from = new Date('2026-07-30T09:00:00.000Z');
    expect(inviteExpiresAt(from).toISOString()).toBe('2026-08-29T09:00:00.000Z');
  });

  it('accepts a custom window', () => {
    const from = new Date('2026-07-30T09:00:00.000Z');
    expect(inviteExpiresAt(from, 1).toISOString()).toBe('2026-07-31T09:00:00.000Z');
  });

  it('rejects a non-positive or non-finite window', () => {
    expect(() => inviteExpiresAt(new Date(), 0)).toThrow(/positive number/);
    expect(() => inviteExpiresAt(new Date(), -1)).toThrow(/positive number/);
    expect(() => inviteExpiresAt(new Date(), NaN)).toThrow(/positive number/);
  });
});

describe('isInviteExpired', () => {
  const now = new Date('2026-07-30T09:00:00.000Z');

  it('is false inside the window', () => {
    expect(isInviteExpired('2026-07-30T09:00:01.000Z', now)).toBe(false);
  });

  it('is true past the window', () => {
    expect(isInviteExpired('2026-07-30T08:59:59.000Z', now)).toBe(true);
  });

  // Boundary is inclusive: exactly-at-expiry is expired, so a link cannot be
  // honoured on the same millisecond it lapses.
  it('treats the exact expiry instant as expired', () => {
    expect(isInviteExpired(now, now)).toBe(true);
  });

  it('accepts a Date as well as a string', () => {
    expect(isInviteExpired(new Date('2026-08-01T00:00:00.000Z'), now)).toBe(false);
  });

  // A row we cannot date is one we must not honour.
  it.each([[null], [undefined], [''], ['not-a-date']])(
    'treats %s as expired rather than valid',
    (v) => {
      expect(isInviteExpired(v as string, now)).toBe(true);
    },
  );
});

describe('checkInviteRedeemable', () => {
  const now = new Date('2026-07-30T09:00:00.000Z');
  const token = generateInviteToken();
  const pending = () => ({
    status: 'pending',
    accepted_at: null,
    expires_at: '2026-08-29T09:00:00.000Z',
    token_hash: hashInviteToken(token),
  });

  it('redeems a pending, unexpired invite with the right token', () => {
    expect(checkInviteRedeemable(pending(), token, now)).toEqual({ redeemable: true });
  });

  it('refuses a missing invite', () => {
    expect(checkInviteRedeemable(null, token, now)).toEqual({
      redeemable: false,
      reason: 'bad-token',
    });
  });

  // The single-use gate. accepted_at is checked before status so a row that was
  // accepted but whose status update failed still cannot be replayed.
  it('refuses an already-accepted invite even if status still says pending', () => {
    expect(
      checkInviteRedeemable({ ...pending(), accepted_at: '2026-07-29T10:00:00.000Z' }, token, now),
    ).toEqual({ redeemable: false, reason: 'already-accepted' });
  });

  it('refuses a revoked invite', () => {
    expect(checkInviteRedeemable({ ...pending(), status: 'revoked' }, token, now)).toEqual({
      redeemable: false,
      reason: 'not-pending',
    });
  });

  it('refuses an expired invite', () => {
    expect(
      checkInviteRedeemable({ ...pending(), expires_at: '2026-07-01T00:00:00.000Z' }, token, now),
    ).toEqual({ redeemable: false, reason: 'expired' });
  });

  it('refuses a wrong token on an otherwise valid invite', () => {
    expect(checkInviteRedeemable(pending(), generateInviteToken(), now)).toEqual({
      redeemable: false,
      reason: 'bad-token',
    });
  });

  // Order matters: state is rejected before the token is checked, so response
  // timing cannot reveal whether a retailer has a pending invite to someone who
  // does not hold its token.
  it('reports expiry, not bad-token, when both are wrong', () => {
    expect(
      checkInviteRedeemable(
        { ...pending(), expires_at: '2026-07-01T00:00:00.000Z' },
        'wrong-token',
        now,
      ),
    ).toEqual({ redeemable: false, reason: 'expired' });
  });
});
