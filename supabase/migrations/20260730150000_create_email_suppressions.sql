-- Email suppression list, for honouring unsubscribe requests.
--
-- ADDITIVE ONLY: one new table and its indexes. Nothing existing is altered.
--
-- WHY THIS EXISTS. PECR regulation 23 prohibits sending marketing email that
-- conceals the sender's identity or that lacks a valid address for opt-out
-- requests, and it applies to corporate and individual subscribers alike, whether
-- the message was solicited or not. ICO guidance goes further: honour a corporate
-- subscriber's opt-out and keep a "do not email" suppression list. A reply-to
-- address alone is not a mechanism anyone can rely on being actioned.
--
-- Keyed on the ADDRESS, not the retailer. Someone who opts out is opting the
-- address out — if the same address appears against a second retailer row (and
-- Tarkett's list does contain the same business twice under different names), the
-- suppression must still bite. Storing retailer_id instead would let a duplicate
-- row keep emailing a person who has already said no.
create table if not exists public.email_suppressions (
  id            uuid primary key default gen_random_uuid(),

  -- Lower-cased on write by the caller. Unique so a second unsubscribe is a
  -- no-op rather than a duplicate row.
  email         text not null,

  -- Which brand they opted out of. Suppression is per-tenant on purpose: a
  -- Chocka customer has not opted out of Stellar, and vice versa. Nullable so a
  -- global suppression can be recorded if that is ever needed.
  tenant_id     uuid references public.tenants(id),

  -- Free text. 'unsubscribe-link', 'reply', 'bounce', 'complaint' — recorded so a
  -- hard bounce can be told apart from a person actively saying no.
  reason        text not null default 'unsubscribe-link',

  -- Where the request came from, for audit. An unsubscribe we cannot account for
  -- is one we cannot defend if challenged.
  source        text,

  created_at    timestamptz not null default now()
);

create unique index if not exists email_suppressions_email_tenant_idx
  on public.email_suppressions (lower(email), tenant_id);

create index if not exists email_suppressions_email_idx
  on public.email_suppressions (lower(email));
