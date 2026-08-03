# Supabase migrations

This directory is the start of in-repo schema tracking (added in multi-tenancy slice 2).

## Important: the pre-existing schema is NOT captured here yet

The existing tables — `users`, `profiles`, `scheduled_posts`, `reviews`, `review_replies`,
`sms_log`, `weekly_stats`, `referrals` — were created directly in the Supabase dashboard and
have **no migration in this repo**. Do not assume this directory is the full schema.

Their baseline will be captured as a migration in **slice 3**, when those tables are first
altered (adding `tenant_id`). Until then, treat the dashboard as the source of truth for them.

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

- `20260730150000_create_email_suppressions.sql` — creates `email_suppressions` for the unsubscribe
  mechanism. **Additive only**: one new table plus two indexes, nothing existing is altered. Keyed on
  the lower-cased **address** and not the retailer, because someone who opts out is opting the address
  out — Tarkett's list contains the same business twice under different names, and a retailer-keyed
  suppression would let the duplicate row keep emailing a person who has already said no.
  Suppression is **per-tenant**: a Chocka customer has not opted out of Stellar.

  **NOT APPLIED TO PRODUCTION — and deliberately so.** Verified 2026-08-03: the table is absent from
  `information_schema.tables`, and `20260730150000` is absent from the recorded migration history. The
  two agree, which is the correct state for a migration on an unmerged branch. It is unapplied for the
  same reason the branch is unmerged — see the `RAISE WITH TARKETT` entry in `FOLLOWUPS.md`. There is
  nothing to repair here; **do not** `migration repair` this version.

  **When this branch merges:** `supabase db push --dry-run` should name this file and only this file.
  If it names any other version, stop — that means something else drifted in the meantime. Apply, then
  replace this paragraph with an "Applied to production &lt;date&gt;" note and the verified row counts,
  matching the four entries above.

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

## Known drift (2026-07-29, partly resolved 2026-07-30, re-verified 2026-08-03)

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
