-- change_log: before/after record of every write the app makes to a Google
-- Business Profile.
--
-- WHY: the one-pager and the deck promise that any change can be undone. Until
-- now nothing recorded what a listing looked like before the app changed it, so
-- an undo was impossible in principle: the old description, services, hours or
-- categories were simply gone once the PATCH returned.
--
-- HOW IT IS WRITTEN (lib/change-log.ts):
--   1. read the current values of exactly the fields about to change
--   2. insert a row with status 'pending' and before_value
--   3. make the Google write
--   4. update the row to 'applied' with after_value, or 'failed' with the error
-- Step 2 happens before step 3, so a write can never happen without its
-- before-value already being on disk. If step 1 or 2 fails, the write is not made.
--
-- HOW IT IS UNDONE: scripts/revert-listing-change.ts reads before_value and
-- writes it back with the same update mask, logging the revert as its own row
-- (source 'revert') and stamping the original with reverted_at.
--
-- ADDITIVE ONLY: one new table and two indexes. No existing table is touched.
--
-- RLS is enabled with no policies, matching every other app table in the
-- baseline: only the service role (server code) can read or write it. This is
-- not new access-rule design; it is the existing default applied to a new table.

create table if not exists public.change_log (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),

  -- Who and which listing. SET NULL rather than CASCADE: if a user deletes
  -- their account, the record of what we did to a public listing should
  -- survive, and it holds only public listing content.
  user_id               uuid references public.users(id) on delete set null,
  profile_id            uuid references public.profiles(id) on delete set null,
  location_name         text not null,

  -- Which code path made the write: onboarding, post-publisher, review-alerts,
  -- auto-reply, revert.
  source                text not null,

  -- update_location | create_post | reply_review
  action                text not null check (action in ('update_location', 'create_post', 'reply_review')),

  -- For update_location, the Google updateMask (for example 'profile' or
  -- 'regularHours'). For posts and replies, the resource name written.
  target                text,

  before_value          jsonb,
  after_value           jsonb,

  status                text not null default 'pending' check (status in ('pending', 'applied', 'failed')),
  error                 text,

  reverted_at           timestamptz,
  reverted_by_change_id uuid references public.change_log(id) on delete set null
);

create index if not exists change_log_location_created_idx
  on public.change_log (location_name, created_at desc);

create index if not exists change_log_profile_idx
  on public.change_log (profile_id);

alter table public.change_log enable row level security;
