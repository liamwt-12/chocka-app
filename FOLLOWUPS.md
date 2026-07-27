# Follow-ups

Deferred work captured so it isn't lost. Tie-in to the Stellar Local roadmap in brackets.

## P1

### Transient-enumeration → retryable error on OAuth connect  [P1 — Retailer product / onboarding]
**Context:** `getManageableListings` is deliberately **all-or-nothing** — if any account's
`getLocations` fails it throws, so a partial enumeration is never treated as authoritative
(this is what stops a transient failure from auto-binding the wrong listing). The cost:
in `app/api/auth/callback/google/route.ts`, `bindManageableListing` then throws on a
transient Google error (e.g. `accounts.list`/`locations.list` 5xx), both call sites catch
and default to `'no_profile'`, and the user lands on `/no-profile` rather than a retryable
state. The listings/select routes surface it as a 500 the picker retries, but the callback
path is a dead-end for that connect.

**Why deferred:** the safe failure mode (no-profile) is acceptable for now, and the case is
rare. Correctness (never bind the wrong listing) was the P0 priority and is done.

**Fix when picked up:** in the callback, distinguish a *thrown* enumeration error from a
genuine empty result. On throw, route to a retryable error (a `connect_failed` code / the
onboarding "Try Again" path) instead of `/no-profile`, which should be reserved for a real
empty manageable set. Isolated to the two catch blocks in the callback plus one error
branch in `app/onboarding/page.tsx`. Optionally add a short low-level retry inside
`getManageableListings` for transient 5xx before giving up.

## Pre-pilot — Stellar landing (`/stellar`)

Must land before real retailers see the page. Both are known compromises in the initial
`/stellar` port (`app/stellar/`).

### Stellar-branded /privacy and /terms  [pre-pilot — blocks real retailers]
**Context:** the `/stellar` footer links the existing `/privacy` and `/terms` routes. A page
that immediately asks for Google `business.manage` consent must show privacy/terms that match
the Stellar brand and name the correct data controller.

**Smaller than first assessed (2026-07-27).** Both pages turn out to have *no* hardcoded
brand strings — they are already fully tenant-driven (`t.brandName`, `t.legalEntity`, and
three more fields). The real gap is one import each: they call `getTenant()`, which always
returns the primary tenant, rather than `getRequestTenant()`. On the Stellar host that
produces a mixed-brand page — Stellar chrome from the root layout wrapping a body that reads
"Chocka … is operated by Useful for Humans Ltd".

**Fix when picked up:** switch `app/privacy/page.tsx` and `app/terms/page.tsx` to
`getRequestTenant()`. Both pages are already server-rendered per request, so there is no
render-mode cost. Then re-read the prose as Stellar: the tenant fields interpolate correctly,
but claims written for a paid Chocka subscription (billing, Stripe customer ID, cancellation)
need checking against a service that is free to the retailer and funded by Tarkett.

### Swap `metadataBase` to the Stellar domain  [pre-pilot]
**Context:** `app/stellar/page.tsx` sets `metadataBase` to `NEXT_PUBLIC_APP_URL`
(app.chocka.co.uk) as a placeholder, so OG/canonical URLs resolve against the Chocka app
domain, not Stellar's.

**Why deferred:** the Stellar domain doesn't exist yet.

**Partly done (2026-07-27).** The OAuth half is closed: `b368c83` derives the redirect URI
per tenant, so Stellar retailers return to `app.stellarlocal.co.uk`. `metadataBase` is still
outstanding — `app/stellar/page.tsx` reads `NEXT_PUBLIC_APP_URL`, which holds Chocka's origin
on the shared deploy and cannot hold both.

**Fix when picked up:** derive `metadataBase` from the request tenant's `appUrl` rather than
the env var, the same way the callback route now does.

## Pre-pilot — Stellar tenancy

Surfaced while wiring host-based branding (`c7b1f42`). The seam resolves the brand per
request from the Host; these are the places that still resolve to the primary tenant, plus
the copy that assumes a paying Chocka customer. All were found on 2026-07-27.

### Cron and email still resolve to the primary tenant  [pre-pilot — blocks real retailers]
**Context:** `lib/email.ts` and the eight `/api/cron/*` routes call `getTenant()`, which is
not host-aware. A Stellar retailer therefore receives Chocka-branded email and SMS — Chocka
wordmark, Chocka colours, a `hello@chocka.co.uk` sender — while using a Stellar-branded app.

**Why it cannot be fixed by hostname:** cron is invoked by a scheduler, not a retailer's
browser, so the Host header is the same for every tenant's work. There is no request to
resolve from. This is the one gap host-based tenancy structurally cannot close.

**Fix when picked up:** add a `tenant_slug` column to the users table, backfill existing rows
to `chocka`, set it at signup from the request tenant, and have per-user work resolve the
tenant from the row via `getTenantBySlug()`. Ties in to the Resend sending-domain work —
a Stellar sender is only useful once the tenant is known at send time.

### Dashboard ROI renders `Infinity×` for a free tenant  [pre-pilot — blocks first dashboard]
**Context:** `app/dashboard/page.tsx:24` computes
`roi = estValue > 0 ? Math.round(estValue / tenant.priceMonthlyGbp) : 0`. Stellar's
`priceMonthlyGbp` is `0`, so any retailer with at least one call divides by zero and the tile
renders "Infinity× — return on £0/mo". Cosmetic, not a crash, but it appears exactly when a
retailer starts seeing results and goes looking.

**Not currently reachable:** needs the Stellar host live *and* a Stellar user with a bound
profile and calls > 0.

**Fix when picked up:** not a guard clamp — `0×` is equally meaningless. For a service that
is free to the retailer the honest metric is absolute, e.g. "£1,440 estimated value this
month", with the ratio dropped. Small copy + layout change.

### Chocka's proof claim renders under Stellar branding  [pre-pilot — blocks real retailers]
**Context:** `app/login/page.tsx:97` hardcodes "7,101 businesses scored across the
{proofLocation}". That figure is Chocka's North East dataset. Under Stellar branding, with
`proofLocation` set to "UK", it becomes a claim that is not true of Stellar and not true of
the UK.

**Fix when picked up:** either move the figure into tenant data so each brand states its own,
or drop the claim for Stellar and replace it with the Tarkett-network framing the live
holding site already uses.

### Price-0 copy sweep  [pre-pilot]
**Context:** several strings assume a paid plan and read oddly at £0:
`app/ref/[code]/page.tsx:33` ("£0/month · Cancel anytime"), `app/onboarding/page.tsx:552`,
`app/settings/page.tsx:78,113` (plan rows), and `app/admin/page.tsx:108` ("N active × £0/mo",
so Stellar revenue always totals zero in the admin view).

**Fix when picked up:** treat `priceMonthlyGbp === 0` as a distinct state — "Free, funded by
Tarkett" rather than "£0/month" — and exclude free tenants from revenue arithmetic.

### Reconcile `app/stellar/` with the tenant seam  [pre-pilot]
**Context:** `app/stellar/` (added 2026-07-15, `bce00fd`) is a standalone Stellar landing page
with its own Lato setup, palette and metadata, predating the tenant seam. It now overlaps
`STELLAR_BASE` in `lib/tenant.ts`, which is the single source of truth for Stellar's brand
and takes its colours from `stellar-site/styles.css`.

**Fix when picked up:** decide whether `/stellar` remains a distinct route or becomes the
Stellar-host home page, then have it read the tenant rather than carrying its own copy of the
palette. Do this before any further branding work so the brand is not defined twice.
