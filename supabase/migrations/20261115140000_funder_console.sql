-- Tarkett console login (lib/funder-auth.ts). Separate from shop logins.
--
-- funder_users        people at Tarkett allowed into the console, added by Liam
--                     with scripts/add-funder-user.ts. No passwords: sign-in is
--                     by a one-time emailed link.
-- funder_login_tokens one row per emailed link. Only a hash of the link token is
--                     stored; a token works once and expires after 15 minutes.
--
-- The console itself is behind TARKETT_CONSOLE_ENABLED, which is off: until it
-- is switched on, no link is ever emailed and every console route answers 404.
--
-- ADDITIVE ONLY. RLS on and public roles revoked on both tables.

create table if not exists public.funder_users (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  email       text not null,
  name        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists funder_users_email_idx on public.funder_users (lower(email));

create table if not exists public.funder_login_tokens (
  id              uuid primary key default gen_random_uuid(),
  funder_user_id  uuid not null references public.funder_users(id) on delete cascade,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists funder_login_tokens_user_idx on public.funder_login_tokens (funder_user_id, created_at desc);

alter table public.funder_users        enable row level security;
alter table public.funder_login_tokens enable row level security;
revoke all on table public.funder_users        from anon, authenticated;
revoke all on table public.funder_login_tokens from anon, authenticated;
