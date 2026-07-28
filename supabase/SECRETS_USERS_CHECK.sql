-- Secrets at rest — constrain users.google_refresh_token. RUN THIS WHOLE BLOCK AS ONE.
--
-- Target DB: emilonrdyljbydtgrvof ("MapBoost"). VERIFY THE REF — the project
-- named "chocka index" (vxycdhyembwufoqfoqsg) is a different database.
--
-- Spec: SECRETS_AT_REST.md, § Sequencing step 3 (contract).
--
-- WHAT THIS DOES: adds a CHECK so users.google_refresh_token can only ever hold
-- NULL or an application-encrypted envelope ("v1." prefix). It does NOT encrypt
-- anything — scripts/backfill-encrypt-tokens.ts already did that on 2026-07-28.
--
-- PREREQUISITES, and this one is real, unlike the tenants constraint:
--   1. The backfill has run. Every non-null token must already be an envelope,
--      or the ALTER will fail on the offending row.
--   2. The application code no longer reads plaintext. The tolerant reader
--      decryptSecretAllowingPlaintext() must be gone, otherwise a route could
--      still hand a plaintext value to Google and appear to work.
-- Both were true at the commit that introduces this file.
--
-- EXPECTED APP IMPACT: none. Every write path already produces an envelope
-- (the three writers in app/api/auth/callback/google/route.ts), and NULL stays
-- valid so the offboarding script's clear still works.
--
-- ROLLBACK (instant, no data touched):
--   alter table public.users drop constraint google_refresh_token_encrypted;

begin;

-- ── Preconditions ───────────────────────────────────────────────────────────
do $$
declare
  plaintext_rows int;
  envelope_rows  int;
  null_rows      int;
begin
  select count(*) into plaintext_rows
    from public.users
   where google_refresh_token is not null
     and google_refresh_token not like 'v1.%';

  select count(*) into envelope_rows
    from public.users where google_refresh_token like 'v1.%';

  select count(*) into null_rows
    from public.users where google_refresh_token is null;

  raise notice 'Before: % plaintext, % envelope, % null', plaintext_rows, envelope_rows, null_rows;

  -- The ALTER below would fail on these anyway, but failing here names the
  -- problem instead of surfacing it as a bare constraint violation.
  if plaintext_rows > 0 then
    raise exception
      'ABORT: % row(s) still hold a plaintext refresh token — run scripts/backfill-encrypt-tokens.ts --commit first', plaintext_rows;
  end if;

  if exists (select 1 from pg_constraint
             where conname = 'google_refresh_token_encrypted'
               and conrelid = 'public.users'::regclass) then
    raise exception 'ABORT: constraint google_refresh_token_encrypted already exists';
  end if;
end $$;

-- ── Apply ───────────────────────────────────────────────────────────────────
-- Note this ALTER is itself the positive proof. ADD CONSTRAINT validates every
-- existing row, so it can only succeed if the backfilled envelope row and all
-- the NULL rows satisfy the predicate. No probe write is needed to demonstrate
-- that envelopes and NULLs are accepted — and deliberately so: unlike the
-- tenants column, this one holds a live credential, and the verify block below
-- must not write to it.
alter table public.users
  add constraint google_refresh_token_encrypted
  check (google_refresh_token is null or google_refresh_token like 'v1.%');

-- ── Verify ──────────────────────────────────────────────────────────────────
do $$
declare
  ok boolean;
  rejected boolean := false;
  probe_id uuid;
begin
  select exists (select 1 from pg_constraint
                 where conname = 'google_refresh_token_encrypted'
                   and conrelid = 'public.users'::regclass
                   and contype = 'c')
    into ok;
  if not ok then
    raise exception 'VERIFY FAILED: constraint not present after ALTER';
  end if;

  -- Negative probe. Aimed at a row whose token is already NULL, never at the
  -- row holding the real credential, and it is expected to FAIL — so nothing is
  -- written either way. A CHECK that exists but never rejects is the "right
  -- answer for the wrong reason" failure this project has hit three times
  -- (supabase/SLICE_4_APPLY_NOTES.md § The false green).
  select id into probe_id
    from public.users where google_refresh_token is null limit 1;
  if probe_id is null then
    raise exception 'VERIFY FAILED: no NULL-token row available to probe against';
  end if;

  begin
    update public.users
       set google_refresh_token = 'plaintext-probe-not-an-envelope'
     where id = probe_id;
    rejected := false;
  exception
    when check_violation then
      if sqlerrm like '%google_refresh_token_encrypted%' then
        rejected := true;
      else
        raise exception 'VERIFY FAILED: wrong constraint rejected the probe: %', sqlerrm;
      end if;
  end;
  if not rejected then
    raise exception 'VERIFY FAILED: plaintext write was ACCEPTED — constraint is inert';
  end if;

  raise notice 'VERIFY PASS: constraint present and rejects plaintext; envelope and NULL rows validated by the ALTER itself';
end $$;

-- Nothing in this transaction writes to google_refresh_token: the only UPDATE
-- is the negative probe, which the constraint refuses. Review the notices, then
-- commit.
commit;
