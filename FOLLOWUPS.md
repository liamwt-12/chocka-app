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

**Largely closed (2026-07-29).** Done via the `users.tenant_id` column that already existed
rather than the `tenant_slug` column originally proposed here — adding one would have put two
tenancy columns side by side. `getTenantForRow()` resolves the tenant from a row fetched with
`tenants ( slug )` embedded, and all six cron routes plus `app/api/posts/cancel` now resolve
per user inside the loop instead of once per run. `lib/email.ts` takes an optional tenant
throughout.

**Also outstanding — `profiles.tenant_id` is never set on new rows.** All 6 existing profiles carry
it, but neither insert site sets it: `app/api/auth/callback/google/route.ts:235` and
`app/api/listings/select/route.ts:79`. New profiles will therefore be null while their owning user
row is populated, so the two columns drift apart. Nothing reads `profiles.tenant_id` today — cron
resolves through `users.tenant_id` — so this is a data-integrity issue rather than a live fault,
but it will quietly undermine any future per-tenant query or RLS policy written against profiles.
Fix both insert sites together; the callback already has the tenant id in hand, and the listings
route has request context.

**Still outstanding — `cancelPage()` in `app/api/posts/cancel/route.ts`.** The HTML page rendered
after a cancel still calls `getTenant()`, so its title and accent colour are Chocka's on every
host. Unlike the SMS beside it, this one *does* have request context and should use
`getRequestTenant()` — but note the early-return paths (missing params, bad hash, post not found)
render the page before any user row is loaded, so a per-user resolution is not available there.
Same class as the `/privacy` and `/terms` fix above. Small, and only visible after a retailer
clicks cancel.

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

## Deferred — OAuth consent screen is single-brand

### A second brand needs a second GCP project  [not urgent — no live Chocka users]
**Context:** consent-screen branding is configured per **project**, not per OAuth client or
redirect URI, and project `map-boost-app` (number 1086354059037, console display name still
"Chocka") holds exactly one client — "Chocka Web", created 19 Feb 2026 — serving both
`app.chocka.co.uk` and `app.stellarlocal.co.uk`. One client cannot show two brand names.

Following the appeal accepted 24 Jul 2026, that single branding config now reads: app name
**"Stellar Local"**, Stellar gold-star logo, home/privacy/terms all pointing at
`stellarlocal.co.uk`, authorized domains `chocka.co.uk` + `mapboost.co` + `stellarlocal.co.uk`,
support and developer contact `liam@wearecanny.uk`. Verified and live. Publishing status is
In production, user type External.

**Why deferred:** Chocka offboarding completed **2026-07-28**, via
`scripts/offboard-legacy-users.ts --commit` — 11 users revoked at Google and cleared in the DB,
0 errors; `liam@wearecanny.uk` deliberately excluded and still connected. No Chocka user
remains to see the wrong name on the consent screen. The mismatch is real but now unobserved,
and reverting is not free — the branding is in a *verified* state, so changing it back would
mean another verification cycle and would simply move the problem onto Stellar.

**Timeline correction.** An earlier manual offboarding pass (~24 Jul) was believed complete, but
**it never wrote to the database**: on 28 Jul all 12 rows still held a non-null
`google_refresh_token` with `token_status='valid'` and no `token_invalid_at`. Google then
answered `revoked` — not `already invalid` — for 10 of the 11, so those refresh tokens were
still live, and the `/api/cron/*` jobs still held working credentials against 10 people's
Business Profiles for those four days. Worth remembering: **offboarding is only done when the
`users` rows say so.** `token_status` is our own column and reflects what we last wrote, not
Google's opinion — verify at the DB, and treat a Google `revoke` response of `revoked` (rather
than `already invalid`) as proof the credential was live until that moment.

**Fix when picked up** — needed if Chocka is ever revived, or when a second brand launches:
stand up a second GCP project with its own OAuth client and its own verified branding, one per
brand, and store `google_client_id` / `google_client_secret` per tenant as
`MULTI_TENANCY_PLAN.md` slice 5 describes. The app side is partly there already — the redirect
URI is derived per tenant in `b368c83`. The cost is that a new project needs its own
`business.manage` verification, which is presumably why one shared client existed in the first
place. Budget for that lead time rather than discovering it at launch.

**Note for whoever picks this up:** only *new* connects and re-consents ever see the consent
screen — already-connected users are not re-prompted. So the blast radius of a wrong brand name
is future signups, and it grows quietly rather than breaking anything visibly.

## Deferred — secrets hygiene

### `.gbp-tokens.json` stores harness refresh tokens in plaintext  [deferred — local-only, lower stakes]
**Context:** `scripts/live-matrix.ts` captures a real Google refresh token per throwaway test
account and writes them to `.gbp-tokens.json` at the repo root
(`{ "<label>": { refresh_token, scope, capturedAt } }`, written at `live-matrix.ts:93`). These
are live credentials for real Google Business Profiles — the same class of secret that
`SECRETS_AT_REST.md` exists to protect in the database.

**Why deferred (2026-07-28):** stakes are materially lower than the DB case. The file is
gitignored (`.gitignore:8`), never leaves the machine, is not in any backup or dump, and is not
reachable through a leaked service-role key — which is the specific threat the at-rest work
addresses. It also does not exist on this machine at present, so there is nothing currently
exposed.

**Fix when picked up:** the cheapest correct fix is not to encrypt the file but to stop it being
a standing artefact — `chmod 600` on write, and have `live:run` revoke and delete the captured
tokens at the end of a matrix run so they exist only for the duration. If they must persist,
reuse `lib/secrets.ts` and the same `v1.` envelope rather than inventing a second scheme, and
note the harness would then need `SECRET_ENCRYPTION_KEY` locally.

**Related:** `SECRETS_AT_REST.md`, which explicitly scopes this file out.

### Decide deliberately whether `chocka-app` should be a public repo  [deferred — decision, not a task]
**Context:** `github.com/liamwt-12/chocka-app` is **public** (`visibility: public` from the GitHub
API, unauthenticated). Discovered 2026-07-30 while deciding whether to commit retailer contact
details. It was probably never a deliberate choice — quite likely a GitHub default that was never
revisited — and it had not been factored into earlier "safe to commit?" judgements, which were made
against an implicit private-repo standard. Nothing personal or secret is currently exposed:
`scored.csv`, `.score-checkpoint.json` and `publicAudit.ts` were each re-checked on 2026-07-30 and
carry no email, phone or credential, and `.env*` / `.gbp-tokens.json` are gitignored.

**Why this needs a real decision rather than a reflex:** public changes the standard every future
commit is judged against, and it changes it silently — the cost of a mistake is not a bad commit but
a permanent disclosure that requires history rewrite, force-push, and treating the data as leaked.
Things to weigh: whether the code is intended as a portfolio/reference artefact; that a public repo
plus per-tenant customer data in Supabase is a combination worth thinking about explicitly; that
`SECRETS_AT_REST.md`, `MULTI_TENANCY_PLAN.md` and this file describe the architecture, threat model
and known weaknesses of a live product in some detail; and, on the other side, that flipping to
private removes the backup-visibility and any incidental credibility benefit.

**Not urgent because:** nothing sensitive is exposed today, and the immediate trigger (the retailer
contacts) was resolved on its own terms — see `scripts/source-data/README.md`.

**When picked up:** decide the posture first, then re-audit against whichever standard is chosen.
If it stays public, add the "this repo is public" test to the habit for new files. If it goes
private, note that history is already public and treat anything already pushed as disclosed
regardless.

**Related:** `scripts/source-data/README.md` (the public-repo test, and the retailer contacts
decision that surfaced this).

## Deferred — Stellar retailer baseline

Both deliberately left out of the 2026-07-29 import day, for stated reasons rather than time.

### Badge UI — no page exists to build it against  [deferred — build on real data]
**Context:** `lib/retailer-score.ts` resolves which score to display and which badge to show
(`audited` for batch, `connected` for live), with `BADGE_LABEL` / `BADGE_DESCRIPTION` copy and 14
tests. Nothing renders it. There is no retailer-facing page anywhere in this repo — `retailers` is a
brand-new table and the app's existing pages are all for connected users looking at their own
profile.

**Why deferred:** building a page before the data exists means designing against 180 imagined rows.
The interesting cases are concrete and only visible once imported — the 8 zero-score `Invisible`
retailers, the 36 `review`-confidence rows that need qualifying, the three duplicate pairs that will
appear as two near-identical entries, and eventually the first retailer holding both a batch and a
live score at once. A layout that handles those honestly is easier to get right in front of them
than from a description.

**Fix when picked up:** build against the imported data. `resolveRetailerScore()` already returns
everything a component needs — `score`, `band`, `source`, `badge`, `scoredAt`, `supersededBatchScore`,
`needsVerification`. Note it deliberately exposes **no** delta or trend field, and a test asserts
those stay absent: batch and live are different measurements and must not be drawn as one series.
`supersededBatchScore` is there so a caller can say "previously audited at N" as a separate,
differently-labelled statement — not as movement.

### `score_source` / `scored_at` on `profiles`  [deferred — ALTER on a live table]
**Context:** the day's scope said add `score_source` and `scored_at` to "whatever holds scores".
That was done for the new `retailers` and `score_history` tables. It was **not** done for
`profiles.audit_score` / `audit_score_after`, which is where the live score lives.

**Why deferred:** it is an `ALTER TABLE` on a live production table carrying every connected user's
profile, which deserves to be a deliberate act rather than a side effect of an import day. Nothing
currently needs it: `resolveRetailerScore()` takes the live score as an argument, so precedence works
off a join without either column existing. The only thing lost meanwhile is knowing *when* a live
audit ran — `profiles.updated_at` is a poor proxy, since any profile write moves it.

**Fix when picked up:** `alter table public.profiles add column if not exists score_source text`,
same for `scored_at timestamptz`, written as a proper migration — and note this table is already
part of the known drift below, so capture its real current definition from `information_schema`
first rather than assuming. Backfill `score_source='live'` where `audit_score` is not null. Use the
same column names as `retailers` so the precedence query reads the same against both.

## Hard rule — the scored.csv baseline is not quotable yet

### No mean or average from the pre-launch baseline goes to Tarkett or anywhere external  [rule — until the review bucket is resolved]
**Set 2026-07-29, deliberately, before the import.** The 180-row `scored.csv` baseline (generated
2026-06-21) may be imported, stored, displayed per-retailer, and used as score-history row one. What
it may **not** do is produce an aggregate — mean, average, "X% are Strong", band breakdown — that is
quoted to Tarkett, put in a deck, or used in any external communication, until the match-confidence
problems below are resolved.

**Why:** `match_confidence` reads like a quality gradient but is really "how many of two crude tests
passed" — name similarity, and whether the retailer's postcode appears in the candidate's address
(`classifyMatch` in `lib/publicAudit.ts`). Two specific defects make the aggregate untrustworthy:

- **36 rows are `review`** — exactly one arm matched, and *which* arm is not recorded anywhere (not
  in `scored.csv`, not in `.score-checkpoint.json`). "Name matched, postcode didn't" is usually the
  right business at a moved address. "Postcode matched, name didn't" may be a *completely different
  business* at the same postcode, scored and filed under a Tarkett retailer. These are indistinguishable
  without re-fetching each candidate's name and address (~36 Places Details calls).
- **Five three-letter names sit in the `high` bucket** — `AMA`, `JSR`, `MS`, `RMD`, `EBR`, all of which
  normalise to three characters once the trade words are stripped. The name normaliser removes
  `flooring|floors|carpet(s)`, which on a flooring-retailer list deletes most of the distinguishing
  signal. A three-character token plus a postcode hit is weak evidence, and unlike the `review` rows
  nothing flags it — these count at full weight.

**Also known:** 8 rows are `NOT FOUND` and carry a hard 0, pulling the mean from 76.9 (found only) to
73.5 (all). Of those, only `Elvet Flooring Solutions` has a demonstrable data defect — it is the one
row of 180 with no postcode in source, so `postcodeMatches` returns false unconditionally and one of
the two arms is structurally dead. The others appear to be genuine absences from Google. An earlier
reading blamed the `Floooring` typo in `Thompsons Floooring`; that was wrong — `Hudspeth Floooring`
carries the identical typo and scored 68 at `high`, because `classifyMatch` also passes when one
normalised name *contains* the other.

**Lifting the rule requires:** re-verifying the 36 `review` rows (record which arm matched), and
spot-checking the five short-name `high` rows. Then the aggregate can be recomputed and quoted.

**Both were done 2026-07-30 — and the rule still stands.** Full record in
`scripts/source-data/MATCH_VERIFICATION.md`, raw evidence in
`scripts/source-data/match-verification-2026-07-30.json`. Summary:

- **The five short names are clean.** All five matched an *exact* candidate name (jaccard 1.00), not
  the substring fallback, with a full postcode hit and the right town. They count at full weight.
  The worry was justified in principle — `ms` would falsely pass against `Image Flooring Chelmsford`
  — but it did not fire.
- **The 36 split 18 `NAME_ONLY` / 18 `POSTCODE_ONLY`, and 9 of them are probably the wrong
  business.** Worst: `Floor Store U.K` (91, 114 reviews) is scoring `Floor Giants Swansea`;
  `Amtico Flooring Installations` (81, 87 reviews) is scoring `Balham Flooring Studio`;
  `Floortek Supplies` matched `Grange Farm Industrial Est`, which is not a business.
- **The name arm is not safe either.** `Tees Valley Flooring` → `Tees Valley Joinery Ltd` passed on
  jaccard 0.67, i.e. as a *strong* match, because stripping the trade words leaves shared place-name
  tokens. The earlier framing treated `POSTCODE_ONLY` as the dangerous arm; both are.
- **New defect — an empty normalised candidate name matches everything.** `publicAudit.ts:221` guards
  `na` but not `nb`, so `na.includes('')` is always true. `The Carpet Company` strips to `''` and
  matched `The Flooring and Carpet shop`. `nameSimilarity` guards this at `:193`; `classifyMatch`
  does not.
- **Three source-postcode defects.** `29891` Elvet blank → **DH1 5QU** (three sources agree; not
  PAF-verified at house-number level, and Tarkett's own page has no postcode either). `29658`
  `CA1 25N` is **not a valid postcode** → `CA1 2SN`, which is exactly the candidate's address, making
  that row a *false* `review`. `29705` `NE24 5 SU` is valid but sits in Blyth, Northumberland,
  contradicting the row's own town of North Shields. Corrections are recorded, **not applied** to
  `retailers-locations.csv`.
- **One row is a closed business.** `Winnens 1929 ltd` matches the right company, but
  `businessStatus: CLOSED_PERMANENTLY`.

**So the blocker changed shape.** It is no longer a missing verification; it is a decision about how
to treat 9 suspect rows, the 8 hard zeros and 1 closed business. Treatments span **73.5 – 77.4**:
73.5 all-180 as imported, 73.8 less the suspects, 76.9 less the zeros, 77.4 less both. The suspects
barely move the mean (+0.3) because they sit near it — the damage is to *per-retailer* credibility,
which no aggregate treatment fixes. The 8 zeros are what move the number, and Elvet is a known false
negative among them.

## Deferred — the batch matcher (`scripts/source-data/publicAudit.ts`)

Found 2026-07-30 while verifying the baseline. **Recorded, deliberately not fixed.** `publicAudit.ts`
is archived byte-identical to the original as the record of how the 2026-06-21 baseline was produced
(see `scripts/source-data/README.md`) — editing it in place would destroy that. These fixes belong in
a **port**, if and when the batch scorer is productised. Full evidence:
`scripts/source-data/MATCH_VERIFICATION.md`.

### `classifyMatch` has four defects, two of which produce hard false zeros  [deferred — fix in a port, not in the archived file]

All four live in `classifyMatch` / `normaliseName` (`publicAudit.ts:176-227`). Ordered by damage done.

**Defect 1 — an apostrophe destroys name similarity, and can produce a hard 0.** `normaliseName`
maps `[^a-z0-9]+` to a space, so a possessive splits into a stem plus a singleton `s` that never
intersects the unpossessed form:

```
row       'Sams Carpet and Flooring Ltd' -> 'sams and'     tokens {sams, and}
candidate "Sam's Carpets and Flooring"   -> 'sam s and'     tokens {sam, s, and}
intersection {and}   union {and, s, sam, sams}   jaccard 0.25   (needs 0.60)
```

This is the worst single defect found. `Sams Carpet and Flooring Ltd` (id `29932`) is at
*Unit 5 James Watt Place, East Kilbride G74 5HQ*; the real profile is *Sam's Carpets and Flooring,
5 James Watt Pl, East Kilbride G74 5HG* — **same street, same unit number**. The postcode arm also
failed, on the single character `Q` vs `G`. Both arms down, so the row took `NOT FOUND` and a hard
**0** — for a business with **4.9★ and 275 reviews** that re-scores to **98 (Strong)**. Three other
possessive names on the list (`Ashley Cooke's …` ×2, `Steve's Carpets`) only escaped because their
candidates carried the apostrophe too and tokenised identically.
*Fix:* strip apostrophes before splitting (`replace(/['’]/g, '')` ahead of the `[^a-z0-9]+` pass), and
do not let a single-character token count toward the union. Consider a fuzzy postcode compare, or
fall back to the row's lat/lng when the postcode is one edit away.

**Defect 2 — an empty normalised candidate name matches everything.** `nameStrong` at `:221` guards
`na` (`na.length > 0`) but never `nb`:

```
row       'The Flooring and Carpet shop' -> na = 'and shop'
candidate 'The Carpet Company'           -> nb = ''        (every token is in the strip-list)
na.includes(nb) === 'and shop'.includes('') === true       -> nameStrong
```

`nameSimilarity` *is* guarded against this — `:193` returns 0 on an empty token set — so the two
halves of the same test disagree. On a flooring list any candidate named purely from the strip-list
(`The Carpet Company`, `Carpets Ltd`, `The Flooring Co`) normalises to empty and matches every row it
is offered. Hit 1 of the 41 rows re-checked.
*Fix:* require `nb.length > 0` in the same clause, i.e. `na && nb && (nb.includes(na) || na.includes(nb))`.

**Defect 3 — the trade-word strip-list deletes the distinguishing signal on this list.** `:180`
removes `flooring|floors|carpets?` — on a list of *flooring retailers* that is most of the name, and
what remains is often a shared place name:

```
'Tees Valley Flooring'  -> 'tees valley'
'Tees Valley Joinery Ltd' -> 'tees valley joinery'
jaccard 0.67  -> passes as a STRONG name match, against a joinery
```

Note this passed the jaccard arm, not the substring fallback — so the "strong" path is not safe
either. It also collapses distinct businesses to identical strings: `Trinity Carpets` (Cannock),
`Trinity Carpets` (Tipton) and `Trinity Flooring` (Kent) all normalise to `trinity`.
*Fix:* do not strip trade words for the *similarity* computation; strip them only to decide which
tokens are low-weight. TF-IDF or IDF-style weighting over the 180-name corpus would be a better fit
than a fixed strip-list — or require agreement on at least one non-strip-list token.

**Defect 4 — the postcode arm is near-worthless on shared business-park postcodes.** `postcodeMatches`
(`:201-205`) asks only whether the row's postcode appears in the candidate's address. On an
industrial estate many unrelated businesses share one postcode, so the arm fires on a neighbour:

- `SA7 9AH` (Swansea Enterprise Park) holds at least **two** flooring businesses — `Floor Giants
  Swansea` (119 reviews) and `Budget Carpet & Flooring Centres ltd` (207 reviews). Row
  `Floor Store U.K` was matched to the first at **jaccard 0.17**, scored 91, and is in neither.
- `TS2 1RP` is shared by two rows *within the list itself* — `Tees Valley Flooring` and
  `Wilkinsons Flooring`.

*Fix:* treat a postcode hit as corroborating rather than sufficient — require some name signal too,
or compare distance from the row's lat/lng, which the source data already carries and which
`findPlace` already passes as a `locationBias` but never uses to verify.

### Source-data defects behind three of the bad rows  [deferred — data, not code]

Recorded but **not applied** to `retailers-locations.csv`, which stays byte-identical to source apart
from the two scrubbed email cells.

| id | Row | In source | Should be | Note |
|---|---|---|---|---|
| `29891` | Elvet Flooring Solutions | *(blank)* | `DH1 5QU` | Absent, not a typo. Three sources agree; house number 8 inferred, not PAF-verified. Tarkett's own store page has no postcode either, so the gap is upstream. |
| `29658` | Home Carpets by Neil Mcbrearty | `CA1 25N` | `CA1 2SN` | Digit `5` typed for letter `S`. `CA1 25N` is **not a valid postcode**. `CA1 2SN` is exactly the candidate's address, so this row is a *false* `review`. |
| `29705` | Northumbria Flooring & Furniture (North Shields) | `NE24 5 SU` | *(needs a decision)* | Valid, but `NE24` is **Blyth, Northumberland**, not North Shields. There is a **separate Blyth row** of the same name scoring 93 — the postcode looks copied from the wrong branch. |

### The 180 rows are 177 distinct businesses  [deferred — affects any count quoted to Tarkett]

Three pairs share a `place_id`, i.e. the same Google profile was scored twice, and each pair's score
is double-weighted in any aggregate:

| place_id | Rows | Score |
|---|---|---|
| `ChIJMd9zKcqbfkgR-7IbH2_YIMU` | `Burts Carpets of Darlington` + `Burts of Darlington` (both DL1 1LA) | 85 |
| `ChIJRT9AZcKTfkgRys-1ZE2lij0` | `Flooring Developments` + `Flooring Developments LTD` (both DL1 4PH) | 68 |
| `ChIJoUuuF3FvfkgR7-3O3kaADvY` | `Northumbria Flooring` + `Northumbria Flooring & Furniture` (both North Shields) | 63 |

De-duplicating does not move the mean (73.5 either way, since each pair scores identically) but it
does change the **count**. "We audited 180 retailers" is wrong; it is 177 distinct businesses, and
one of those is permanently closed.

## Deferred — schema drift

### `users.tenant_id` and `profiles.tenant_id` exist in production with no migration  [latent risk — not blocking]
**Context:** found 2026-07-29 while planning per-user tenant resolution. Production has
`users.tenant_id uuid` and `profiles.tenant_id uuid`, both fully populated (12/12 users and 6/6
profiles pointing at the Chocka tenant `e4802656-…`). Neither column appears in any file under
`supabase/migrations/` — the only migration there is `20260720000000_create_tenants.sql`, which
creates the `tenants` table and nothing else. The columns were applied out-of-band, presumably
through the Supabase SQL editor.

**Why this matters:** `supabase/migrations/` no longer reproduces production. Anyone provisioning
a fresh environment — a staging project, a local Supabase, a restore-and-replay — gets a schema
without `tenant_id`, and every query written against it fails. The drift is silent: nothing warns
you, and the production database works fine, so it will be discovered at the worst moment.

**Why deferred:** production is correct and consistent right now. This is a reproducibility risk,
not a live fault, and closing it is mechanical rather than urgent.

**Fix when picked up:** write the missing migration to match what production already has —
`alter table public.users add column if not exists tenant_id uuid references public.tenants(id)`,
same for `profiles`, plus whatever index/FK/default production actually carries. Confirm the real
definition first rather than assuming: read it from `information_schema.columns` and
`pg_constraint` against the live DB, don't infer it from the column name. `if not exists` keeps it
a no-op against production while making a fresh environment correct. Then audit for any *other*
out-of-band change by diffing a migrations-only schema against production — this is unlikely to be
the only one.

**Related:** the per-user tenant resolution work depends on `tenant_id`, so this drift is load-bearing
for a feature, not just tidiness.

## Deferred — email/DNS infrastructure

### `getmarra.com` publishes two DMARC records, so it has no DMARC policy  [deferred — unrelated domain]
**Context:** found 2026-07-29 while setting up the Stellar Local sending domain. `_dmarc.getmarra.com`
returns **two** TXT records:

```
"v=DMARC1; p=none; rua=mailto:hello@getmarra.com"
"v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;"
```

Per RFC 7489 §6.6.3, a resolver that finds more than one DMARC record for a domain treats the
domain as having **no DMARC record at all**. So getmarra.com currently has neither the `p=none`
monitoring nor the `p=quarantine` enforcement it appears to have, and the `rua` address collects
nothing. The second record is GoDaddy's default; the first was presumably added on top of it
rather than replacing it.

**Why deferred:** getmarra.com is a different product and nothing in this repo sends as it. No
impact on Chocka or Stellar Local.

**Fix when picked up:** delete one record — keep the one whose `rua` you actually monitor
(`hello@getmarra.com`), drop GoDaddy's. Verify with `dig +short TXT _dmarc.getmarra.com | grep -c
v=DMARC1` returning exactly `1`. Decide `p=` deliberately at the same time: `none` gives reports
without enforcement, `quarantine` enforces.

**Generalisable lesson:** GoDaddy ships a default DMARC record on its domains. Adding your own
without deleting theirs silently disables DMARC rather than tightening it. `stellarlocal.co.uk`
and `chocka.co.uk` were both checked on 2026-07-29 and have exactly one record each.
