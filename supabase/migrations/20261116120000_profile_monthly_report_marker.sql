-- profiles.monthly_report_sent_for: which month's report this listing last had.
--
-- 'YYYY-MM', for example '2026-10' once the October report has gone. Null means
-- none has been sent since this column existed.
--
-- WHY. The monthly report job ran once and got through about 35 shops before
-- Netlify's 60-second limit cut it off; the rest got no report, with no error.
-- It could not simply be run again, because an email leaves no trace, so a
-- second run would have sent some shops two. With this marker the job stops
-- when its time is up and the next run carries on from who is left
-- (lib/monthly-report.ts, docs/scale-check.md).
--
-- The marker is written just BEFORE a shop's email is sent, and only where it
-- is not already that month, so two overlapping runs cannot both send.
--
-- ADDITIVE ONLY: one nullable column and one check on its format. No existing
-- row changes: every listing starts as null, meaning "not yet sent", so the
-- first run after this is applied sends to everyone, as a single run always
-- tried to. Apply it BEFORE deploying the code that uses it: without the
-- column the job cannot record anything, and so sends nothing.
alter table public.profiles add column if not exists monthly_report_sent_for text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_monthly_report_sent_for_check') then
    alter table public.profiles
      add constraint profiles_monthly_report_sent_for_check
      check (monthly_report_sent_for is null or monthly_report_sent_for ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  end if;
end $$;
