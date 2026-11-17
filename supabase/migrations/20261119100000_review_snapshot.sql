-- A daily note of each listing's review totals, for the network summary.
--
-- The network summary can say how often customers called the network's shops,
-- but not what the network's rating is or how many of its reviews have been
-- answered: those were read for one shop at a time and never kept. The daily
-- figures job now notes four numbers per listing (lib/review-snapshot.ts):
--
--   profiles.review_rating        Google's own average rating for the listing
--   profiles.review_count         Google's own count of its reviews
--   profiles.reviews_read         how many reviews we could read (the same,
--                                 unless a listing has more than we page through)
--   profiles.reviews_answered     how many of those have an owner's reply
--   profiles.review_snapshot_at   when the note was taken
--
-- These are totals. No review text and no reviewer is stored here. They are
-- shown to the funder only added up across at least three shops.
--
-- ADDITIVE ONLY: five nullable columns.
alter table public.profiles add column if not exists review_rating numeric(3,2) check (review_rating is null or (review_rating >= 0 and review_rating <= 5));
alter table public.profiles add column if not exists review_count integer check (review_count is null or review_count >= 0);
alter table public.profiles add column if not exists reviews_read integer check (reviews_read is null or reviews_read >= 0);
alter table public.profiles add column if not exists reviews_answered integer check (reviews_answered is null or reviews_answered >= 0);
alter table public.profiles add column if not exists review_snapshot_at timestamptz;
