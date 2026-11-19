-- daily_metrics: one row per listing, per day, per Google performance metric.
--
-- WHY: monthly figures were built by summing weekly rows that each held a
-- rolling 28-day total, which overstated views, calls, directions and website
-- clicks about fourfold. Storing each day once makes any period a plain sum.
-- See lib/metrics.ts.
--
-- Also two columns on profiles recording the connect-time history pull:
--   metrics_backfilled_at  when the ~18-month history was fetched
--   metrics_history_start  the earliest day Google returned (the baseline's start)
--   metrics_synced_at      last successful sync, so the hourly job rotates fairly
--
-- ADDITIVE ONLY: one new table, one index, three nullable columns.
-- RLS on and public roles revoked, as for every table since 20261115090000.

create table if not exists public.daily_metrics (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  metric      text not null,
  value       integer not null default 0,
  fetched_at  timestamptz not null default now(),
  primary key (profile_id, date, metric)
);

create index if not exists daily_metrics_profile_date_idx on public.daily_metrics (profile_id, date);

alter table public.daily_metrics enable row level security;
revoke all on table public.daily_metrics from anon, authenticated;

alter table public.profiles add column if not exists metrics_backfilled_at timestamptz;
alter table public.profiles add column if not exists metrics_history_start date;
alter table public.profiles add column if not exists metrics_synced_at timestamptz;
