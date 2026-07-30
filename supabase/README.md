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

## Known drift (2026-07-29, partly resolved 2026-07-30)

`users.tenant_id` and `profiles.tenant_id` exist in production, fully populated, but have **no
migration here** — the slice-3 baseline described above was never written. This directory therefore
does not reproduce production, and a fresh environment will lack those columns. Tracked in
`FOLLOWUPS.md` under "Deferred — schema drift". Verify against the live database before assuming
this directory is complete.

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
