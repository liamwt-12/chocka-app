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

## Applying

Run against a **copy / staging database first**, never prod, and confirm:
1. `tenants` is created and the Chocka row matches `lib/tenant.ts` (`CHOCKA_BASE` + palette) field-for-field.
2. No existing table was altered (`\d` before/after is unchanged for everything except the new `tenants`).
