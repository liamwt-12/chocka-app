-- Managed access: a retailer who never signs in to Google themselves.
--
-- WHY: Tarkett confirmed on 2026-08-17 that they handle first contact and
-- activation directly — in practice a rep sitting with a retailer and adding
-- Stellar as a *manager* of their Google Business Profile, which is the
-- activation method the pitch leads with ("Route 1"). That retailer never
-- performs an OAuth consent, so they have no Google refresh token of their own,
-- and until now a `users` row without a token was simply a broken account.
--
-- THE ALTERNATIVE THIS REJECTS. The obvious cheap shape is one operator user
-- carrying 180 profiles. It fails on notification targeting rather than on
-- anything to do with Google: every cron addresses the *user* — monday-stats
-- texts users.phone_number, post-generator and monthly-report email
-- users.email — so 180 profiles under one operator sends 180 texts and reports
-- to the operator and none to any retailer. It also leaves the retailer with no
-- identity at all, and therefore no route to ever give them the monthly report
-- the deck promises without redoing the model.
--
-- So a retailer keeps their own `users` row, with their own email, phone,
-- tenant and entitlement, and only the *credential* is borrowed:
--
--     operator (Stellar)   google_refresh_token = <encrypted>, managed_by = null
--       └── retailer       google_refresh_token = null,        managed_by = operator
--
-- Token resolution is `user.token ?? manager.token`, in lib/managed-access.ts.
--
-- SELF-REFERENCING ON PURPOSE. The manager is another `users` row rather than a
-- separate table because a manager is a real Google account with a real token,
-- and giving it a second home would mean two places to encrypt, rotate and
-- revoke a credential. One kind of thing, one table.
--
-- ON DELETE RESTRICT, deliberately. Deleting a manager while retailers still
-- point at it would silently strip Google access from every one of them — a
-- fleet-wide outage caused by one row disappearing. RESTRICT makes that
-- impossible to do by accident: the manager cannot be deleted until its
-- retailers have been repointed or removed, which is the conversation you want
-- to be forced into.
--
-- ADDITIVE ONLY: one nullable column, one FK, one partial index. No existing row
-- is rewritten, no existing column changes, and every current user gets NULL —
-- which reads as "manages its own access", exactly the behaviour they have now.

alter table public.users
  add column if not exists managed_by_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_managed_by_user_id_fkey'
  ) then
    alter table public.users
      add constraint users_managed_by_user_id_fkey
      foreign key (managed_by_user_id) references public.users(id)
      on delete restrict;
  end if;
end $$;

-- A user cannot manage itself. Cheap to state, and it rules out the cycle that
-- would make token resolution recurse forever.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_managed_by_not_self'
  ) then
    alter table public.users
      add constraint users_managed_by_not_self
      check (managed_by_user_id is null or managed_by_user_id <> id);
  end if;
end $$;

-- Only managed rows are ever looked up this way, and they are the minority
-- until the pilot scales, so the index is partial.
create index if not exists users_managed_by_user_id_idx
  on public.users (managed_by_user_id)
  where managed_by_user_id is not null;
