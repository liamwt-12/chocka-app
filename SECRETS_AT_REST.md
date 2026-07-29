# Secrets at rest — application-level encryption of stored credentials

Spec for the work `FOLLOWUPS.md` refers to as "step 6". Companion to `MULTI_TENANCY_PLAN.md`;
independent of the multi-tenancy slices. Branch: `secrets-at-rest`, cut from `main` at
`51b722c`.

## Status — complete as of 2026-07-28

| Step | State |
| --- | --- |
| 1. Expand — `lib/secrets.ts`, 13 call sites | done |
| 2. Migrate — backfill `users.google_refresh_token` | done: 1 row encrypted and verified, 0 failed |
| 3. Contract — strict reader, DB constraints | code done; `supabase/SECRETS_USERS_CHECK.sql` applied separately |

`tenants.google_client_secret` was constrained ahead of the app work
(`supabase/SECRETS_TENANTS_CHECK.sql`, applied 2026-07-28) while the column was still empty.
The plaintext-tolerant reader `decryptSecretAllowingPlaintext()` has been removed; a test
asserts it cannot come back.

**Named `secrets-at-rest`, not `slice-6`, on purpose.** "Slice 6" already means the Stellar
tenant cutover in `MULTI_TENANCY_PLAN.md`. This is a different piece of work that happens to be
step 6 of the follow-up list.

## Scope

| Target | State on 2026-07-28 | Work |
| --- | --- | --- |
| `users.google_refresh_token` | **1 plaintext row** (`liam@wearecanny.uk`, 103-char `1//0…` Google refresh token). The other 11 rows are `NULL` after offboarding. | Encrypt on write, decrypt on read, backfill the one row. |
| `tenants.google_client_secret` | **NULL on the only row**, and **read by no code** — the sole references in the repo are the migration's own comment (`supabase/migrations/20260720000000_create_tenants.sql:35-38`). OAuth runs off `process.env.GOOGLE_CLIENT_SECRET` (`lib/google.ts:86,101`). | Nothing to migrate. Constrain the column so plaintext can never be stored, *before* slice 5 populates it. |

Out of scope, logged in `FOLLOWUPS.md` instead: `.gbp-tokens.json` (the live-matrix harness
writes real refresh tokens to a gitignored local file).

## Why application-level, and why the key must not live in the database

Supabase already encrypts disk at rest, and the MapBoost project has daily physical backups
plus PITR. Storage-layer encryption at rest is therefore **already true**, and re-doing it buys
nothing.

What is missing is protection against anyone who can *read the table*: a leaked service-role
key, a backup dump, a SQL-editor screenshot, a support ticket, or a future RLS mistake. That is
the actual threat, and it dictates the design — **the key must not be reachable from the
database**. pgsodium and Supabase Vault keep key material inside Postgres, so a service-role
compromise yields both the ciphertext and the key. They defend the threat already covered and
not the one that remains. (Supabase has separately moved away from pgsodium transparent column
encryption, but the architectural point stands without that.)

**Decision: AES-256-GCM in the application, key supplied by the environment.**

## Envelope format

```
v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
```

- **AES-256-GCM**, 12-byte random IV per encryption, 16-byte authentication tag.
- **Versioned prefix** so key rotation is a `v2.` writer plus a dual-format reader, never a
  schema migration.
- **AAD binds each ciphertext to its location**: `users.google_refresh_token:<user uuid>` /
  `tenants.google_client_secret:<tenant uuid>`. A ciphertext copied from one row or column into
  another then fails to decrypt instead of silently working. Costs nothing.

## Key

`SECRET_ENCRYPTION_KEY` — 32 random bytes, base64 (`openssl rand -base64 32`, 44 chars).

- **Netlify:** set for all contexts and **marked secret**. Netlify's `is_secret` makes a value
  write-only — it cannot be read back via CLI or API (established on 2026-07-28 while trying to
  retrieve `SUPABASE_SERVICE_ROLE_KEY`). That is the desired property here, and it is also why
  the durable copy below is not optional.
- **Durable copy:** password manager. **Losing this key makes every stored token permanently
  unrecoverable.** Netlify will not give it back.
- **Local:** `.env.local` (mode `0600`, gitignored).
- **Read lazily inside the crypto functions, never at module top level**, so a missing key
  cannot break `next build`. Matches the existing lazy `crypto` import style in `lib/stripe.ts`
  and `lib/cron.ts`.

## Module — `lib/secrets.ts`

```
encryptSecret(plaintext: string, aad: string): string     // -> "v1.…"
decryptSecret(stored: string, aad: string): string
isEncrypted(stored: string | null): boolean               // "v1." prefix test
```

A missing or malformed key raises a named, actionable error rather than a crypto stack trace.

## Sequencing — expand / migrate / contract

### 1. Expand

Key into Netlify and `.env.local` **first** — a deploy without it fails closed at the first
token read. Then land `lib/secrets.ts` and wire the call sites. Reads accept **both** formats
during this phase; writes always encrypt.

Write sites (3), all in `app/api/auth/callback/google/route.ts`: lines **71**, **87**, **135**.

Read sites (10): `app/api/listings/route.ts:25`, `app/api/listings/select/route.ts:37`,
`app/api/profile-fix/route.ts:20`, `app/api/audit/route.ts:24`,
`app/api/dashboard/route.ts:48`, `app/api/audit/previews/route.ts:26`,
`app/api/cron/post-publisher/route.ts:35`, `app/api/cron/monday-stats/route.ts:23`,
`app/api/cron/review-alerts/route.ts:24`, `app/api/reviews/auto-reply/route.ts:69`.

Plus `scripts/offboard-legacy-users.ts:94`, which revokes a stored token at Google.

**Decryption stays explicit at each call site — it is deliberately not hidden inside
`refreshAccessToken`.** That function is also called by the live-matrix harness
(`scripts/live-matrix.ts:192`) with raw tokens from `.gbp-tokens.json`; making it
decrypt-on-entry would break the harness and couple the Google module to key management.

### 2. Migrate

A `tsx` backfill script encrypts the single plaintext row. For each row it round-trips in
memory first — `decryptSecret(encryptSecret(x)) === x` — and issues the `UPDATE` only on
success. Dry-run by default, `--commit` to apply, mirroring
`scripts/offboard-legacy-users.ts`.

**This is app-level, not the SQL-editor flow used by slices 3 and 4.** The key lives outside
the database, so SQL cannot perform this backfill.

### 3. Contract

Remove the plaintext-tolerant read path, then add `CHECK` constraints making plaintext
structurally impossible:

```sql
users.google_refresh_token   IS NULL OR LIKE 'v1.%'
tenants.google_client_secret IS NULL OR LIKE 'v1.%'
```

**The `tenants` constraint can land immediately and independently** — the column is empty, so
it is a zero-risk change that guarantees slice 5 cannot introduce the very problem this work
exists to remove. See `supabase/SECRETS_TENANTS_CHECK.sql`. Applied via the Supabase SQL
editor, per the slice-3/4 convention: transactional, with a verify block that raises and rolls
back on failure. DDL cannot go through PostgREST.

The `users` constraint lands only after the backfill verifies.

## Interaction with slice 4 — none

`users` is one of the unpoliced "hot four" (`supabase/SLICE_4_APPLY_NOTES.md`, on
`slice-4-plan`): stale `auth.uid()` policies, no `tenant_app` grant, so `tenant_app` cannot
reach it at all. The application touches it exclusively through `supabaseAdmin` (service_role),
which bypasses RLS. **Encryption on `users` and slice 4's policy work do not interact, in
either direction, and impose no ordering on each other.**

`tenants` *is* policed (RLS on, read-only grant, `tenant_self_read`). A `CHECK` constraint does
not affect policies. One standing consequence: `google_client_secret` must never enter the
client-safe tenant subset — already recorded as a slice-6 blocker at
`MULTI_TENANCY_PLAN.md:305`. Ciphertext in a browser payload is still a leak of the fact and
shape of the secret, and the key must never leave the server.

## Risk

Low, and this is the cheapest window the work will ever have. **One live row, and it belongs to
the founder.** Worst case — corrupted ciphertext or a lost key — the remedy is reconnecting
Google through the app: one consent click. There are no customers to affect; the other 11
accounts were offboarded on 2026-07-28.

The material risk is operational, not data: **`SECRET_ENCRYPTION_KEY` must exist in a durable
place outside Netlify before step 1 begins.**

## Tests

Added to the existing vitest suite (14/14 green at `51b722c`):

- round-trip for representative values, including a real-shaped `1//0…` refresh token;
- tampered ciphertext raises (flip one byte of the payload);
- wrong AAD raises — a ciphertext from row A cannot be decrypted as row B;
- missing / wrong-length key raises a named error, not a crypto stack trace;
- `isEncrypted` correctly classifies plaintext, `v1.` values and `NULL`;
- after contract, a plaintext read raises rather than passing through.
