-- Lock down the three tables Supabase's public roles could read and write.
--
-- WHY: retailers (the 180 shop records, with contact emails), retailer_invites
-- (invite records and the addresses they went to) and score_history were
-- created by migrations that never enabled row-level security, and Supabase's
-- default grants give the `anon` and `authenticated` roles full SELECT, INSERT,
-- UPDATE and DELETE on every public table. So anyone holding the project's anon
-- key, which Supabase treats as publishable rather than secret, could read,
-- change or delete them through the REST API. Found on 2026-11-14 by querying
-- staging's catalogue (staging mirrors production's schema).
--
-- WHAT THIS DOES, two independent locks:
--   1. Enable RLS with no policies, so the public roles see no rows.
--   2. Revoke every privilege from anon and authenticated, so they cannot even
--      reach the table.
-- change_log (20261114120000) already has RLS; its default grants are revoked
-- here too, for the same reason.
--
-- WHY THE APP IS UNAFFECTED: all server code uses the service-role key
-- (lib/supabase.ts), and service_role has BYPASSRLS and keeps its grants. No
-- browser code talks to Supabase.
--
-- NOT DONE HERE: the other app tables already have RLS enabled. Their policies
-- for tenant_app are unused and left alone (see docs/build-plan-2026-11.md,
-- item 3). New tables still receive Supabase's default grants, so any future
-- table must enable RLS in its own migration.
--
-- Idempotent: enabling RLS twice and revoking twice are both no-ops.

alter table public.retailers        enable row level security;
alter table public.retailer_invites enable row level security;
alter table public.score_history    enable row level security;

revoke all on table public.retailers        from anon, authenticated;
revoke all on table public.retailer_invites from anon, authenticated;
revoke all on table public.score_history    from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'change_log') then
    revoke all on table public.change_log from anon, authenticated;
  end if;
end $$;
