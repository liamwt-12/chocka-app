import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  decryptSecretAllowingPlaintext,
  isEncrypted,
  userTokenAad,
  tenantClientSecretAad,
} from './secrets';

// Deterministic test keys, constructed rather than pasted so nothing in this
// file resembles a real secret.
const KEY_A = Buffer.alloc(32, 0x07).toString('base64');
const KEY_B = Buffer.alloc(32, 0x5b).toString('base64');

// Shaped like a real Google refresh token — the actual value this protects.
const TOKEN = '1//09XyZaBcDeFgHiJkLmNoPqRsTuVwXyZ-0123456789abcdefGHIJKLMNOPqrstuvwx_yz';
const USER_ID = '3f2b1c88-0d4e-4a91-9c77-1e5a6b8d2f40';
const AAD = userTokenAad(USER_ID);

const original = process.env.SECRET_ENCRYPTION_KEY;
beforeEach(() => { process.env.SECRET_ENCRYPTION_KEY = KEY_A; });
afterEach(() => {
  if (original === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = original;
});

describe('round trip', () => {
  it('recovers a Google refresh token exactly', () => {
    expect(decryptSecret(encryptSecret(TOKEN, AAD), AAD)).toBe(TOKEN);
  });

  it('handles unicode and long values', () => {
    for (const v of ['a', 'sécret — ünicode ✓', 'x'.repeat(4096)]) {
      expect(decryptSecret(encryptSecret(v, AAD), AAD)).toBe(v);
    }
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret(TOKEN, AAD);
    const b = encryptSecret(TOKEN, AAD);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, AAD)).toBe(decryptSecret(b, AAD));
  });

  it('never leaks the plaintext into the envelope', () => {
    expect(encryptSecret(TOKEN, AAD)).not.toContain(TOKEN.slice(0, 12));
  });
});

describe('envelope format', () => {
  it('is v1 with four parts and correctly sized iv/tag', () => {
    const parts = encryptSecret(TOKEN, AAD).split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1], 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[2], 'base64url')).toHaveLength(16);
  });

  it('is base64url — safe in JSON, URLs and SQL literals without escaping', () => {
    expect(encryptSecret(TOKEN, AAD)).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe('isEncrypted', () => {
  it('classifies values correctly', () => {
    expect(isEncrypted(encryptSecret(TOKEN, AAD))).toBe(true);
    expect(isEncrypted(TOKEN)).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted('v1x.a.b.c')).toBe(false);
  });
});

describe('tamper detection', () => {
  it('rejects a modified ciphertext', () => {
    const parts = encryptSecret(TOKEN, AAD).split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), AAD)).toThrow(/authentication failed/);
  });

  it('rejects a modified auth tag', () => {
    const parts = encryptSecret(TOKEN, AAD).split('.');
    const tag = Buffer.from(parts[2], 'base64url');
    tag[0] ^= 0xff;
    parts[2] = tag.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), AAD)).toThrow(/authentication failed/);
  });

  it('rejects a truncated or malformed envelope', () => {
    expect(() => decryptSecret('v1.aaa.bbb', AAD)).toThrow(/expected 4 dot-separated parts/);
    expect(() => decryptSecret('v1.AAAA.bbb.ccc', AAD)).toThrow(/IV is \d+ bytes/);
  });
});

describe('aad binding', () => {
  it('refuses a ciphertext decrypted as a different row', () => {
    const other = userTokenAad('99999999-0000-4000-8000-000000000000');
    expect(() => decryptSecret(encryptSecret(TOKEN, AAD), other)).toThrow(/authentication failed/);
  });

  it('refuses a ciphertext decrypted as a different column', () => {
    const asColumn = tenantClientSecretAad(USER_ID);
    expect(() => decryptSecret(encryptSecret(TOKEN, AAD), asColumn)).toThrow(/authentication failed/);
  });

  it('requires an aad on both sides', () => {
    expect(() => encryptSecret(TOKEN, '')).toThrow(/aad is required/);
    expect(() => decryptSecret(encryptSecret(TOKEN, AAD), '')).toThrow(/aad is required/);
  });

  it('builds distinct aads per column and row', () => {
    expect(userTokenAad('x')).not.toBe(tenantClientSecretAad('x'));
    expect(userTokenAad('x')).not.toBe(userTokenAad('y'));
  });
});

describe('key handling', () => {
  it('refuses a ciphertext encrypted under a different key', () => {
    const sealed = encryptSecret(TOKEN, AAD);
    process.env.SECRET_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(sealed, AAD)).toThrow(/authentication failed/);
  });

  it('gives a named error when the key is missing, not a crypto stack trace', () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(() => encryptSecret(TOKEN, AAD)).toThrow(/SECRET_ENCRYPTION_KEY is not set/);
    process.env.SECRET_ENCRYPTION_KEY = '   ';
    expect(() => encryptSecret(TOKEN, AAD)).toThrow(/SECRET_ENCRYPTION_KEY is not set/);
  });

  it('rejects a key of the wrong length with actionable guidance', () => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptSecret(TOKEN, AAD)).toThrow(/must decode to 32 bytes, got 16/);
    expect(() => encryptSecret(TOKEN, AAD)).toThrow(/openssl rand -base64 32/);
  });

  it('tolerates surrounding whitespace on the key', () => {
    const sealed = encryptSecret(TOKEN, AAD);
    process.env.SECRET_ENCRYPTION_KEY = `  ${KEY_A}\n`;
    expect(decryptSecret(sealed, AAD)).toBe(TOKEN);
  });
});

describe('empty input', () => {
  it('refuses to encrypt an empty value', () => {
    expect(() => encryptSecret('', AAD)).toThrow(/refusing to encrypt an empty value/);
  });
});

describe('migration-window reader', () => {
  it('passes plaintext through unchanged', () => {
    expect(decryptSecretAllowingPlaintext(TOKEN, AAD)).toBe(TOKEN);
  });

  it('decrypts envelopes', () => {
    expect(decryptSecretAllowingPlaintext(encryptSecret(TOKEN, AAD), AAD)).toBe(TOKEN);
  });

  it('still enforces integrity on values that claim to be envelopes', () => {
    const parts = encryptSecret(TOKEN, AAD).split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => decryptSecretAllowingPlaintext(parts.join('.'), AAD)).toThrow(/authentication failed/);
  });

  it('strict decryptSecret rejects plaintext — the contract-phase behaviour', () => {
    expect(() => decryptSecret(TOKEN, AAD)).toThrow(/not a v1 envelope/);
  });
});
