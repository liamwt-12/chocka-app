-- Slice 2 — create the tenants table and seed the Chocka row.
--
-- ADDITIVE ONLY: this migration creates one new table and inserts one row. It
-- does not ALTER, DROP, UPDATE or DELETE any existing table, so it cannot affect
-- existing Chocka data (users, profiles, scheduled_posts, reviews, …).
--
-- Runtime resolution stays in-code this slice (lib/tenant-registry.ts +
-- getTenant()); this table is the schema-of-record so slice 3 can add
-- tenant_id FKs referencing tenants(id). Columns mirror the Tenant /
-- TenantPalette shapes in lib/tenant.ts 1:1, and the seed reproduces
-- CHOCKA_BASE field-for-field. RLS is intentionally NOT enabled here — that is
-- slice 4.

create table if not exists public.tenants (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text unique not null,
  status                text not null default 'active',      -- active | disabled
  hostname              text unique not null,
  hostname_aliases      text[] not null default '{}',
  app_url               text not null,
  brand_name            text not null,
  wordmark              text not null,
  legal_entity          text,
  marketing_url         text,
  email_from            text,
  support_email         text,
  team_email            text,
  privacy_email         text,
  price_monthly_pence   integer,
  proof_location        text,
  meta_title            text,
  meta_description      text,
  palette               jsonb not null,
  -- Per-tenant OAuth (slice 5) — nullable and unused for now.
  -- google_client_secret as a plaintext column is a known smell; move to a
  -- secret store when slice 5 makes it live.
  google_client_id      text,
  google_client_secret  text,
  google_redirect_uri   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Seed Chocka. Values mirror lib/tenant.ts CHOCKA_BASE exactly (app_url and
-- email_from use the same defaults getTenant() falls back to when env is unset).
insert into public.tenants (
  slug, status, hostname, hostname_aliases, app_url,
  brand_name, wordmark, legal_entity, marketing_url, email_from,
  support_email, team_email, privacy_email,
  price_monthly_pence, proof_location, meta_title, meta_description, palette
) values (
  'chocka',
  'active',
  'app.chocka.co.uk',
  array['chocka.co.uk', 'www.chocka.co.uk', 'localhost', '127.0.0.1'],
  'https://app.chocka.co.uk',
  'Chocka',
  'CHOCKA',
  'Useful for Humans Ltd',
  'https://chocka.co.uk',
  'Chocka <hello@chocka.co.uk>',
  'hello@chocka.co.uk',
  'team@chocka.co.uk',
  'privacy@chocka.co.uk',
  2900,
  'North East',
  'Chocka — Keep your diary chocka',
  'We manage your Google Business Profile so you don''t have to. Auto-posting, review replies, weekly stats. £29/month.',
  '{
    "brand": "#D4622B",
    "brandDark": "#C0571F",
    "brandLight": "rgba(212,98,43,0.06)",
    "brandStrong": "#E8541A",
    "brandStrongDark": "#C43E10",
    "brandStrongLight": "#FFF0EB",
    "routeAccent": "#FF6B35",
    "charcoal": "#2A2520",
    "cream": "#F8F6F3",
    "orange": "#D4622B",
    "gold": "#E7C36A",
    "green": "#2D8B4E",
    "red": "#D93025",
    "grey": "#A09A93",
    "text": "#5A554F",
    "warmBg": "#F0EDE8"
  }'::jsonb
)
on conflict (slug) do nothing;
