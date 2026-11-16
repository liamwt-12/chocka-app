-- Why a shop has not connected, in a form a person can act on.
--
-- Until now, a shop that refused at Google, left a box unticked, gave up, or
-- never opened its link all read "Link issued". These columns let the app
-- record what it can see, and let whoever is helping record what it cannot
-- (a bounced invitation email is seen by the sender, not by us).
--
--   retailer_invites.opened_at      first time the invite page was opened in a
--                                   real browser. Reading a page is not acting
--                                   on it, so this never affects the invite.
--   retailers.connect_issue         why the last sign-in did not finish:
--                                   cancelled | unticked | no_listing |
--                                   wrong_account | google_error. Cleared when
--                                   the shop connects.
--   retailers.connect_issue_at      when that happened.
--   retailers.invite_bounced_at     support marked the invitation as bounced or
--                                   sent to the wrong person.
--   retailers.support_note          a short note from whoever is helping.
--   retailers.listing_confirmed_at  a person looked at a "check listing" shop
--                                   and said the listing it connected is right.
--
-- ADDITIVE ONLY: six nullable columns, no change to any existing column or
-- constraint. Both tables already have row level security on with no policies
-- (20261115090000), so nothing new is exposed.
alter table public.retailer_invites add column if not exists opened_at timestamptz;

alter table public.retailers add column if not exists connect_issue text
  check (connect_issue in ('cancelled', 'unticked', 'no_listing', 'wrong_account', 'google_error'));
alter table public.retailers add column if not exists connect_issue_at timestamptz;
alter table public.retailers add column if not exists invite_bounced_at timestamptz;
alter table public.retailers add column if not exists support_note text;
alter table public.retailers add column if not exists listing_confirmed_at timestamptz;
