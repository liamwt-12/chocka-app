-- Retailers and score history, for the Stellar Local pre-launch baseline.
--
-- ADDITIVE ONLY: creates two new tables and their indexes. It does not ALTER,
-- DROP, UPDATE or DELETE anything existing, so it cannot affect users, profiles,
-- tenants or any Chocka data.
--
-- SHAPE: mirrors the businesses / scores / score_history design already running
-- in the "chocka index" Supabase project (vxycdhyembwufoqfoqsg,
-- chocka-landing/supabase/migrations/001_initial_schema.sql) so the two stay
-- comparable and a later merge is cheap. Deliberate deviations are marked
-- DEVIATION below.
--
-- The scores/current + score_history split is collapsed into one table plus
-- history: `retailers` carries the current score denormalised for cheap reads,
-- and `score_history` is the append-only record of truth. chocka index needed a
-- separate `scores` row per business because it stored per-component subscores;
-- the batch CSV carries no component breakdown, only a final score and band, so
-- a whole table for it would be empty columns.

create table if not exists public.retailers (
  id                uuid primary key default gen_random_uuid(),

  -- Tarkett's retailer list is Stellar's, not Chocka's. Scoping from day one
  -- rather than retrofitting, matching users.tenant_id.
  tenant_id         uuid not null references public.tenants(id),

  -- Provenance. source_ref is the id column from the scraper's retailers.csv,
  -- so every row is traceable to its exact source record. The unique index on
  -- (source, source_ref) below is what makes re-running the import idempotent.
  source            text not null default 'tarkett-scraper',
  source_ref        text,

  -- DEVIATION from chocka index: place_id is NOT unique here, and is nullable.
  --   * 8 of 180 rows have no place_id at all (match_confidence = not_found).
  --   * 3 place_ids are each shared by TWO rows, because Tarkett's own source
  --     list contains the same business twice under slightly different names
  --     (Burts Carpets of Darlington / Burts of Darlington; Flooring
  --     Developments / Flooring Developments LTD; Northumbria Flooring /
  --     Northumbria Flooring & Furniture). Those are duplicate source records,
  --     not two businesses — so a unique constraint would reject a legitimate
  --     import rather than catch an error.
  -- Deduplicating them is a data decision, not a schema one; the rows are kept
  -- distinct and traceable so it can be made later without re-importing.
  place_id          text,

  name              text not null,
  town              text,
  nation            text,

  -- The raw public signals the batch scorer actually saw. Stored so a score can
  -- be re-derived or explained later without another Places call.
  rating            numeric(2,1),
  review_count      integer,
  photo_count       integer,
  has_website       boolean,

  -- How confident the scraper was that it found the right Google listing.
  -- 'high'   = name matched AND postcode matched
  -- 'review' = exactly one of the two — which one is NOT recorded upstream
  -- 'not_found' = neither; the row carries a score of 0
  -- See FOLLOWUPS "the scored.csv baseline is not quotable yet". This column is
  -- the reason the badge work can be honest: it must be preserved, not dropped.
  match_confidence  text check (match_confidence in ('high', 'review', 'not_found')),
  headline_gap      text,

  -- Current score, denormalised from the latest score_history row for cheap
  -- reads. score_history remains the record of truth.
  --
  -- score_source is what makes batch and live distinguishable rather than
  -- silently blended. They are NOT the same measurement: the batch scorer sees
  -- public Places data (rating, reviews, completeness), while the live audit
  -- sees OAuth-only signals it cannot. A connected retailer's live score may
  -- move against its batch score for that reason alone, and the UI must say so
  -- rather than imply a trend.
  score             integer,
  band              text,
  score_source      text check (score_source in ('batch', 'live')),
  scored_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists retailers_tenant_id_idx on public.retailers (tenant_id);
create index if not exists retailers_place_id_idx  on public.retailers (place_id);

-- Makes the import idempotent: re-running it updates rather than duplicates.
create unique index if not exists retailers_source_ref_idx
  on public.retailers (source, source_ref);

-- Append-only score record. One row per scoring event per retailer.
create table if not exists public.score_history (
  id            uuid primary key default gen_random_uuid(),
  retailer_id   uuid not null references public.retailers(id) on delete cascade,

  score         integer not null,
  band          text,

  -- Required here, unlike on retailers: a history row with an unknown source is
  -- worse than useless, because it is exactly the ambiguity this column exists
  -- to prevent.
  score_source  text not null check (score_source in ('batch', 'live')),

  -- DEVIATION from chocka index, which uses `week_of date` for weekly snapshots.
  -- This baseline is a one-off import dated 2026-06-21 (when the CSV was
  -- generated), not a weekly cadence, and live audits happen whenever a retailer
  -- connects. A timestamp records both truthfully; a week bucket would have to
  -- invent one. NOT defaulted to now() on purpose — the import must state the
  -- real scoring date, and a default would quietly let it stamp today.
  scored_at     timestamptz not null,

  created_at    timestamptz not null default now()
);

create index if not exists score_history_retailer_idx
  on public.score_history (retailer_id, scored_at desc);

-- One scoring event per (retailer, source, timestamp). This is what makes
-- re-running the import safe: a second run conflicts and does nothing, rather
-- than appending a duplicate baseline row. Without it, an accidental re-run
-- would silently double every retailer's history and there would be no way to
-- tell the copies apart afterwards.
create unique index if not exists score_history_event_idx
  on public.score_history (retailer_id, score_source, scored_at);

-- DEVIATION from chocka index: no rank_in_town_trade. Ranking is a separate
-- concern (chocka index has a whole `rankings` table for it) and nothing in the
-- Stellar scope ranks retailers against each other yet. Adding an always-null
-- column now would imply a feature that does not exist.
