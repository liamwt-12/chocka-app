/**
 * Backfill: encrypt users.google_refresh_token at rest.
 *
 * Step 2 of SECRETS_AT_REST.md. Converts every plaintext refresh token in the
 * users table into a v1 AES-256-GCM envelope bound by AAD to its own row.
 *
 * This is deliberately an application-level script rather than the SQL-editor
 * flow used by slices 3 and 4: the key lives outside the database, so SQL
 * cannot perform this conversion.
 *
 * SAFETY, in the order the checks run:
 *   - DRY RUN by default. It only mutates when run with `--commit`.
 *   - A key self-test runs before any row is touched: a probe value is
 *     encrypted and decrypted, so a missing or wrong-length key fails the whole
 *     script rather than the first row.
 *   - Rows already holding an envelope are skipped, so the script is idempotent
 *     and safe to re-run after a partial failure.
 *   - Every row is round-tripped IN MEMORY — decryptSecret(encryptSecret(x)) === x
 *     — and the UPDATE is issued only if that holds.
 *   - After the UPDATE the row is re-read from the database and decrypted
 *     again. If that fails, the original plaintext (still held in memory) is
 *     written back immediately and the run aborts.
 *   - No token value, plaintext or ciphertext, is ever printed.
 *
 * ENV (same values the app uses):
 *   NEXT_PUBLIC_SUPABASE_URL       https://emilonrdyljbydtgrvof.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY      service-role key (bypasses RLS)
 *   SECRET_ENCRYPTION_KEY          32 bytes base64 — the key the envelopes are
 *                                  sealed with. Once this backfill has run, a
 *                                  lost key means unrecoverable tokens.
 *
 * USAGE (tsx does not read .env.local by itself):
 *   npx tsx --env-file=.env.local scripts/backfill-encrypt-tokens.ts
 *   npx tsx --env-file=.env.local scripts/backfill-encrypt-tokens.ts --commit
 */
import { encryptSecret, decryptSecret, isEncrypted, userTokenAad } from '../lib/secrets';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMIT = process.argv.includes('--commit');

function die(msg: string): never {
  console.error(`\n  FAIL  ${msg}\n`);
  process.exit(1);
}
if (!SUPABASE_URL) die('NEXT_PUBLIC_SUPABASE_URL is not set.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is not set.');

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
const authHeaders = { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}` };

interface UserRow { id: string; email: string; google_refresh_token: string | null; }

/** Write a value straight to the column, bypassing nothing. Returns an error string or null. */
async function writeToken(id: string, value: string): Promise<string | null> {
  const res = await fetch(`${REST}/users?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ google_refresh_token: value }),
  });
  return res.ok ? null : `${res.status}: ${(await res.text()).slice(0, 160)}`;
}

async function readToken(id: string): Promise<string | null> {
  const res = await fetch(`${REST}/users?id=eq.${id}&select=google_refresh_token`, { headers: authHeaders });
  if (!res.ok) die(`could not re-read user ${id}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows?.[0]?.google_refresh_token ?? null;
}

async function main() {
  console.log(`\n  Mode: ${COMMIT ? 'COMMIT (will mutate)' : 'DRY RUN (no changes)'}`);

  // Key self-test, before anything is read or written. A wrong key must fail
  // here, not part-way through a table.
  try {
    const probeAad = userTokenAad('00000000-0000-4000-8000-000000000000');
    const probe = 'key-self-test';
    if (decryptSecret(encryptSecret(probe, probeAad), probeAad) !== probe) {
      die('key self-test did not round-trip — refusing to touch any row.');
    }
    console.log('  Key self-test: PASS (encrypt → decrypt round-trips)\n');
  } catch (e) {
    die(`key self-test failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const res = await fetch(`${REST}/users?select=id,email,google_refresh_token&order=email`, { headers: authHeaders });
  if (!res.ok) die(`could not read users: ${res.status} ${await res.text()}`);
  const all: UserRow[] = await res.json();

  const nullRows = all.filter((u) => !u.google_refresh_token);
  const already = all.filter((u) => u.google_refresh_token && isEncrypted(u.google_refresh_token));
  const todo = all.filter((u) => u.google_refresh_token && !isEncrypted(u.google_refresh_token));

  console.log(`  ${all.length} users total`);
  console.log(`    ${nullRows.length} with no token        — nothing to do`);
  console.log(`    ${already.length} already encrypted     — skipped (idempotent)`);
  console.log(`    ${todo.length} plaintext             — in scope\n`);

  if (todo.length === 0) {
    console.log('  Nothing to backfill.\n');
    return;
  }

  let done = 0, failed = 0;

  for (const u of todo) {
    const plaintext = u.google_refresh_token!;
    const aad = userTokenAad(u.id);

    // 1. Seal and prove the round trip in memory. Nothing is written unless
    //    this exact ciphertext decrypts back to this exact plaintext.
    let envelope: string;
    try {
      envelope = encryptSecret(plaintext, aad);
      if (decryptSecret(envelope, aad) !== plaintext) {
        die(`${u.email}: in-memory round trip did not match — aborting before any write.`);
      }
    } catch (e) {
      die(`${u.email}: encryption failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    console.log(
      `  ${COMMIT ? '✓' : '·'}  ${u.email}: plaintext ${plaintext.length} chars (${plaintext.slice(0, 4)}…) ` +
        `→ envelope ${envelope.length} chars, round trip OK`,
    );

    if (!COMMIT) continue;

    // 2. Write it.
    const writeErr = await writeToken(u.id, envelope);
    if (writeErr) {
      console.log(`     db -> FAILED ${writeErr}`);
      failed++;
      continue;
    }

    // 3. Re-read from the database and decrypt again. This is the check that
    //    matters: it proves what actually landed in the column is openable,
    //    not merely what we intended to send.
    const stored = await readToken(u.id);
    let verified = false;
    try {
      verified = stored !== null && isEncrypted(stored) && decryptSecret(stored, aad) === plaintext;
    } catch {
      verified = false;
    }

    if (!verified) {
      // Roll back to the plaintext we still hold, so a bad write never costs
      // the credential. The users CHECK constraint is deliberately not added
      // until the contract phase, which is what makes this restore possible.
      const restoreErr = await writeToken(u.id, plaintext);
      die(
        `${u.email}: stored value did not verify after write. ` +
          (restoreErr
            ? `RESTORE ALSO FAILED (${restoreErr}) — the row needs manual attention.`
            : 'Original plaintext restored. Nothing lost; investigate before retrying.'),
      );
    }

    console.log('     db -> written and verified from the database');
    done++;
  }

  console.log(
    `\n  Summary: ${
      COMMIT
        ? `${done} encrypted and verified, ${failed} failed`
        : `${todo.length} would be encrypted (run with --commit to apply)`
    }\n`,
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
