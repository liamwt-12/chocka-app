-- Review requests, version one (lib/review-requests.ts). Off unless REVIEW_REQUESTS=on.
--
-- ADDITIVE ONLY: three new tables. Nothing existing is changed.
--
-- NO EMAIL ADDRESS IS STORED in any of them. Each address is kept only as a
-- SHA-256 hash of its normalised form (lib/review-requests.ts hashEmail, which
-- explains why it is not keyed). A hash is still personal data, so all three
-- tables are locked like the others: RLS on with no policies, and the public
-- roles revoked. Only server code (the service role) can read or write.
--
-- How long each is kept (deleted by purgeReviewRequests, called from the daily
-- onboarding-sequence job):
--   review_requests               30 days
--   review_request_history        365 days
--   review_request_suppressions   never deleted: an unsubscribe is permanent

-- One row per email sent (or tried). For the daily limits and the record.
create table if not exists public.review_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  retailer_id  uuid not null references public.retailers(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id),
  email_hash   text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  -- One press of Send.
  batch_id     uuid not null,
  status       text not null check (status in ('sent', 'failed'))
);

create index if not exists review_requests_created_idx on public.review_requests (created_at);
create index if not exists review_requests_retailer_created_idx on public.review_requests (retailer_id, created_at);

alter table public.review_requests enable row level security;
revoke all on table public.review_requests from anon, authenticated;

-- "This shop has asked this address." The primary key is what stops the same
-- shop asking the same address twice, even with two sends at once.
create table if not exists public.review_request_history (
  retailer_id     uuid not null references public.retailers(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id),
  email_hash      text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  first_asked_at  timestamptz not null default now(),
  primary key (retailer_id, email_hash)
);

create index if not exists review_request_history_asked_idx on public.review_request_history (first_asked_at);

alter table public.review_request_history enable row level security;
revoke all on table public.review_request_history from anon, authenticated;

-- The do-not-email list. Platform-wide: no shop column, on purpose. Anyone on
-- this list is never sent a review request by any shop.
--
-- PERMANENT. No code path deletes from this table: the daily clear-out leaves
-- it alone, and a test fails if any app code is written that deletes from it.
-- A second add of the same address changes nothing (the first row, with its
-- added_at and source, is kept).
--
--   source  'link'      the person pressed the unsubscribe link in an email,
--                       or their mail client's own one-click unsubscribe
--           'operator'  an operator added it by hand in /admin/pilot, for
--                       example after the person replied "stop" to a shop
create table if not exists public.review_request_suppressions (
  email_hash  text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  added_at    timestamptz not null default now(),
  source      text not null check (source in ('link', 'operator'))
);

alter table public.review_request_suppressions enable row level security;
revoke all on table public.review_request_suppressions from anon, authenticated;
