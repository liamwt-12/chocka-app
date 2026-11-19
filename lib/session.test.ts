import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createSessionValue,
  verifySessionValue,
  getSessionUserId,
  SESSION_COOKIE,
  LEGACY_COOKIE,
  SESSION_TTL_SECONDS,
} from './session';

const UID = '3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b';
const OTHER = '11111111-2222-4333-8444-555555555555';
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

function req(cookies: Record<string, string>) {
  return { cookies: { get: (n: string) => (n in cookies ? { value: cookies[n] } : undefined) } };
}

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-session-secret';
  delete process.env.SESSION_ACCEPT_LEGACY_COOKIE;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SESSION_SECRET;
  delete process.env.SESSION_ACCEPT_LEGACY_COOKIE;
});

describe('signed session value', () => {
  it('round-trips a user ID', () => {
    expect(verifySessionValue(createSessionValue(UID, NOW), NOW)).toBe(UID);
  });

  it('rejects a value whose user ID was swapped (the original forgery)', () => {
    const v = createSessionValue(UID, NOW).replace(UID, OTHER);
    expect(verifySessionValue(v, NOW)).toBeNull();
  });

  it('rejects an extended expiry', () => {
    const [ver, id, exp, sig] = createSessionValue(UID, NOW).split('.');
    expect(verifySessionValue([ver, id, String(Number(exp) + 999999), sig].join('.'), NOW)).toBeNull();
  });

  it('expires after the TTL, checked server-side', () => {
    const v = createSessionValue(UID, NOW);
    expect(verifySessionValue(v, NOW + (SESSION_TTL_SECONDS - 60) * 1000)).toBe(UID);
    expect(verifySessionValue(v, NOW + (SESSION_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it('rejects a value signed under a different key', () => {
    const v = createSessionValue(UID, NOW);
    process.env.SESSION_SECRET = 'rotated';
    expect(verifySessionValue(v, NOW)).toBeNull();
  });

  it('falls back to CANCEL_HASH_SECRET so a merge cannot lock everyone out', () => {
    delete process.env.SESSION_SECRET;
    process.env.CANCEL_HASH_SECRET = 'cancel-secret';
    expect(verifySessionValue(createSessionValue(UID, NOW), NOW)).toBe(UID);
    delete process.env.CANCEL_HASH_SECRET;
  });

  it('returns null rather than throwing when no secret is configured', () => {
    const v = createSessionValue(UID, NOW);
    delete process.env.SESSION_SECRET;
    delete process.env.CANCEL_HASH_SECRET;
    expect(verifySessionValue(v, NOW)).toBeNull();
  });

  it.each(['', 'garbage', UID, `v1.${UID}.123`, `v2.${UID}.9999999999.${'a'.repeat(64)}`, `v1.not-a-uuid.9999999999.${'a'.repeat(64)}`])(
    'rejects malformed value %#',
    (v) => {
      expect(verifySessionValue(v, NOW)).toBeNull();
    },
  );

  it('refuses to sign something that is not a UUID', () => {
    expect(() => createSessionValue('admin', NOW)).toThrow();
  });
});

describe('getSessionUserId', () => {
  it('reads the signed cookie', () => {
    expect(getSessionUserId(req({ [SESSION_COOKIE]: createSessionValue(UID, NOW) }), NOW)).toBe(UID);
  });

  it('accepts the legacy unsigned cookie during the transition', () => {
    expect(getSessionUserId(req({ [LEGACY_COOKIE]: UID }), NOW)).toBe(UID);
  });

  it('rejects the legacy cookie once SESSION_ACCEPT_LEGACY_COOKIE=false', () => {
    process.env.SESSION_ACCEPT_LEGACY_COOKIE = 'false';
    expect(getSessionUserId(req({ [LEGACY_COOKIE]: UID }), NOW)).toBeNull();
  });

  it('does not let a forged legacy cookie rescue a tampered signed one', () => {
    const bad = createSessionValue(UID, NOW).replace(UID, OTHER);
    expect(getSessionUserId(req({ [SESSION_COOKIE]: bad, [LEGACY_COOKIE]: OTHER }), NOW)).toBeNull();
  });

  it('ignores a legacy cookie that is not a UUID', () => {
    expect(getSessionUserId(req({ [LEGACY_COOKIE]: "x' or 1=1" }), NOW)).toBeNull();
  });

  it('returns null with no cookies', () => {
    expect(getSessionUserId(req({}), NOW)).toBeNull();
  });
});
