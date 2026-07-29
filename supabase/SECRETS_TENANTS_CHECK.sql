-- Secrets at rest — constrain tenants.google_client_secret. RUN THIS WHOLE BLOCK AS ONE.
--
-- Target DB: emilonrdyljbydtgrvof ("MapBoost"). VERIFY THE REF — the project
-- named "chocka index" (vxycdhyembwufoqfoqsg) is a different database.
--
-- Spec: SECRETS_AT_REST.md.
--
-- WHAT THIS DOES: adds a CHECK so tenants.google_client_secret can only ever
-- hold NULL or an application-encrypted envelope ("v1." prefix, see
-- SECRETS_AT_REST.md § Envelope format). It does NOT encrypt anything, because
-- there is nothing to encrypt.
--
-- WHY NOW, AHEAD OF ANY APP CODE: the column is empty on every row and is read
-- by NO code today — the only references in the repo are the create-table
-- comment at supabase/migrations/20260720000000_create_tenants.sql:35-38. OAuth
-- runs off process.env.GOOGLE_CLIENT_SECRET (lib/google.ts:86,101). Landing the
-- constraint while the column is empty is therefore zero-risk, and it makes it
-- structurally impossible for slice 5 to introduce the plaintext-secret problem
-- that MULTI_TENANCY_PLAN.md:343 already flags. Adding it afterwards would mean
-- migrating a live OAuth credential instead.
--
-- The equivalent constraint on users.google_refresh_token deliberately does NOT
-- land here. That column has one live plaintext row and must be backfilled
-- first; see SECRETS_AT_REST.md § Sequencing, step 3.
--
-- PREREQUISITES: none. Independent of slices 3, 4 and 5.
--
-- EXPECTED APP IMPACT: none. No code reads or writes this column.
--
-- ROLLBACK (instant, no data touched):
--   alter table public.tenants drop constraint google_client_secret_encrypted;

begin;

-- ── Preconditions ───────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and table_name   = 'tenants'
                   and column_name  = 'google_client_secret') then
    raise exception 'ABORT: tenants.google_client_secret does not exist';
  end if;

  -- Any pre-existing value would be plaintext and would fail the constraint on
  -- creation. Fail loudly and early rather than surfacing it as a constraint
  -- violation with no context: if this fires, the column has been populated
  -- since the spec was written and the backfill path applies instead.
  select count(*) into n
    from public.tenants
   where google_client_secret is not null
     and google_client_secret not like 'v1.%';
  if n > 0 then
    raise exception
      'ABORT: % row(s) hold a plaintext google_client_secret — backfill first, see SECRETS_AT_REST.md', n;
  end if;

  if exists (select 1 from pg_constraint
             where conname = 'google_client_secret_encrypted'
               and conrelid = 'public.tenants'::regclass) then
    raise exception 'ABORT: constraint google_client_secret_encrypted already exists';
  end if;
end $$;

-- ── Apply ───────────────────────────────────────────────────────────────────
alter table public.tenants
  add constraint google_client_secret_encrypted
  check (google_client_secret is null or google_client_secret like 'v1.%');

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Proves the constraint is present AND that it actually bites. The negative
-- check matters: a CHECK that exists but never rejects is the "right answer for
-- the wrong reason" failure mode this project has already hit three times
-- (supabase/SLICE_4_APPLY_NOTES.md § The false green).
do $$
declare
  ok boolean;
  rejected boolean := false;
begin
  select exists (select 1 from pg_constraint
                 where conname = 'google_client_secret_encrypted'
                   and conrelid = 'public.tenants'::regclass
                   and contype = 'c')
    into ok;
  if not ok then
    raise exception 'VERIFY FAILED: constraint not present after ALTER';
  end if;

  -- Negative: a plaintext write must be refused. Discriminated on SQLSTATE
  -- 23514 (check_violation) AND on the constraint name, so an unrelated failure
  -- cannot be recorded as a pass.
  begin
    update public.tenants
       set google_client_secret = 'plaintext-probe-not-an-envelope'
     where slug = 'chocka';
    rejected := false;
  exception
    when check_violation then
      if sqlerrm like '%google_client_secret_encrypted%' then
        rejected := true;
      else
        raise exception 'VERIFY FAILED: wrong constraint rejected the probe: %', sqlerrm;
      end if;
  end;
  if not rejected then
    raise exception 'VERIFY FAILED: plaintext write was ACCEPTED — constraint is inert';
  end if;

  -- Positive: a well-formed envelope must still be accepted, and NULL must
  -- remain valid (it is the current value on every row).
  update public.tenants set google_client_secret = 'v1.aaa.bbb.ccc' where slug = 'chocka';
  update public.tenants set google_client_secret = null              where slug = 'chocka';

  raise notice 'VERIFY PASS: constraint present, rejects plaintext, accepts envelope and NULL';
end $$;

-- The verify block's probe UPDATEs are undone by leaving the column NULL above;
-- nothing else in this transaction touches data. Review the notice, then commit.
commit;
