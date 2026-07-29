-- Seed the Stellar Local tenant row.
--
-- ADDITIVE ONLY: one INSERT into public.tenants, guarded by ON CONFLICT (slug)
-- DO NOTHING. It creates no table, alters no column and touches no existing
-- row, so it cannot affect Chocka data.
--
-- WHY THIS ROW EXISTS: per-user work (crons, email) resolves a tenant from
-- users.tenant_id, which is a FK to tenants(id). Without a Stellar row there is
-- nothing for a Stellar user's tenant_id to point at. The row is therefore a
-- referential target first and foremost.
--
-- WHAT IS AND IS NOT AUTHORITATIVE: runtime brand config still comes from
-- lib/tenant.ts (STELLAR_BASE) via getTenantBySlug(), not from this row. That is
-- deliberate — see FOLLOWUPS "Pre-pilot — Stellar tenancy". This table does not
-- have columns for every Tenant field (fontHeading, fontBody, iconSvg, iconPng
-- and priceMonthlyGbp have no equivalent here), so it *cannot* be the full
-- source of truth until those columns exist. Making the table authoritative is
-- the later swap; until then treat lib/tenant.ts as canonical and keep this row
-- in step with it.
--
-- Values below mirror STELLAR_BASE, STELLAR_APP_URL and STELLAR_EMAIL_FROM in
-- lib/tenant.ts field-for-field, exactly as the Chocka seed mirrors CHOCKA_BASE.

insert into public.tenants (
  slug, status, hostname, hostname_aliases, app_url,
  brand_name, wordmark, legal_entity, marketing_url, email_from,
  support_email, team_email, privacy_email,
  price_monthly_pence, proof_location, meta_title, meta_description, palette
) values (
  'stellar',
  'active',
  'app.stellarlocal.co.uk',
  -- Empty on purpose. lib/tenant-registry.ts maps only app.stellarlocal.co.uk to
  -- this tenant; the apex and www serve a separate Netlify marketing site and
  -- never reach this app. Listing them would imply routing that does not exist.
  array[]::text[],
  'https://app.stellarlocal.co.uk',
  'Stellar Local',
  'STELLAR LOCAL',
  'Useful for Humans Ltd',
  'https://stellarlocal.co.uk',
  'Stellar Local <hello@stellarlocal.co.uk>',
  'hello@stellarlocal.co.uk',
  'team@stellarlocal.co.uk',
  'privacy@stellarlocal.co.uk',
  -- Free to the retailer — Tarkett funds the service. Price-derived copy and
  -- arithmetic must handle 0; see FOLLOWUPS on the dashboard ROI tile.
  0,
  'UK',
  'Stellar Local · Get found',
  'Stellar Local looks after your shop''s presence on Google so more local customers find you and call. Free — Tarkett pays for it.',
  -- Stellar has one accent (--gold), not Chocka's two, so brand and brandStrong
  -- deliberately carry the same value. "orange" is a legacy key name that here
  -- carries the gold.
  '{
    "brand": "#B8923C",
    "brandDark": "#9C7C33",
    "brandLight": "rgba(184,146,60,0.06)",
    "brandStrong": "#B8923C",
    "brandStrongDark": "#9C7C33",
    "brandStrongLight": "#FAF5EA",
    "routeAccent": "#B8923C",
    "charcoal": "#171717",
    "cream": "#FCFBF9",
    "orange": "#B8923C",
    "gold": "#B8923C",
    "green": "#2D8B4E",
    "red": "#B4372B",
    "grey": "#8A8680",
    "text": "#55524E",
    "warmBg": "#F1EFE9"
  }'::jsonb
)
on conflict (slug) do nothing;
