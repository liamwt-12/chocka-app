-- Retailer invites, for the Stellar → Tarkett retailer onboarding flow.
--
-- ADDITIVE ONLY: creates one new table and its indexes, plus one nullable column
-- on public.retailers. It does not DROP, UPDATE or DELETE anything, and the one
-- ALTER adds a nullable column with no default, so it cannot affect existing
-- rows, users, profiles, tenants or any Chocka data.
--
-- FLOW: Stellar sends an invite to a Tarkett retailer → the retailer opens a
-- single-use magic link → the link establishes a short-lived pre-auth context →
-- the retailer connects their Google Business Profile → only THEN is a users row
-- created and the retailer linked to it.
--
-- That last ordering is not a preference. app/api/auth/callback/google/route.ts
-- deliberately throws rather than create a user without a refresh token ("would
-- leave a user who appears signed up but cannot reach their own Business
-- Profile"). Accepting an invite therefore must NOT create a users row: there is
-- no credential to give it yet. The invite carries the identity until Google
-- does, which is why accepted_at and user_id are separate columns and why
-- user_id is nullable — see the comments on both below.
--

create table if not exists public.retailer_invites (
  id                uuid primary key default gen_random_uuid(),

  -- Which retailer this invites. Cascade because an invite has no meaning
  -- without its retailer, unlike score_history which is a record of an event.
  retailer_id       uuid not null references public.retailers(id) on delete cascade,

  -- Scoped from day one, matching retailers.tenant_id and users.tenant_id rather
  -- than being retrofitted. Denormalised from retailers deliberately: an invite
  -- is sent by a tenant, and if a retailer row were ever re-parented the invite
  -- should still record who actually sent it.
  tenant_id         uuid not null references public.tenants(id),

  -- The retailer's contact address, as sent to. Copied onto the invite rather
  -- than read through retailers because it is the address the invite WAS sent
  -- to, which must stay true even if the retailer's contact details change
  -- later. This is the only place in this database that holds Tarkett retailer
  -- contact data; it is here for product operation, which is a different
  -- decision from committing it to the public repo — see
  -- scripts/source-data/README.md for why the repo copy is stripped.
  email             text not null,

  -- HMAC-SHA256 of the token, never the token itself. A leaked database dump
  -- must not yield working invite links, which is the whole reason the plaintext
  -- token exists only in the email that was sent.
  --
  -- Namespaced 'invite:<token>' before hashing, following the existing
  -- generateReviewHash convention in lib/cron.ts, so one secret can serve
  -- several link types without a token from one being replayable as another.
  -- NOT truncated: generateCancelHash cuts to 16 hex chars (64 bits), which is
  -- fine for a cancel link but too short for a token that establishes identity.
  token_hash        text not null,

  -- Lifecycle. Deliberately does NOT include 'expired': expiry is a function of
  -- expires_at and now(), so storing it as state would create two sources of
  -- truth that drift the moment a sweep job is late. Read expiry, do not write
  -- it.
  status            text not null default 'pending'
                      check (status in ('pending', 'accepted', 'revoked')),

  -- Set when the invite is actually emailed, which is not when the row is
  -- created — a batch can be prepared and reviewed before anything is sent.
  -- Null means prepared but unsent.
  sent_at           timestamptz,

  -- Single-use with a 30-day window, re-issuable. No default: the caller states
  -- the window so it is visible at the call site rather than buried here, and so
  -- a re-issue can differ from the original if it ever needs to.
  expires_at        timestamptz not null,

  -- When the retailer opened the link and it verified. This is the single-use
  -- gate: a non-null accepted_at means the token is spent, checked in the same
  -- query that looks the token up so a double-click cannot accept twice.
  accepted_at       timestamptz,

  -- Who it became, once Google has supplied a credential. Stays null through
  -- acceptance and is set only by the OAuth callback, so an invite that was
  -- opened but abandoned before connecting is distinguishable from one that
  -- completed: accepted_at set, user_id null. Without both columns those two
  -- states would look identical and the funnel would be unmeasurable.
  user_id           uuid references public.users(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Token lookup is the hot path on every magic-link open, and the uniqueness is
-- what makes a hash collision a constraint error rather than a silent
-- cross-retailer authentication.
create unique index if not exists retailer_invites_token_hash_idx
  on public.retailer_invites (token_hash);

create index if not exists retailer_invites_retailer_idx
  on public.retailer_invites (retailer_id);

create index if not exists retailer_invites_tenant_idx
  on public.retailer_invites (tenant_id);

-- At most ONE live invite per retailer. Re-issuing means revoking the old row
-- (or letting it be accepted) before a new one can exist, which is what makes
-- "re-issuable" safe: without this, a retailer could hold several valid tokens
-- at once and revoking one would give false assurance.
--
-- Partial rather than a plain unique index, because accepted and revoked rows
-- must be allowed to accumulate as history.
create unique index if not exists retailer_invites_one_pending_idx
  on public.retailer_invites (retailer_id)
  where status = 'pending';

-- Finding what is still outstanding, for the sweep that expires stale invites
-- and for any "who has not responded" view.
create index if not exists retailer_invites_pending_expiry_idx
  on public.retailer_invites (expires_at)
  where status = 'pending';

-- The retailer's contact address, as scraped from Tarkett's public store locator.
--
-- WHY THIS IS HERE AND NOT ONLY ON retailer_invites. An invite row cannot exist
-- without a token_hash and an expires_at, so using retailer_invites.email as the
-- store for 180 contacts would mean minting 180 tokens and starting 180 thirty-day
-- clocks before a single email had been sent — which defeats retailer_invites.sent_at
-- being nullable for exactly the prepare-then-review-then-send case. The two columns
-- have genuinely different jobs:
--
--   retailers.contact_email      — where this retailer can be reached, now.
--   retailer_invites.email       — the address an invite WAS sent to, frozen at
--                                  send time even if the above changes later.
--
-- Nullable: 4 of the 180 source records have no email at all, and 2 more carry
-- theirs misfiled into the source's `website` field (ids 29463 and 29690, both
-- recovered on load — see scripts/source-data/README.md). A retailer without a
-- contact is a real state, not an error, and must not need a sentinel.
--
-- This and retailer_invites.email are the only Tarkett retailer contact data in
-- this database. Holding it in a private table for product operation is a
-- different decision from committing it to the public repo, which was declined —
-- see scripts/source-data/README.md for why the repo copy is stripped.
alter table public.retailers
  add column if not exists contact_email text;

-- The retailer↔user link, set by the OAuth callback and not before. Nullable
-- with no default, so every existing row is unaffected and an unclaimed
-- retailer is simply null rather than needing a sentinel.
--
-- on delete set null, not cascade: if a user deletes their account the retailer
-- still exists as a Tarkett record with a baseline score, and must not vanish
-- from the dataset with them. Compare retailer_invites.retailer_id above, which
-- does cascade, because an invite genuinely has no meaning without its retailer.
alter table public.retailers
  add column if not exists user_id uuid references public.users(id) on delete set null;

-- Partial: only claimed retailers are indexed, and the unique constraint stops
-- one user being linked to two retailer rows. That matters here specifically
-- because three place_ids are each shared by two retailer rows (duplicate
-- source records — see the previous migration), so a user connecting a profile
-- that matches both could otherwise be attached to each of them.
create unique index if not exists retailers_user_id_idx
  on public.retailers (user_id)
  where user_id is not null;
