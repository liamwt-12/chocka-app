/**
 * Application-level encryption for secrets stored in the database.
 *
 * Spec: SECRETS_AT_REST.md. Envelope format:
 *
 *     v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
 *
 * AES-256-GCM, 12-byte random IV per encryption, 16-byte auth tag. The version
 * prefix makes key rotation a `v2.` writer plus a dual-format reader rather
 * than a schema migration.
 *
 * WHY THIS EXISTS AT ALL: Supabase already encrypts disk at rest and the
 * MapBoost project has backups + PITR, so storage-level encryption is a solved
 * problem. What this defends is a reader of the *table* — a leaked service-role
 * key, a backup dump, a SQL-editor screenshot, a future RLS mistake. That is
 * why the key comes from the environment and never from Postgres: pgsodium and
 * Vault would put the key within reach of the same service-role compromise that
 * exposes the ciphertext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ENV_VAR = 'SECRET_ENCRYPTION_KEY';

/**
 * Read and validate the key. Deliberately called per operation rather than at
 * module load: a top-level throw would break `next build` on any deploy where
 * the variable is absent, turning a runtime misconfiguration into a build
 * failure with a much worse error message.
 */
function loadKey(): Buffer {
  const raw = process.env[ENV_VAR];
  if (!raw || !raw.trim()) {
    throw new Error(
      `${ENV_VAR} is not set — stored secrets can be neither encrypted nor decrypted. ` +
        `Set it in the environment (Netlify: marked secret) and in .env.local for local runs.`,
    );
  }
  // Buffer.from(..., 'base64') silently drops invalid characters rather than
  // throwing, so the length check below — not a try/catch — is the real guard.
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${ENV_VAR} must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        `Generate a valid key with: openssl rand -base64 32`,
    );
  }
  return key;
}

/** True if the value carries this module's envelope prefix. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`);
}

/**
 * Additional authenticated data binds a ciphertext to the exact column and row
 * it belongs to, so a value lifted from one row into another fails to decrypt
 * instead of silently working. Use these builders rather than hand-written
 * strings — a typo would produce a value that cannot be decrypted later.
 */
export function userTokenAad(userId: string): string {
  return `users.google_refresh_token:${userId}`;
}
export function tenantClientSecretAad(tenantId: string): string {
  return `tenants.google_client_secret:${tenantId}`;
}

export function encryptSecret(plaintext: string, aad: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret: refusing to encrypt an empty value.');
  }
  if (!aad) {
    throw new Error('encryptSecret: aad is required — use userTokenAad()/tenantClientSecretAad().');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(stored: string, aad: string): string {
  if (!isEncrypted(stored)) {
    throw new Error(
      `decryptSecret: value is not a ${VERSION} envelope. ` +
        `A plaintext value reaching this function means the backfill did not cover it.`,
    );
  }
  if (!aad) {
    throw new Error('decryptSecret: aad is required — use userTokenAad()/tenantClientSecretAad().');
  }

  const parts = stored.split('.');
  if (parts.length !== 4) {
    throw new Error(`decryptSecret: malformed envelope — expected 4 dot-separated parts, got ${parts.length}.`);
  }
  const [, ivB64, tagB64, ctB64] = parts;

  const iv = Buffer.from(ivB64, 'base64url');
  if (iv.length !== IV_BYTES) {
    throw new Error(`decryptSecret: malformed envelope — IV is ${iv.length} bytes, expected ${IV_BYTES}.`);
  }
  const tag = Buffer.from(tagB64, 'base64url');
  if (tag.length !== TAG_BYTES) {
    throw new Error(`decryptSecret: malformed envelope — auth tag is ${tag.length} bytes, expected ${TAG_BYTES}.`);
  }

  const decipher = createDecipheriv(ALGO, loadKey(), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM cannot distinguish these cases, and deliberately so — reporting which
    // one failed would leak information to anyone probing with a guessed key.
    throw new Error(
      'decryptSecret: authentication failed — wrong key, wrong aad (value read as the wrong row/column), or the ciphertext was tampered with.',
    );
  }
}
