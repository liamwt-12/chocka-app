-- retailers.ad_start_date: the day Tarkett's ads for this shop started.
--
-- Set by an admin in /admin/pilot. When present, the shop's monthly report
-- compares the weeks before and after this date, against shops with no ad start
-- date over the same weeks (lib/ad-comparison.ts). Null means no comparison.
--
-- ADDITIVE ONLY: one nullable column. retailers already has RLS (20261115090000).
alter table public.retailers add column if not exists ad_start_date date;
