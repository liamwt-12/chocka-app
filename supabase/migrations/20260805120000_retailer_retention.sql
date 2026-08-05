-- Retention tracking for retailer records.
--
-- WHY: `retailers` had no retention policy at all. Nothing ever deleted a
-- record, and `retailers.user_id` is `on delete set null`, so records
-- deliberately survive account deletion too. Indefinite retention of personal
-- data with no stated period weighs directly against the legitimate-interests
-- basis the /privacy notice relies on — see LEGITIMATE_INTERESTS_ASSESSMENT.md.
--
-- The notice currently says the review is done "by hand rather than
-- automatically", which is honest but weak. These two columns are what let that
-- wording tighten to a real period once a refresh process is feeding them.
--
-- ADDITIVE ONLY: two nullable timestamptz columns with no defaults, plus one
-- partial index. No existing row is rewritten and no existing column changes, so
-- this cannot affect live data.
--
-- Tested on `chocka-staging` before production — the first migration in this
-- repo for which that was actually possible.

-- When this retailer was last seen in the source list. Set by the import for
-- every row present in the refreshed locator data. NULL means "never refreshed
-- since this column existed", which is every row until the first refresh runs —
-- deliberately distinguishable from "refreshed and found".
alter table public.retailers
  add column if not exists last_seen_at timestamptz;

-- When a refresh completed WITHOUT finding this retailer. The deletion clock
-- runs from here, not from last_seen_at, so a gap in refreshes cannot silently
-- age a record towards deletion: no refresh means no delisting means no clock.
--
-- Nullable and expected to stay null for an active stockist. Cleared if the
-- retailer reappears in a later refresh, so a transient scrape failure that
-- delists everyone is recoverable by simply running a good refresh.
alter table public.retailers
  add column if not exists delisted_at timestamptz;

-- Only delisted rows are ever scanned by the retention job, and they are the
-- small minority, so the index is partial.
create index if not exists retailers_delisted_at_idx
  on public.retailers (delisted_at)
  where delisted_at is not null;
