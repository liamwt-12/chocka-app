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

**Import fixed (2026-07-27, `0f88441`).** Both pages now use `getRequestTenant()` and render
the correct brand, legal entity and contact addresses per host — verified live.

**Still outstanding:** the prose itself. It was written for a paid Chocka subscription and
still refers to billing, a Stripe customer ID and cancellation, none of which describe a
service that is free to the retailer and funded by Tarkett. Needs a read-through as Stellar.
Step 6 has to touch the privacy copy anyway (encryption-at-rest wording), so sweep it then.

### Swap `metadataBase` to the Stellar domain  [pre-pilot]
**Context:** `app/stellar/page.tsx` sets `metadataBase` to `NEXT_PUBLIC_APP_URL`
(app.chocka.co.uk) as a placeholder, so OG/canonical URLs resolve against the Chocka app
domain, not Stellar's.

**Why deferred:** the Stellar domain doesn't exist yet.

**Closed (2026-07-27), both halves.** The OAuth redirect URI is derived per tenant in
`b368c83`. The `metadataBase` half is moot: the only file that set it was
`app/stellar/page.tsx`, which was retired the same day. If a future page needs an absolute
metadata base, derive it from the request tenant's `appUrl` rather than `NEXT_PUBLIC_APP_URL`
— that env var holds Chocka's origin and cannot hold both.

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

### Salvage from the retired `/stellar` landing page  [reference — not a task]
`app/stellar/` was removed on 2026-07-27 (see the entry below). The route was retired
rather than reconciled: the Stellar host's entry point is `/login`, matching the real
retailer flow (invite → magic link → connect), and the pitch lives on stellarlocal.co.uk.
Recorded here in case any of it is useful for the marketing site or a rep-led demo page.
The full source is in git history at `bce00fd`.

**Copy worth reusing:**
- Headline: "Get found. Get the phone ringing. **Do nothing.**"
- Sub: "We look after your shop's presence on Google, so more local customers find you and
  call. It's free, because Tarkett pays for it." / "Takes two minutes. You stay in control."
- Framing: "Most people find a flooring shop **on Google now.**" ·
  "We run it all for you. **In your voice.**" · "Yours. **Always.**" ·
  "The better you look, **the more you win.**"
- Control trio: "You stay the owner." (manager, like a member of staff, removable in two
  taps) · "Undo anything, instantly." (every change logged and reversible) ·
  "No money, no spam, no lock-in."
- Close: "It's free because Tarkett pays for it. **You just get found.**" /
  "Two minutes. Your rep can do it with you."
- Tarkett sign-off: "Beauty in detail" · "A brand by Tarkett"

**Two things in there that are not recorded anywhere else:**
- An incentive mechanic — *"Improve most in a month, win Tarkett product credit."* If that
  is a real commitment it needs a home in the product, not just marketing copy.
- Rep-led onboarding — *"Your rep can do it with you"* — implies a rep-assisted connect
  flow that the app does not currently have.

**Design details:** an animated presence-score card (count-up + bar fill over 1.8s, cubic
ease, driven by IntersectionObserver and disabled under `prefers-reduced-motion`). Palette
tokens beyond those now in `STELLAR_BASE`: `--panel #F1EFE9` (adopted as `warmBg`),
`--gold-pale #FFDFA4`, `--gold-soft rgba(184,146,60,.12)`, `--mute #6E6E6E`,
`--faint #AEACA6`.

**Note:** `/stellar` returned 200 on both hosts until it was removed. If the URL was shared
with Tarkett it now 404s; a redirect to the Stellar host would be a one-line fix.

### Reconcile `app/stellar/` with the tenant seam  [DONE 2026-07-27 — retired]
**Context:** `app/stellar/` (added 2026-07-15, `bce00fd`) is a standalone Stellar landing page
with its own Lato setup, palette and metadata, predating the tenant seam. It now overlaps
`STELLAR_BASE` in `lib/tenant.ts`, which is the single source of truth for Stellar's brand
and takes its colours from `stellar-site/styles.css`.

**Resolved:** retired rather than reconciled. The Stellar host's entry point is `/login`
(`/` already 307s there), which matches the real retailer flow — invite link, magic link,
connect — not organic homepage traffic. The pitch belongs on stellarlocal.co.uk. Route and
component deleted; `STELLAR_BASE` in `lib/tenant.ts` is now the only definition of the
Stellar brand. Salvaged copy is in the entry above.
