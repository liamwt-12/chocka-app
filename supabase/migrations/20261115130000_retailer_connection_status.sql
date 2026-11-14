-- Ownership detection (lib/ownership.ts): where each shop got to when it
-- signed in, so /admin/pilot and the shop's own screens can say what to do next.
--
--   connection_status      invited | connected | check_listing | no_access | waiting_google
--   connection_detail      a plain sentence for whoever is looking
--   connection_checked_at  when it was last decided
--
-- ADDITIVE ONLY: three nullable columns. retailers already has RLS (20261115090000).
alter table public.retailers add column if not exists connection_status text
  check (connection_status in ('invited', 'connected', 'check_listing', 'no_access', 'waiting_google'));
alter table public.retailers add column if not exists connection_detail text;
alter table public.retailers add column if not exists connection_checked_at timestamptz;
