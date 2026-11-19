-- A marker so the welcome email can only ever be sent once per account.
--
-- The email is sent (only when WELCOME_EMAIL=on) at the moment a shop connects
-- its listing. The marker is set BEFORE sending, with a conditional update, so
-- two requests arriving together cannot both send, and a crash at the wrong
-- instant means one missed email, never a duplicate. Same shape as
-- profiles.monthly_report_sent_for (20261116120000).
--
-- ADDITIVE ONLY: one nullable column.
alter table public.users add column if not exists welcome_email_sent_at timestamptz;
