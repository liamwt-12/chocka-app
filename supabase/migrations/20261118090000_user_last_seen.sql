-- When a shop last opened its dashboard, for the retention view in /admin/pilot.
--
-- Written only while RETENTION_VIEW=on, and at most once an hour per account.
-- It is one timestamp, not a history of visits: it answers "has this shop
-- looked at all lately?" and nothing finer. Shown to admin only, never to the
-- funder and never in an export with contact details.
--
-- ADDITIVE ONLY: one nullable column.
alter table public.users add column if not exists last_seen_at timestamptz;
