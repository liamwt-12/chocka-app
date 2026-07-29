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

## Known drift (2026-07-29)

`users.tenant_id` and `profiles.tenant_id` exist in production, fully populated, but have **no
migration here** — the slice-3 baseline described above was never written. This directory therefore
does not reproduce production, and a fresh environment will lack those columns. Tracked in
`FOLLOWUPS.md` under "Deferred — schema drift". Verify against the live database before assuming
this directory is complete.

## Applying

Run against a **copy / staging database first**, never prod, and confirm:
1. `tenants` is created and the Chocka row matches `lib/tenant.ts` (`CHOCKA_BASE` + palette) field-for-field.
2. No existing table was altered (`\d` before/after is unchanged for everything except the new `tenants`).
