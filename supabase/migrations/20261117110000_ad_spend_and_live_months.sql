-- Two things for Tarkett and for the monthly count. Nothing here is shown to a shop.
--
-- 1. AD SPEND, beside the ad start date that already exists.
--    retailers.ad_spend_pence   optional: what has been spent on ads for this
--                               shop, in pence, as typed in by an admin. Whole
--                               pence, so no rounding. Shown to Tarkett and
--                               admin only, never in the shop's own email.
--    retailers.ad_end_date      optional: when those ads stopped.
--
-- 2. A RECORD OF WHICH SHOPS WERE LIVE IN EACH MONTH.
--    "Live" is worked out on the spot from current rows (lib/shop-status.ts),
--    so until now nothing could say which shops were live in a month that has
--    passed, and a shop that deleted its account vanished from history.
--
--    live_months  one row per shop per month in which it was live on at least
--                 one daily check. It copies the shop's name, and has NO link
--                 back to the shop's row, on purpose: the count for a past
--                 month must survive the shop leaving.
--    retailers.first_live_on        the first day the shop was ever live. Set once.
--    retailers.exclude_from_count   true for a test or internal shop that must
--                                   never be counted.
--
-- ADDITIVE ONLY. The new table is locked down like every other: row level
-- security on, no policies, nothing granted to the public roles.
alter table public.retailers add column if not exists ad_spend_pence integer check (ad_spend_pence is null or ad_spend_pence >= 0);
alter table public.retailers add column if not exists ad_end_date date;
alter table public.retailers add column if not exists first_live_on date;
alter table public.retailers add column if not exists exclude_from_count boolean not null default false;

create table if not exists public.live_months (
  month          text not null check (month ~ '^\d{4}-\d{2}$'),
  retailer_id    uuid not null,
  tenant_id      uuid not null references public.tenants(id),
  name           text not null,
  town           text,
  live_days      integer not null default 0 check (live_days >= 0),
  first_live_on  date not null,
  last_live_on   date not null,
  updated_at     timestamptz not null default now(),
  primary key (month, retailer_id)
);
create index if not exists live_months_tenant_month_idx on public.live_months (tenant_id, month);

alter table public.live_months enable row level security;
revoke all on table public.live_months from anon, authenticated;
