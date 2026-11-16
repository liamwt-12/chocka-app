-- change_log.action: allow 'add_media', a photo added to the Google listing's
-- own gallery (lib/change-log.ts, loggedAddListingPhoto).
--
-- Only needed before SHOP_PHOTOS_TO_LISTING is turned on. Until it is applied,
-- adding a listing photo fails safely: the change log refuses the row, and
-- lib/change-log.ts never makes a write it could not record first.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ DO NOT APPLY THIS, EVEN TO STAGING, UNTIL EVERY EARLIER MIGRATION IS ON  │
-- │ PRODUCTION (20261114120000 through 20261116100000).                      │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Why. Every other pending migration only ADDS things, so staging is simply
-- "ahead" of production, which is what scripts/apply-migration-to-production.py
-- requires. This one REPLACES a constraint that 20261114120000 creates. If
-- staging has the new definition while production has (or is about to get) the
-- old one, production holds an object staging does not, and the script's guard
-- reads that as "they have diverged" and refuses every migration after the
-- first. It was applied to staging on 2026-11-16 to prove it works, and then
-- put back, for exactly this reason.
--
-- When the time comes: staging first, then production, like any other.
alter table public.change_log drop constraint if exists change_log_action_check;
alter table public.change_log add constraint change_log_action_check
  check (action in ('update_location', 'create_post', 'reply_review', 'add_media'));
