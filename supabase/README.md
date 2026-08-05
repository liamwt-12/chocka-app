# Supabase migrations

This directory is the start of in-repo schema tracking (added in multi-tenancy slice 2).

## The pre-existing schema IS now captured — as a snapshot, not as migrations

**Resolved 2026-08-05.** `supabase/schema/production-baseline.sql` is generated from production and
holds the whole `public` schema: all 18 tables, 208 columns, 54 constraints, 67 indexes, RLS,
policies, functions and the app-owned trigger on `auth.users`. A fresh environment builds from it.

`migrations/` still does not reproduce production on its own, and is no longer expected to. The two
have different jobs — snapshot vs increments — and the split is described under **Staging** below.

The tables that were created in the dashboard (`users`, `profiles`, `scheduled_posts`, `reviews`,
`review_replies`, `sms_log`, `weekly_stats`, `referrals`) still have no migration file. They no
longer need one: the baseline carries their real definition, read from the live database rather than
inferred.

## Migrations

- `20260720000000_create_tenants.sql` — **slice 2**. Creates the `tenants` table and seeds the
  Chocka row. **Additive only**: it creates one new table and inserts one row; it does not touch
  any existing table, so it cannot affect existing data. RLS is intentionally not enabled (slice 4).
- `20260729120000_seed_stellar_tenant.sql` — seeds the Stellar Local row. **Additive only**: one
  `INSERT ... ON CONFLICT (slug) DO NOTHING`. Needed so a Stellar user's `users.tenant_id` has a
  referential target. The row is *not* the authoritative brand config — that stays in
  `lib/tenant.ts`, because this table has no columns for `fontHeading`, `fontBody`, `iconSvg`,
  `iconPng` or `priceMonthlyGbp`.

- `20260729140000_create_retailers_and_score_history.sql` — creates `retailers` and `score_history`
  for the Stellar pre-launch baseline. **Additive only**: two new tables plus indexes, nothing
  existing is altered. Mirrors the `businesses`/`scores`/`score_history` design in the *chocka index*
  project (`vxycdhyembwufoqfoqsg`) so the two stay comparable; deviations are marked `DEVIATION` in
  the file. Note `place_id` is deliberately **not** unique — Tarkett's source list contains three
  businesses twice under different names.

- `20260730120000_create_retailer_invites.sql` — creates `retailer_invites` for the Stellar retailer
  onboarding flow, and adds two nullable columns to `retailers`: `user_id` (the retailer↔user link,
  set by the OAuth callback and not before) and `contact_email`. **Additive only**: one new table,
  six indexes, two nullable columns with no defaults. **Applied to production 2026-07-30** via
  `supabase db push`, verified after: `retailer_invites` present and empty, both columns present, no
  existing table altered, row counts unchanged (`retailers` 180, `score_history` 180, `users` 12,
  `tenants` 2).

  `contact_email` exists rather than storing the 180 addresses on `retailer_invites` because an
  invite row cannot exist without a `token_hash` and an `expires_at` — using it as the contact store
  would have meant minting 180 tokens and starting 180 thirty-day clocks before a single email was
  sent. The two columns have different jobs: `retailers.contact_email` is where a retailer can be
  reached now; `retailer_invites.email` is the address an invite *was sent to*, frozen at send time.

## Staging (added 2026-08-05) — and how the drift was finally captured

There is now a **staging database**: Supabase project `chocka-staging`, ref `pauwvdntclmxlcettfgc`,
`eu-west-1`, same organisation and same region as production. It exists so the rule below —
"run against a copy first, never prod" — is followable, which it had not been.

### How it was built, and why not with `supabase db dump`

`db dump` needs Docker; `migration list` / `repair` block on an interactive password prompt. Neither
was available, and that is precisely why the drift went uncaptured for months. The **Management API**
needs neither: it authenticates with the personal access token already in the keychain and will run
SQL, so the schema can be read straight out of `pg_catalog`.

| Script | What it does |
|---|---|
| `scripts/dump-production-schema.py` | Reads production's `public` schema and writes `supabase/schema/production-baseline.sql`. **Read-only** — every statement is a SELECT. |
| `scripts/apply-schema-to-staging.py` | Applies that file to staging. The only script here that issues DDL. |
| `scripts/verify-schema-match.py` | Diffs the two live databases object by object. Exit 0 = identical. |

```
python3 scripts/dump-production-schema.py     # refresh the baseline from prod
python3 scripts/apply-schema-to-staging.py --reset   # rebuild staging from it
python3 scripts/verify-schema-match.py        # prove they match
```

### Verified match, 2026-08-05

| object | prod | staging |
|---|---:|---:|
| tables | 18 | 18 |
| columns | 208 | 208 |
| constraints | 54 | 54 |
| indexes | 67 | 67 |
| RLS flags | 18 | 18 |
| policies | 10 | 10 |
| functions | 2 | 2 |
| app-owned triggers | 1 | 1 |

The verifier compares the **two live databases**, not the SQL file. That distinction matters: a
missing default or a subtly different policy clause would apply without error and leave staging
quietly unlike production — worse than having no staging, because you would then trust a migration
test that proved nothing.

### Three things the first apply caught, which a `public`-only dump would have missed

Recorded because they are the non-obvious parts of reproducing a Supabase schema:

1. **A role.** `tenant_app` is referenced by the RLS policies but is cluster-level, not a schema
   object. The first apply failed outright with `role "tenant_app" does not exist`. Roles are now
   derived *from the policies* rather than listed by hand, so a new one cannot slip past.
2. **Functions.** `current_tenant_id()` and `handle_new_user()`. The policies call the first, so
   without them the policy creation fails.
3. **A trigger outside `public`.** `on_auth_user_created` on **`auth.users`** calls
   `public.handle_new_user()`. A dump scoped to `public` misses it entirely, and staging would then
   differ in *behaviour* while looking identical in *structure* — the worst kind of mismatch. It is
   picked up by joining triggers to the schema their function lives in, which also correctly excludes
   Supabase's own realtime/storage triggers.

   (Worth knowing separately: that trigger inserts into `public.users` when an `auth.users` row is
   created, and this app does not use Supabase Auth at all — it uses a `chocka_user_id` cookie. It
   appears vestigial. It is reproduced faithfully rather than tidied away, because the job here is to
   match production, not to improve it.)

### Safety

`apply-schema-to-staging.py` is the only script that writes. It carries a hardcoded allowlist of one
ref, and a separate blocklist naming production and the seven unrelated projects in the same
organisation. A ref that is not staging is refused before a connection is opened. It also refuses to
run against a non-empty `public` unless `--reset` is passed, so a re-run cannot half-overwrite.

### What staging deliberately does NOT have

**No data.** Schema only. Production holds real retailer records and encrypted refresh tokens whose
AAD is bound to production row ids, so copying rows across would be both a privacy problem and a
cryptographic one — the ciphertext would not decrypt under a different row id anyway. Seed it with
synthetic rows if a test needs them.

The database password was generated at creation and is **not in this repo**. Reset it from the
Supabase dashboard if needed; none of the tooling here uses it, because the Management API does not
require it.

### Using it for a migration, going forward

1. `python3 scripts/verify-schema-match.py` — start from a known-matching state.
2. Apply the candidate migration to **staging** and check it does what you expect.
3. Apply to production via `supabase db push`.
4. `python3 scripts/dump-production-schema.py` to refresh the baseline, and commit the diff.

`supabase/migrations/` remains the place for **incremental** changes. `supabase/schema/production-baseline.sql`
is the **snapshot** — it is what a fresh environment is built from, and it is regenerated rather than
hand-edited. The two answer different questions and the baseline does not replace the migration files.

## Migration history was repaired (2026-07-30)

Before this date the remote migration history was **empty** — all four local migrations showed a
blank `Remote` column in `supabase migration list`, even though `tenants`, `retailers` and
`score_history` all existed in production with data. They had been applied out-of-band, the same way
`users.tenant_id` was.

That mattered practically: `supabase db push` would have attempted all four migrations rather than
the one new one. They are all `if not exists` / `on conflict do nothing`, so it would most likely
have no-opped — but "most likely" is not a standard worth applying to a database with real users.

Fixed with:

```
supabase migration repair --status applied 20260720000000 20260729120000 20260729140000
supabase db push --dry-run   # confirmed: only 20260730120000
supabase db push
```

The history now reflects reality, so `db push` is trustworthy from here. **Keep it that way** — apply
schema changes through a migration, not the dashboard, or the next person inherits the same problem.

## Checking migration history without the DB password

`supabase migration list` and `supabase migration repair` both open a direct database connection and
so **block on an interactive password prompt** — which makes them useless in a script, in CI, or in
any automated check. That is a large part of why the history went unverified for as long as it did.

The history is readable without that password. The Supabase **Management API** authenticates with the
personal access token the CLI already stores in the macOS keychain (service `Supabase CLI`, stored
base64-wrapped by `go-keyring`), and will run read-only SQL:

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
REF=emilonrdyljbydtgrvof

curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select version, name from supabase_migrations.schema_migrations order by version;"}'
```

Two things this is the *only* convenient way to check:

- **`supabase_migrations` is not exposed through PostgREST.** Only `public` and `graphql_public` are,
  so the service-role key cannot reach the history table — you get `PGRST106 Invalid schema`.
- **Whether a table actually exists.** Query `information_schema.tables` here rather than probing
  through the REST API, because that probe is easy to misread — see the warning below.

### Do not test for a table with `head: true` and an exact count

`supabase-js` does not surface a missing table as an error on a HEAD request:

```js
// MISLEADING — returns { error: null, count: null } when the table DOES NOT EXIST
await db.from('email_suppressions').select('*', { count: 'exact', head: true });
```

A table that exists and is empty returns `count: 0`; one that does not exist returns `count: null`
with **no error**. The two are one keystroke apart when read quickly, and reading `null` as "present
and empty" is exactly the wrong direction — it invents drift that is not there. Verified 2026-08-03:
the same table returns a plain `404 PGRST205` on a raw REST `GET`, and is absent from
`information_schema.tables`. Use either of those, or the Management API above.

## Known drift (2026-07-29 → CLOSED 2026-08-05)

**Closed by the baseline snapshot.** `users.tenant_id` and `profiles.tenant_id` — and the several
whole tables this section understated — are now captured in
`supabase/schema/production-baseline.sql`, and a staging database built from it has been verified
object-for-object against production. A fresh environment no longer lacks them.

The history below is kept because the *reasoning* still applies: out-of-band changes are invisible
until something forces a comparison, and the fix is to compare rather than to assume.

### Original entry (2026-07-29, partly resolved 2026-07-30, re-verified 2026-08-03)

`users.tenant_id` and `profiles.tenant_id` exist in production, fully populated, but have **no
migration here** — the slice-3 baseline described above was never written. This directory therefore
does not reproduce production, and a fresh environment will lack those columns. Tracked in
`FOLLOWUPS.md` under "Deferred — schema drift". Verify against the live database before assuming
this directory is complete.

**Re-verified 2026-08-03 and this is still the only drift.** The recorded history holds exactly the
four versions above — `20260720000000`, `20260729120000`, `20260729140000`, `20260730120000` — which
matches the four migration files on `main` one-for-one. Nothing has been applied out-of-band since the
repair, and no migration file is unapplied. **`supabase db push` is trustworthy as of this date.**

Production `public` tables at that check, for comparison against a future one: `activity_log`,
`competitors`, `found_alerts`, `optimizations`, `posts`, `profile_analysis`, `profiles`, `referrals`,
`retailer_invites`, `retailers`, `review_replies`, `reviews`, `scheduled_posts`, `score_history`,
`sms_log`, `tenants`, `users`, `weekly_stats`. Note how many of those have no migration here — the
drift section above understates the gap by naming only the two `tenant_id` columns.

## Applying

**Note on the rule below (2026-07-30):** it could not be followed for
`20260730120000`. `supabase db dump` and a local database both require Docker, which was not
available, and this directory does not reproduce production anyway (see drift above), so no faithful
staging copy could be built from it. The migration was applied straight to production after a
`--dry-run` confirmed it would touch only the one file, on the grounds that it is purely additive —
one new table plus two nullable columns with no defaults, so no existing row can be rewritten. That
was a judgement call, taken deliberately and with the row counts checked before and after, not an
oversight. **If a staging database becomes available, prefer the rule.**

Run against a **copy / staging database first**, never prod, and confirm:
1. `tenants` is created and the Chocka row matches `lib/tenant.ts` (`CHOCKA_BASE` + palette) field-for-field.
2. No existing table was altered (`\d` before/after is unchanged for everything except the new `tenants`).
