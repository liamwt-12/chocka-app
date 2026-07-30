import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateInviteToken,
  hashInviteToken,
  verifyInviteToken,
  inviteExpiresAt,
  isInviteExpired,
  checkInviteRedeemable,
  normaliseInviteToken,
  signInviteRef,
  parseInviteRef,
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

describe('normaliseInviteToken', () => {
  // The exact shape that locked a real retailer out on 2026-07-30: three spaces
  // injected before the last three characters, almost certainly a line wrap in
  // whatever carried the link. 46 characters instead of 43.
  it('recovers the real-world failure: three spaces injected near the end', () => {
    const good = 'NBHSflj6rekbVDytKXNMMU4rOl4JZqs4C6ImZbYiKOU';
    const mangled = 'NBHSflj6rekbVDytKXNMMU4rOl4JZqs4C6ImZbYi   KOU';
    expect(mangled).toHaveLength(46);
    expect(normaliseInviteToken(mangled)).toBe(good);
    expect(normaliseInviteToken(mangled)).toHaveLength(43);
  });

  it.each([
    ['leading space', ' abc'],
    ['trailing space', 'abc '],
    ['internal space', 'a bc'],
    ['tab', 'a\tbc'],
    ['newline', 'a\nbc'],
    ['carriage return', 'a\r\nbc'],
    ['non-breaking-ish run', 'a  \t\n bc'],
  ])('strips %s', (_label, raw) => {
    expect(normaliseInviteToken(raw)).toBe('abc');
  });

  it('leaves a clean token untouched, so normalising is idempotent', () => {
    const t = generateInviteToken();
    expect(normaliseInviteToken(t)).toBe(t);
    expect(normaliseInviteToken(normaliseInviteToken(t))).toBe(t);
  });

  it('returns empty for nothing usable, rather than throwing', () => {
    for (const v of [null, undefined, '', '   ', '\t\n']) {
      expect(normaliseInviteToken(v as string)).toBe('');
    }
  });

  // The safety argument: widening what we accept must not widen what matches.
  it('a mangled token still verifies against the real hash, and a wrong one does not', () => {
    const t = generateInviteToken();
    const h = hashInviteToken(t);
    const mangled = `${t.slice(0, 10)}  \n ${t.slice(10)}`;
    expect(verifyInviteToken(normaliseInviteToken(mangled), h)).toBe(true);
    expect(verifyInviteToken(normaliseInviteToken(`  ${generateInviteToken()}  `), h)).toBe(false);
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

describe('signInviteRef / parseInviteRef', () => {
  const ID = '3f7c1c2e-9a4b-4d1e-8c2f-0b7a6d5e4c3b';

  it('round-trips an invite id', () => {
    expect(parseInviteRef(signInviteRef(ID))).toBe(ID);
  });

  it('puts the id in front of a 64-hex signature', () => {
    const ref = signInviteRef(ID);
    expect(ref.startsWith(`${ID}.`)).toBe(true);
    expect(ref.slice(ID.length + 1)).toMatch(/^[0-9a-f]{64}$/);
  });

  // The whole point of signing: a tampered id must not verify.
  it('rejects a ref whose id was swapped for another', () => {
    const other = '11111111-2222-3333-4444-555555555555';
    const forged = `${other}.${signInviteRef(ID).split('.')[1]}`;
    expect(parseInviteRef(forged)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const ref = signInviteRef(ID);
    const flipped = ref.slice(0, -1) + (ref.endsWith('a') ? 'b' : 'a');
    expect(parseInviteRef(flipped)).toBeNull();
  });

  it('rejects a ref signed under a different secret', () => {
    const ref = signInviteRef(ID);
    process.env.CANCEL_HASH_SECRET = OTHER_SECRET;
    expect(parseInviteRef(ref)).toBeNull();
    process.env.CANCEL_HASH_SECRET = SECRET;
  });

  // A token hash must not verify as a ref, nor vice versa, even though one secret
  // signs both. This is what the differing namespaces buy.
  it('does not accept a token hash as a signature', () => {
    const token = generateInviteToken();
    expect(parseInviteRef(`${ID}.${hashInviteToken(token)}`)).toBeNull();
  });

  it('does not accept a ref signature as a token hash', () => {
    const sig = signInviteRef(ID).split('.')[1];
    expect(verifyInviteToken(ID, sig)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['separator only', '.'],
    ['empty id', `.${'a'.repeat(64)}`],
    ['empty signature', `${ID}.`],
    ['short signature', `${ID}.abc`],
    ['non-hex signature', `${ID}.${'z'.repeat(64)}`],
  ])('returns null for %s', (_label, ref) => {
    expect(parseInviteRef(ref as string)).toBeNull();
  });

  it('refuses to sign an empty id, or one containing the separator', () => {
    expect(() => signInviteRef('')).toThrow(/refusing to sign an empty invite id/);
    expect(() => signInviteRef('has.a.dot')).toThrow(/must not contain/);
  });

  it('propagates a missing secret rather than returning null', () => {
    const ref = signInviteRef(ID);
    delete process.env.CANCEL_HASH_SECRET;
    expect(() => parseInviteRef(ref)).toThrow(/CANCEL_HASH_SECRET is not set/);
    expect(() => signInviteRef(ID)).toThrow(/CANCEL_HASH_SECRET is not set/);
  });
});

describe('checkInviteRedeemable', () => {
  const now = new Date('2026-07-30T09:00:00.000Z');
  const token = generateInviteToken();
  const pending = () => ({
    status: 'pending',
    accepted_at: null as string | null,
    user_id: null as string | null,
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

  // THE REGRESSION THIS EXISTS TO PREVENT.
  //
  // Gating on accepted_at burned a real invite on 2026-07-30: a retailer clicked
  // Connect, stalled at Google's passkey prompt, never signed in, and came back to
  // "already been used". accepted_at means "clicked at least once" and must never
  // block a retry. Only user_id — set after an actual link — may.
  it('STILL redeems an invite that was clicked but never completed at Google', () => {
    expect(
      checkInviteRedeemable({ ...pending(), accepted_at: '2026-07-30T10:47:02.000Z' }, token, now),
    ).toEqual({ redeemable: true });
  });

  it('redeems after several abandoned attempts', () => {
    const abandoned = { ...pending(), accepted_at: '2026-07-30T10:47:02.000Z' };
    for (let i = 0; i < 3; i++) {
      expect(checkInviteRedeemable(abandoned, token, now).redeemable).toBe(true);
    }
  });

  // The real single-use gate: a retailer has been linked.
  it('refuses an invite whose user_id is set', () => {
    expect(
      checkInviteRedeemable({ ...pending(), user_id: 'a-user-id' }, token, now),
    ).toEqual({ redeemable: false, reason: 'already-claimed' });
  });

  // user_id is checked before status, so a linked invite whose status update failed
  // still cannot be replayed.
  it('refuses a claimed invite even if status still says pending', () => {
    expect(
      checkInviteRedeemable({ ...pending(), status: 'pending', user_id: 'a-user-id' }, token, now),
    ).toEqual({ redeemable: false, reason: 'already-claimed' });
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

  // An abandoned attempt does NOT rescue an expired invite — the 30-day window is
  // still the outer bound on retries.
  it('refuses an expired invite even if it was clicked earlier', () => {
    expect(
      checkInviteRedeemable(
        { ...pending(), accepted_at: '2026-07-02T00:00:00.000Z', expires_at: '2026-07-01T00:00:00.000Z' },
        token,
        now,
      ),
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

  it('reports already-claimed ahead of expiry, so a used invite never reads as expired', () => {
    expect(
      checkInviteRedeemable(
        { ...pending(), user_id: 'a-user-id', expires_at: '2026-07-01T00:00:00.000Z' },
        token,
        now,
      ),
    ).toEqual({ redeemable: false, reason: 'already-claimed' });
  });
});
