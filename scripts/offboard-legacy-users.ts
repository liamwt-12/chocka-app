/**
 * Offboard legacy Chocka users.
 *
 * For each targeted user this:
 *   1. Revokes their Google refresh token at Google's revoke endpoint, so
 *      Chocka's access to their Business Profile is withdrawn on Google's side.
 *   2. Nulls the stored token and marks the row offboarded
 *      (token_status='offboarded', token_invalid_at=now).
 *
 * It NEVER touches the user's Google profile content — only our own access.
 *
 * SAFETY:
 *   - DRY RUN by default. It only mutates when run with `--commit`.
 *   - EXCLUDE_EMAILS is applied first. The founder's own account
 *     (liam@wearecanny.uk) is excluded by default so a run cannot revoke your
 *     own dev Google access. Review this list before committing.
 *   - Send the goodbye email (docs/offboarding-email.md) BEFORE running this.
 *
 * ENV (same values the app uses):
 *   NEXT_PUBLIC_SUPABASE_URL       https://emilonrdyljbydtgrvof.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY      service-role key (bypasses RLS)
 *
 * USAGE:
 *   export NEXT_PUBLIC_SUPABASE_URL=...   SUPABASE_SERVICE_ROLE_KEY=...
 *   npx tsx scripts/offboard-legacy-users.ts            # dry run, prints plan
 *   npx tsx scripts/offboard-legacy-users.ts --commit   # actually offboards
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMIT = process.argv.includes('--commit');

// Accounts to leave alone. Add/remove emails here before a real run.
const EXCLUDE_EMAILS = new Set<string>([
  'liam@wearecanny.uk', // founder's live dev account — do not revoke by default
]);

const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';

function die(msg: string): never {
  console.error(`\n  FAIL  ${msg}\n`);
  process.exit(1);
}
if (!SUPABASE_URL) die('NEXT_PUBLIC_SUPABASE_URL is not set.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is not set.');

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`;
const authHeaders = { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}` };

interface UserRow { id: string; email: string; name: string | null; google_refresh_token: string | null; }

/** Revoke a refresh token at Google. Returns true if Google accepted it or it
 *  was already dead (both mean "no longer valid"), false on an unexpected error. */
async function revokeAtGoogle(token: string): Promise<{ ok: boolean; note: string }> {
  try {
    const res = await fetch(GOOGLE_REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (res.ok) return { ok: true, note: 'revoked' };
    // 400 = token already invalid/expired/revoked — the desired end state anyway.
    if (res.status === 400) return { ok: true, note: 'already invalid' };
    return { ok: false, note: `google ${res.status}: ${(await res.text()).slice(0, 120)}` };
  } catch (e) {
    return { ok: false, note: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function main() {
  console.log(`\n  Mode: ${COMMIT ? 'COMMIT (will mutate)' : 'DRY RUN (no changes)'}`);
  console.log(`  Excluding: ${Array.from(EXCLUDE_EMAILS).join(', ') || '(none)'}\n`);

  const res = await fetch(`${REST}/users?select=id,email,name,google_refresh_token`, { headers: authHeaders });
  if (!res.ok) die(`could not read users: ${res.status} ${await res.text()}`);
  const all: UserRow[] = await res.json();

  const targets = all.filter((u) => !EXCLUDE_EMAILS.has((u.email || '').toLowerCase()));
  console.log(`  ${all.length} users total; ${targets.length} in scope after exclusions.\n`);

  let revoked = 0, cleared = 0, skipped = 0, failed = 0;

  for (const u of targets) {
    const label = `${u.email}${u.name ? ` (${u.name})` : ''}`;
    if (!u.google_refresh_token) {
      console.log(`  -  ${label}: no token, nothing to revoke`);
      skipped++;
      continue;
    }

    // 1. Revoke at Google.
    let note = 'skipped (dry run)';
    if (COMMIT) {
      const r = await revokeAtGoogle(u.google_refresh_token);
      note = r.note;
      if (r.ok) revoked++; else failed++;
    }
    console.log(`  ${COMMIT ? '✓' : '·'}  ${label}: google revoke -> ${note}`);

    // 2. Clear the stored token and mark offboarded (proceed even if the Google
    //    revoke errored — we still want our copy gone).
    if (COMMIT) {
      const patch = await fetch(`${REST}/users?id=eq.${u.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          google_refresh_token: null,
          token_status: 'offboarded',
          token_invalid_at: new Date().toISOString(),
        }),
      });
      if (patch.ok) { cleared++; console.log(`     db -> token nulled, token_status=offboarded`); }
      else console.log(`     db -> FAILED ${patch.status}: ${(await patch.text()).slice(0, 120)}`);
    }
  }

  console.log(`\n  Summary: ${COMMIT ? `${revoked} revoked, ${cleared} cleared, ${failed} google-errors, ${skipped} had no token`
    : `${targets.length} would be processed (run with --commit to apply)`}\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
