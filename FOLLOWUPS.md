# Follow-ups

Deferred work captured so it isn't lost. Tie-in to the Stellar Local roadmap in brackets.

## P1

### RAISE WITH TARKETT: Stellar may not lawfully cold-email most of the 174 retailers  [P1 — business relationship decision, NOT an engineering task]

**This is a conversation to have with Zurida and Mikael, not a ticket to work around.** The
sending machinery is built and tested; it is held deliberately, and nothing has been sent.

**The legal position.** PECR regulation 22 splits recipients by subscriber type. **Corporate
subscribers** — limited companies, LLPs, Scottish partnerships, public bodies — can be sent
marketing email with no consent. **Individual subscribers** — which expressly *includes sole traders
and unincorporated partnerships* — require consent, or the "soft opt-in".

**The soft opt-in cannot apply to any of this list.** Regulation 22(3) requires all four of: details
obtained in the course of a sale or negotiations for a sale; marketing similar products to that
transaction; opt-out offered when the details were collected; opt-out in every message. These
addresses were scraped from Tarkett's **public store locator**. There was no sale and no negotiation,
so the first condition fails outright and the rest cannot rescue it.

So for every retailer on the list that is a sole trader or unincorporated partnership, **there is no
lawful route for Stellar Local to send this email at all** — not a wording problem, an absence of any
basis.

**Why it matters commercially:** flooring retailers skew heavily towards sole traders. Of 174 with a
contact address, only 19 carry `Ltd`/`Limited`/`LLP`/`PLC` in their trading name, and a name proves
nothing either way. A Companies House check was run to narrow this (see
`scripts/source-data/` results and the sending PR), but it yields a *signal*, not proof: a business
may trade under a name unlike its registered one, and a name match does not establish that the
address belongs to that company.

**The question for Tarkett:** Tarkett has an existing commercial relationship with its stockists.
That changes the analysis completely — first contact from Tarkett, to its own stockists, about a
service it is providing them, is a different act from a cold approach by a third party they have
never heard of. Options to put to them:

1. **Tarkett makes first contact** and Stellar follows up with those who respond. Cleanest.
2. **Tarkett obtains consent** as part of its existing stockist communications.
3. **Stellar emails only confirmed corporate bodies**, and the rest go via 1 or 2.
4. **Legal sign-off** that a different basis applies. Requires an actual solicitor, not our reading.

**Do not route around this.** The temptation is to send to the 19 confirmed companies and quietly
defer the rest; that is fine as far as it goes, but it leaves the bulk of the pilot cohort
uncontacted and the question unanswered. Tarkett's brand is on the email.

**Also outstanding regardless of the above:**

- **Regulation 23** applies to corporate and individual subscribers alike, solicited or not: a
  marketing email must not conceal the sender's identity and must carry a valid address for opt-out
  requests. The operating entity (`Useful for Humans Ltd`) is now named in the invite footer. A real
  token-based unsubscribe with a suppression table is being built.
- **UK GDPR Article 14.** 105 of the addresses have non-generic local parts and are therefore personal
  data about identifiable people. Because the data was not collected from those individuals, they must
  be told where it came from, at the latest at first contact — so the email needs a privacy-notice
  link naming Tarkett's public store locator as the source. Legitimate interests is arguable as the
  lawful basis but the balancing test has not been done.

**Not legal advice.** This is a careful reading of ICO guidance by an engineer. The sole-trader
exposure is material enough, with Tarkett's brand attached, to be worth real advice before sending.

**Related:** `scripts/send-invites.ts` (held), `lib/email.ts` `retailerInviteEmail` (draft copy),
[ICO — business-to-business marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/).

### Transient-enumeration → retryable error on OAuth connect  [CLOSED 2026-08-05]
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

**Done 2026-08-05, both halves — the retry as well as the error state.**

`BindResult` gains a fourth member, `connect_failed`, which `bindManageableListing` never
returns: it is what the two call sites record when it *throws*. That is the whole point of the
type widening. `no_profile` now means only "Google answered, and this account manages nothing",
and the two route to opposite places — one to a page about creating a Business Profile, the
other to a retry. Conflating them told retailers with perfectly good listings to go and make one.

Both `let result` declarations now **default to `connect_failed` rather than `no_profile`**, so a
throw before assignment also reads as "we could not ask" rather than "there is nothing there".

On the client, `?connect=failed` sets the error state and **returns before `runAudit()`**. That
matters: no profile is bound in this state, so running the audit would return `no_profile` and
render "No Google Business Profile found" — reintroducing the exact wrong message by a different
route. Its "Try Again" re-runs the **connect**, not the audit, for the same reason.

The optional half was worth taking: `fetchRetryingTransient` in `lib/google.ts` retries 429/5xx
and network-level throws on the two enumeration calls, twice, at 250ms and 750ms. 4xx is never
retried — it is a decision Google has already made and will make again, so retrying only makes
the user wait longer for the same answer. This *prevents* most occurrences rather than reporting
them more nicely; the error state is what remains for the ones that persist.

**Cost:** up to +1s on the failure path, which is on the signup critical path. The success path is
untouched, and there is a test that would hang rather than pass if that ever stopped being true.

**The all-or-nothing guarantee is preserved** — a persistent failure still throws rather than
returning a partial set, which is what stops a transient from auto-binding the wrong listing.
Tested explicitly. Five tests; three of them verified to fail when the retry is removed.

### `needsVerification` tests `=== 'review'`, so any other value reads as trustworthy  [CLOSED 2026-08-03 — predicate inverted]
**What it is.** `lib/retailer-score.ts` computes `needsVerification: retailer?.match_confidence === 'review'`.
That is an equality test, not `!== 'high'`. Every value that is not literally `'review'` — including
`'not_found'`, `null`, and anything a future import invents — resolves to **needsVerification: false**,
i.e. "this score is trustworthy, quote it".

**What that did.** The 8 `not_found` rows carry **score 0, band "Invisible"**. `send-invites.ts` gates
on `resolved.score !== null && !resolved.needsVerification`, and 0 is not null, so those 8 rows passed
the gate. Had sending been unblocked, **8 real businesses would have been cold-emailed to tell them
they scored 0 out of 100**, badged "Audited", with no qualification — including `Sams Carpet and
Flooring Ltd`, which has 4.9 stars, 275 reviews and genuinely scores 98. The guard that exists to
prevent exactly this did not cover the case, because it was written against the `review` bucket.

**Why it is not live today.** The 2026-08-03 apply moved every non-CONFIRMED row to `'review'`, so
there are now **zero** `not_found` rows and the trusted set has a minimum score of 44. The defect is
closed *by the data*, which is the weaker of the two ways to close it.

**Fixed same day.** Inverted to `match_confidence !== 'high'`, so trust is opt-in and the failure mode
is withholding a good score rather than publishing a wrong one. No existing test needed changing — the
three that covered this were already asserting the correct behaviour for `'review'` and `'high'`; the
gap was that nothing asserted anything about the OTHER values. Two tests added: one sweeping
`not_found`, `''`, `'HIGH'`, `null` and `undefined` to prove they all fail closed, and one pinning the
hard-zero case specifically, since `score === 0` is not null and so slipped past the upstream guard.

Note this is now belt and braces: the 2026-08-03 apply already left zero `not_found` rows. The point of
the code fix is that it no longer depends on the data staying that way.

## NEXT PRIORITY — a staging database

### There is nowhere to test a schema change before production  [NEXT — approach is an open question, do not build yet]

**Status, 2026-08-05: agreed as the next real priority, and deliberately NOT started.** Standing this
up is a more architectural piece of work than a backlog item, and the approach deserves thinking
about rather than firing off. **Awaiting a decision on the approach before any work begins.**

**What it blocks.** Three separate entries are currently stalled on exactly this, and each one names
it in its own words:

| Entry | Why it is stuck |
|---|---|
| `users.tenant_id` / `profiles.tenant_id` have no migration | The baseline cannot be written and verified against anything but production |
| `score_source` / `scored_at` on `profiles` | An `ALTER` on a live table carrying every connected user's profile |
| Split entitlement from billing status properly | Both candidate designs need a migration; deferred partly for this reason |

**It is also why the last migration went straight to prod.** `supabase/README.md` records that
`20260730120000` could not follow the repo's own rule — "run against a copy / staging database
first, never prod" — because `supabase db dump` and a local database both need Docker, which was not
available. It was applied to production after a `--dry-run`, on the grounds that it was purely
additive, with row counts checked before and after. That was a deliberate judgement call, taken
carefully, and it is not one that should have to be taken every time.

**So the real cost is not the three blocked items.** It is that the rule which exists to protect a
live database is currently unfollowable, so every schema change is either a judgement call or does
not happen. That is what makes this the priority rather than any one of the items it blocks.

**Options, unweighed — this is the decision to be made, not a recommendation:**

- **Docker locally** (`supabase start`). Closest to the documented workflow and what `db dump` /
  `db diff` expect. Requires Docker on the machine, which was the blocker last time.
- **A second Supabase project as a staging environment.** No Docker, and it is a real Postgres with
  the same extensions and quirks as production. Costs money, and needs a seeding story — production
  data cannot simply be copied into it, since it holds real retailer records and encrypted
  credentials whose AAD is bound to production row ids.
- **Something else** — a throwaway branch database, a Postgres container in CI only, or capturing
  the baseline schema from `information_schema` and testing migrations against a plain local
  Postgres without the Supabase stack.

**Whatever is chosen, one thing is already known and should carry into it:** this directory does not
reproduce production, so a staging environment built from `supabase/migrations/` alone would be
missing `users.tenant_id`, `profiles.tenant_id` and several whole tables. The baseline capture and
the staging environment are the same piece of work in practice — neither is finishable without the
other, and doing them in the wrong order produces a staging database that is confidently wrong.

## Deferred — entitlement and billing

### Split entitlement from billing status properly  [deferred — the clean version of the 2026-08-03 cron fix]
**What it is.** `users.subscription_status` is a **Stripe mirror** — the Stripe webhook
(`app/api/webhook/route.ts`) is the only writer of `'active'` anywhere in the repo. Every cron route
used it to answer a different question: *should we do automated work for this user?* Those coincided
only while every tenant was paid, and diverged silently the moment a free tenant existed.

**Fixed narrowly on 2026-08-03** with `isEntitledToAutomation()` in `lib/cron.ts`: a zero-price tenant
is entitled without ever being `'active'`. That is correct and tested, but it leaves one column
answering two questions, and the price it reads lives in `lib/tenant.ts` rather than the database — so
the predicate cannot be expressed in SQL and every caller must remember to filter in JS. There are two
such callers today (`getActiveUsersWithProfiles` and `onboarding-sequence`, which builds its own
query); a third that forgets is a silent repeat of the original bug.

**Fix when picked up:** give the question its own answer — an `entitled_at`/`automation_enabled`
concept on `users`, or a `price_monthly_gbp` column on `tenants` so the predicate becomes expressible
in SQL and can move back into the query. Prefer whichever makes the *default* safe: the failure that
actually happened was a filter silently excluding everyone, and it was invisible because excluding
users produces no error, no log and no user complaint until someone asks why nothing has posted.

**Worth a guard either way — DONE 2026-08-05, ahead of the schema decision.** A cron run that
processed **zero** users was indistinguishable from a healthy quiet day. `admitEntitled()` in
`lib/cron.ts` now filters *and* counts in one place: every route logs
`candidates=N admitted=M (chocka M/N, stellar M/N)`, and warns explicitly when it had candidates and
admitted none. Both query paths go through it — `getActiveUsersWithProfiles` and
`onboarding-sequence`'s own query — so the filter can no longer be taken without the log, which is
the practical answer to "a third caller that forgets is a silent repeat of the original bug".

The per-tenant breakdown is the load-bearing part: an aggregate of `admitted=8 candidates=9` reads
healthy in precisely the case where the 1 excluded is every retailer on the other brand.

**What this immediately revealed (production, 2026-08-05).** `getActiveUsersWithProfiles()` currently
admits **nobody at all**. Of 13 users, 12 are `token_status = 'offboarded'` (the 2026-07-28
offboarding) and so never reach the gate; the single remaining valid-token user is a **Chocka**
account with `subscription_status = null`, which the gate correctly excludes. The one Stellar
retailer — the tenant the entitlement fix was written for — is offboarded and therefore filtered out
in SQL before entitlement is ever consulted.

So every cron route is a no-op today. That may well be correct (nobody is paying, and the free-tenant
retailer has no live token), but it was not *knowable* before this guard, which is the entire point.
It also means the entitlement predicate is currently untested by production traffic: whatever replaces
it will land with no live signal either way.

**Zero-admitted is verified-intentional, not a fault (confirmed 2026-08-05).** Nobody is paying, so
excluding the one live Chocka account is the gate working. Recorded here so the next person to read a
`ZERO admitted` warning in the logs does not re-investigate it from scratch. The query:

```sql
select t.slug, u.token_status, u.subscription_status
from public.users u left join tenants t on t.id = u.tenant_id;
-- 11 chocka offboarded / 1 chocka valid (subscription_status null) / 1 stellar offboarded
```

**The schema half stays deferred — decided 2026-08-05, not merely unaddressed.** Neither
`users.automation_enabled`/`entitled_at` nor `tenants.price_monthly_gbp` is being built now:

- `tenants.price_monthly_gbp` would make the predicate SQL-expressible, but it puts price in two
  places — the table and `lib/tenant.ts` — and does not actually separate the two questions. It
  makes the existing compound predicate expressible, which is not the same thing.
- `users.automation_enabled` is the genuine split, but it needs writers on both the signup path and
  the **Stripe webhook**, and its column default is itself the "silently excluded everyone" failure
  mode this entry is about.

Both commit a production migration for a predicate that is currently correct, tested, and — since
`admitEntitled()` — observable. The condition for picking this back up is a *third* entitlement
caller appearing, or a second paid tenant; either makes the JS-side filter a real liability rather
than a tidiness complaint. Until then the cost of the migration exceeds the cost of the duplication.

### Stellar onboarding still routes through Stripe checkout  [CLOSED 2026-08-03 — Stripe is now unreachable for a free tenant]
**What it is.** `submitPhone` in `app/onboarding/page.tsx` POSTs to `/api/checkout` for every tenant.
For a free Stellar retailer that route will: create a real **Stripe customer** for them, request a
checkout session against `getPriceId(plan)` — a **Chocka** price id, since there is no Stellar price —
and build its success/cancel URLs from `getTenant().appUrl`, which is not request-aware and so returns
**Chocka's** origin.

**Why it has not blown up yet:** no Stellar retailer has ever reached this screen (0 Stellar profiles
have ever been bound). If the checkout call fails, `res.ok` is false and the flow falls through to
`setPhase('fixing')`, which happens to be the right outcome — so the flow may *appear* to work while
leaving a stray Stripe customer behind and depending on an error path to reach the correct state.

**Found 2026-08-03** while adding the automation opt-in to the same screen. Deliberately not fixed in
that commit: the opt-in persists before the checkout call, so it is unaffected either way, and this is
a separate defect that deserves its own change.

**Fixed, and wider than this entry framed it.** The business context is that there is **no
per-retailer billing for Stellar at all** — Tarkett is invoiced monthly against active user counts and
reconciled by hand. So this was never a copy problem: any reachable Stripe flow is wrong outright.

Gated in three places, entitlement resolved from `users.tenant_id` rather than the request Host,
because which brand a person belongs to is a property of their account — a Stellar retailer who opens
the Chocka host must not thereby become billable:

- **`/api/checkout`** refuses a zero-price tenant with `no_billing_for_tenant`, BEFORE the phone write
  and before `createCustomer`. Ordering matters: the old code created and persisted a Stripe customer
  even on runs where session creation later failed.
- **`/api/billing-portal`** refuses the same way, checked BEFORE `stripe_customer_id` — otherwise a
  retailer who had already acquired one from the ungated checkout could still open a portal.
- **Onboarding** no longer calls `/api/checkout` for a free tenant at all. Phone and automation choices
  now save in ONE request through the account PATCH, so a retailer cannot end up with opt-ins stored
  and their number lost. A failed save now blocks with an error instead of continuing silently — the
  number drives the Monday stats text, and losing it is invisible until it never arrives.

`phone_number` was added to that PATCH allowlist with server-side UK-mobile validation; it is the first
free-text field there, and an allowlist that waves strings through is not an allowlist. The booleans
beside it are now coerced rather than trusted.

**Verified against real production users on both tenants:** the Stellar user is refused on both routes
and the refused request writes **nothing** (phone still null, no Stripe customer); the Chocka user is
unaffected and falls through to the normal Stripe path. Zero Stellar users hold a `stripe_customer_id`.

**Return URLs — CLOSED 2026-08-05.** `app/api/checkout/route.ts` built its success/cancel URLs from
`getTenant()`, which always answers Chocka. Harmless while only the primary tenant could reach the
route, but wrong the moment a second PAID tenant exists: that tenant's retailer would pay and be
returned to a competitor's origin.

Both routes now build their return URL from the tenant they had **already resolved for the user** —
`getTenantForRow(user)`, which each one computes for its entitlement gate and then ignored. So this
is one line each, not new resolution machinery.

`app/api/billing-portal/route.ts` carried the identical defect and is fixed in the same change: the
two were gated together in the 2026-08-03 pass and build the same kind of URL, so fixing one alone
would leave the pair inconsistent.

**Account-derived, not Host-derived** — worth stating because "make it request-aware" is the obvious
reading and is the wrong one. The brand a person is *billed under* is a property of their account,
exactly as the entitlement gate argues. A Host-derived URL would return a retailer who happened to
open the other brand's host to that brand's app after paying for this one. Chocka is bit-for-bit
unchanged either way: `getTenantForRow()` on a Chocka user resolves to the primary tenant, whose
`appUrl` is the same `NEXT_PUBLIC_APP_URL` expression these lines already read, preview deploys and
local dev included.

`cancelPage()` in `app/api/posts/cancel/route.ts` was the remaining case of this class and is now
closed too — see "Error states" below. It is a rendered page rather than a return URL, so it resolves
from the Host rather than the user row.

### The liability clause is anchored to fees paid, and a free retailer pays none  [pre-pilot — needs a solicitor, not a rewrite]
**What it is.** `app/terms/page.tsx` limits liability to "the fees you have paid in the 12 months prior
to any claim". On a zero-price tenant that evaluates to **zero**, so the clause either caps liability
at nothing or is unenforceable — and which of those is true is a legal question, not an engineering one.

**Deliberately not rewritten in the 2026-08-03 copy sweep.** That pass corrected statements of *fact*
that were false for a free retailer — Stripe, billing, "no active plan", payment terms. Drafting a
liability limitation is a different act, and inventing one would be worse than leaving the current
text visible and flagged.

### `fundedBy` is not used by the onboarding opt-in card  [CLOSED 2026-08-03]
`STELLAR_BASE.fundedBy` (added by the copy sweep) is the single source for "who pays". The automation
opt-in card in `app/onboarding/page.tsx` said **"paid for by Tarkett"** as a literal, because
`fundedBy` did not exist on the branch where that card was written — an artefact of merge order, not
a decision. Substituted once both had landed on main. The funder's name now appears in exactly one
place in the codebase, and a free tenant with no `fundedBy` set degrades to a plain "It's free."
rather than naming someone else's sponsor.

## Pre-pilot — Stellar landing (`/stellar`)

Must land before real retailers see the page. Both are known compromises in the initial
`/stellar` port (`app/stellar/`).

### Stellar-branded /privacy and /terms  [PARTLY CLOSED — imports fixed; the prose is the open half]
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

### Swap `metadataBase` to the Stellar domain  [CLOSED 2026-07-27]
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

**`profiles.tenant_id` is never set on new rows.  [CLOSED 2026-08-05]** All 6 existing profiles
carried it, but neither insert site set it, so new profiles were null while their owning user row
was populated and the two columns drifted apart. Nothing reads `profiles.tenant_id` today — cron
resolves through `users.tenant_id` — so this was a data-integrity issue rather than a live fault,
but it would have quietly undermined any future per-tenant query or RLS policy written against
profiles.

Both insert sites now set it, from **the owning user row** rather than the request Host. That
differs from the "the listings route has request context" suggestion this entry originally carried,
and deliberately: a profile belongs to exactly one user, so its tenant is by definition that user's
tenant. Host-derived tagging would let a retailer who opened the other brand's host once bind a
profile tagged to a brand their own row does not belong to — the same silent cross-brand drift the
callback's `tenant_id` comment refuses to introduce for `users`. Reading the owner's row makes the
two columns agree by construction.

- `bindManageableListing()` takes the tenant id as a parameter: `newUser.tenant_id` on the
  create path, `existingUser.tenant_id` read back off the row on the returning-user path (the one
  place it was *not* already in hand).
- `app/api/listings/select` selects `tenant_id` on the user row it already fetches and applies it on
  the **update** path as well as the insert — a re-pick never changes whose account it is, so this
  repairs any row the old insert left null rather than re-tagging it.
- Both sites omit the column entirely when the user carries no tenant, so an untagged owner can
  never null out a profile that already has one, and Chocka's insert stays byte-identical.

Not covered by a test: this repo has no route-handler test harness (only `lib/*.test.ts`), and the
change is a value threaded into two writes with no extractable pure logic. Backfilling the null
profiles created between the column being added and this fix is a separate data task — none exist
yet, but that stops being true if any signup lands before this deploys.

**`cancelPage()` in `app/api/posts/cancel/route.ts` — CLOSED 2026-08-05.** Done together with
`/api/reviews/auto-reply`'s identical page, which had the same defect and the same early-return
constraint; see "Error states" below for the reasoning and what was shared. Resolved from the Host,
which is available on every path including the early returns, rather than `getRequestTenant()` —
route handlers in this repo read `x-tenant-slug` off the request directly, as the OAuth callback and
`/api/invite/accept` do, and that avoids pulling `next/headers` into a route handler.

### Dashboard ROI renders `Infinity×` for a free tenant  [CLOSED — verified in code 2026-08-05]
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

### Chocka's proof claim renders under Stellar branding  [CLOSED — verified in code 2026-08-05]
**Context:** `app/login/page.tsx:97` hardcodes "7,101 businesses scored across the
{proofLocation}". That figure is Chocka's North East dataset. Under Stellar branding, with
`proofLocation` set to "UK", it becomes a claim that is not true of Stellar and not true of
the UK.

**Fix when picked up:** either move the figure into tenant data so each brand states its own,
or drop the claim for Stellar and replace it with the Tarkett-network framing the live
holding site already uses.

### Price-0 copy sweep  [CLOSED — verified in code 2026-08-05]
**Context:** several strings assume a paid plan and read oddly at £0:
`app/ref/[code]/page.tsx:33` ("£0/month · Cancel anytime"), `app/onboarding/page.tsx:552`,
`app/settings/page.tsx:78,113` (plan rows), and `app/admin/page.tsx:108` ("N active × £0/mo",
so Stellar revenue always totals zero in the admin view).

**Fix when picked up:** treat `priceMonthlyGbp === 0` as a distinct state — "Free, funded by
Tarkett" rather than "£0/month" — and exclude free tenants from revenue arithmetic.

**Audit note, 2026-08-05.** These four entries were still labelled open long after the work landed —
found while surveying what was left to batch. Each was checked against the code before being
re-labelled, not taken on the strength of a commit message:

| Entry | Where it is actually handled |
|---|---|
| Dashboard ROI | `app/dashboard/page.tsx:51` — `showRoi` gates the tile on `priceMonthlyGbp > 0`, not a clamp |
| Proof claim | `app/login/page.tsx:91` renders `tenant.loginCopy.proofClaim`, and hides the element when null |
| Price-0 copy | `app/ref/[code]/page.tsx:34`, `app/settings/page.tsx:83`, `app/admin/page.tsx:112`, `app/onboarding/page.tsx:593` all branch on the zero-price tenant |
| `metadataBase` | Moot — the only file that set it was retired |

A backlog that says "open" when it means "done" costs more than one that is merely incomplete: it
makes every remaining entry untrustworthy until individually verified, which is exactly the work this
note exists to save the next reader.

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

## Error states

### The last bare "Something went wrong"  [CLOSED 2026-08-05]
**What it was.** `app/api/reviews/auto-reply/route.ts` caught every failure of the approve path in one
`catch` and rendered `Something went wrong` / "Try again or handle it on Google directly." It was the
last bare error screen in the app — `/api/audit` and the onboarding screens were given honest,
discriminated states earlier; this one was missed because it renders server-side HTML rather than
going through the React error paths.

The copy was wrong for two of the three failures behind it. "Try again" is useless advice when the
grant is dead (it will fail identically forever) and actively wasteful when the review has been
deleted (there is nothing left to reply to, on Google or anywhere else).

**Now five discriminated outcomes**, each saying what actually happened and what the retailer can do:

| Cause | Screen | Retryable? |
|---|---|---|
| No user / no stored credential behind the review | "This account isn't connected" | No — reconnect |
| `refreshAccessToken` fails (revoked or expired grant) | "Reconnect your Google account" | No — reconnect |
| Google 403 / `PERMISSION_DENIED` | "No permission to reply" | Yes, once access is restored |
| Google 404 / `NOT_FOUND` | "That review is gone" | No — nothing exists to reply to |
| 429 / 5xx / network / unexpected 400 | "Google didn't take the reply" | Yes — genuinely transient |

**Enabling change:** `replyToReview` in `lib/google.ts` threw a bare `Error`, so the caller had nothing
to discriminate on. It now throws `GbpError` like `getLocationFull`, carrying `status` and
`googleStatus`. The message is byte-identical to what it threw before (`Failed to reply: <text>`), so
`review-alerts` and `profile-fix`, which catch and log it, are unaffected — there is a test pinning
that. Five tests in total on the new mapping.

**Two things found while in there, and fixed alongside:**

- **The dead-grant path now records `token_status='invalid'`**, as `/api/audit` does, so the dashboard
  prompts a reconnect instead of the retailer discovering it again at the next review.
- **The two post-publish writes were unchecked.** `supabase-js` returns errors rather than throwing, so
  a failed status update left the reply `pending` *after it had already gone live on Google* — meaning
  it could be offered for approval and published a **second time**. Both writes are now checked. They
  deliberately do not change what the retailer sees: the reply IS live, so telling them it failed would
  be a lie. The status-update failure logs loudly as a double-publish risk needing a manual fix; the
  counter failure logs quietly, because an undercounted stat duplicates nothing.

**`resultPage()` / `cancelPage()` branding — CLOSED 2026-08-05, both together.** Both routes rendered
Chocka's wordmark and accent to every tenant, on links that arrive in Stellar-branded SMS.

Resolved from the **Host** (`getTenantBySlug(request.headers.get('x-tenant-slug'))`, the pattern the
OAuth callback and `/api/invite/accept` already use), not from the user row. Most exits on both routes
— invalid link, expired hash, post/review not found, already handled — render before any user row is
loaded, so a per-user resolution would brand some screens correctly and leave the rest Chocka. One
answer applied consistently beats two answers applied by accident.

Host is not a compromise here: both links are built by cron from `getTenantForRow(user).appUrl`, so
the origin a retailer lands on IS their own tenant's and the two resolutions agree by construction.

**The SMS in the cancel route still resolves from the user row, deliberately.** A text message is a
durable thing sent *to* the account holder and takes the account's brand; the page is transient chrome
for whoever is looking at the URL now. They diverge only if a link is opened on the wrong host, and
each is then still right about its own audience. Noted in the code so it does not read as an oversight.

**The two page functions were byte-identical** and are now one shared `lib/result-page.ts`, which also
makes the template testable for the first time — five cases pinning that it renders the tenant it is
given, that the accent follows the tenant, and that Chocka's output is unchanged.

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

**CLOSED 2026-08-05, as specified above — not encrypted.** Encryption was the wrong tool: the
envelope scheme defends against someone who can read the database, and a local gitignored file is
not reachable that way. Giving the harness `SECRET_ENCRYPTION_KEY` would have put the key and the
ciphertext in the same directory and bought nothing.

What landed in `scripts/live-matrix.ts`:

- **`0600` on write**, via `writeStore()`. `chmodSync` runs unconditionally after `writeFileSync`,
  because the `mode` option only applies when a file is *created* — a file that predates this change
  would otherwise keep its old permissions forever.
- **`readStore()` warns on a loose mode** and tightens it, rather than silently repairing. Tightening
  now does not undo who has already read it, and that is worth saying.
- **`live:run` revokes every token at Google and deletes the file when it finishes.** `--keep` opts
  out for iterating, with a warning; `npm run live:revoke` tears down on demand.
- **Revoke before delete.** Deleting alone leaves the *grant* standing in the test account with no
  token left to revoke it with and nothing that would ever clean it up. If a revoke fails the file is
  left in place, so the problem stays visible instead of the tokens being lost while still valid.
- **Teardown runs on NO-GO as well as GO** — a failed run leaves live credentials behind just as
  readily, and it is the run you are most likely to walk away from.

**The cost, stated plainly:** a full matrix run now needs one consent click per label, every time,
because the previous run revoked the grants. That is the trade the entry above asked for and it is
the right one, but it does make the harness meaningfully more tedious. `--keep` exists for the
iterating case.

**Related:** `SECRETS_AT_REST.md`, which scoped this file out and now records why it stayed out.

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

### The dashboard draws a fabricated score history  [CLOSED 2026-08-03 — bars removed]
`app/dashboard/page.tsx` renders an 8-bar sparkline from the literal array
`[20,30,35,45,55,65,72, <current score>]`. The first seven values are invented: every retailer, on
their first day, sees a chart showing their score climbing steadily from 20 to where it is now.

It was decorative when nobody had a real history to contradict it. It is a problem now for two
reasons: a Stellar retailer's first dashboard view is day one, so the chart depicts eight weeks of
improvement that did not happen; and the pre-launch baseline now renders on the same page, which
invites reading the fake bars as the journey from that baseline to the live score — precisely the
blended series the hard rule forbids.

**Removed, not relabelled or rebuilt.** A caption saying "illustrative" gets ignored while the shape
does the persuading, and one real `score_history` row is a dot rather than a trend — it would read as
broken. The tile is now a static score: label, badge, number, and the genuine "+N from setup" delta.

**"+N from setup" stays, and is not the same thing.** `audit_score` and `audit_score_after` are both
`lib/audit.scoreProfile` readings of the same connected profile, before and after the onboarding
fixes. Subtracting them is valid. It is batch-vs-live that cannot be subtracted, and that comparison
is not on this tile.

**Bring a chart back when there is more than one real point per retailer to draw.** `score_history` is
the record of truth and already accumulates one row per scoring event, so the data will arrive on its
own; the mistake was drawing the shape before it did.

**Related:** the same instinct produced "7,101 businesses scored across the UK" on the Stellar login,
removed on 2026-08-03.

### Badge UI  [CLOSED 2026-08-03 — built against the verified 180]
**Built.** `components/ScoreBadge.tsx` exports three pieces, all driven by `BADGE_LABEL` /
`BADGE_DESCRIPTION` in `lib/retailer-score` so copy cannot drift between surfaces:

- **`ScoreBadge`** — says which measurement a number is. `audited` and `connected` are styled to look
  like different things rather than two states of one thing, for the same reason they are never drawn
  as one series.
- **`SupersededScore`** — the only sanctioned way to show a batch score beside a live one: a separate
  sentence, explicitly stating the two are not comparable and that the difference is not a change.
  No arrow, no delta, no second point on a line.
- **`UnverifiedScoreNotice`** — shown instead of a number when `needsVerification` is true.

Rendered on the **dashboard** (badge on the score tile; superseded baseline in its own block; the
audited-only card for an invited retailer whose live audit has not run yet) and on the **invite page**
(badge with description under the score). `/api/dashboard` returns the linked `retailers` row raw, not
resolved — `resolveRetailerScore` stays the single place that decides precedence and trust.

**Verified against the real 180:** 147 render a score with the `audited` badge, 33 get the unverified
notice, and **0 zero-scores are shown**. Simulating the case nobody has seen yet — a retailer holding
both — the live score wins, the badge flips to `connected`, the batch band is dropped (different
vocabulary), the batch score reappears only as `supersededBatchScore`, and the resolved object carries
**no** delta, trend, change or diff field.

**Superseded — the original entry, kept for the reasoning**
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

## Hard rule — LIFTED 2026-07-30, with conditions

### The baseline is now quotable as "mean 75.3 across 169 verified of 177 distinct retailers"  [rule — superseded, conditions below]

**Lifted 2026-07-30** after the verification in `scripts/source-data/MATCH_VERIFICATION.md`. The rule
below is kept for the reasoning; these are the terms that replace it.

**What may be said externally:** mean **75.3**, median **81.0**, across **169 verified** retailers out
of **177 distinct** businesses. Band mix 52.1% Strong, 37.9% OK, 5.9% Needs work, 0.6% At risk, 3.6%
Invisible. Defensible band 72.3 – 75.3, so treat the mean as ±1.5.

**Four conditions, all mandatory:**

1. **Never say 180.** Three `place_id` duplicates mean it is **177 distinct businesses**. Both rows of
   each pair stay in the database for traceability, but no external figure says 180.
2. **Say 169 verified, and be able to explain the other 8** — 7 rows whose matched profile was proven
   to be a different business and whose true score is unknown, plus 1 permanently closed. They are
   excluded, not hidden. Zeroing them instead gives 72.3, which is the floor of the band.
3. **Never present this number next to an in-app score.** It is `publicAudit.scorePlace` — 3 public
   signals — and is not comparable to `lib/audit.scoreProfile` (14 signals, OAuth) or
   `refresh-scores.calculateChockaScore` (10 signals). Three incomparable scales; see
   `scripts/source-data/README.md`.
4. **Date-stamp it 2026-06-21**, the baseline generation date, and note that two of the 169 scores
   (`Sams Carpet and Flooring Ltd` 98, `Beccles Carpet Centre` 91) are 2026-07-30 re-scores after
   correcting false zeros. Immaterial at 2/169, but say "as at" if either is quoted alone.

**Known soft spot:** the 27 `review` rows judged "same business" were each confirmed from a single
Places Details lookup, not the deep candidate-list check the 9 suspects received. Probably right, not
checked to the same standard. Re-running all 169 would close both this and condition 4.

### Known limitation — verification coverage of the 169 is uneven, and 129 rows were never re-checked  [CLOSED 2026-08-03 — all 180 given the deep standard]

**Closed by `scripts/source-data/verify-all.py`.** Every one of the 180 rows now has a full
`searchText` candidate list judged by a fixed port of `classifyMatch` — the standard only 15 rows had.
Evidence in `verification-2026-08-03.json`; both the fixed and the original judgement are recorded per
candidate, so the delta is auditable rather than asserted.

**Result: 147 CONFIRMED, 33 needing a human.** The three numbers that matter:

- **5 of the 136 `high` rows did not confirm.** The 129-never-checked exposure was real but modest —
  which is the honest answer, and better than the worry implied. It is no longer unmeasured.
- **16 of the 36 `review` rows confirmed**, so their scores become showable. That is 16 retailers who
  would have received an invite with no number in it.
- **1 of the 8 hard zeros was wrong.** `Sams Carpet and Flooring Ltd` — 4.9★, 275 reviews, carried at
  **0** — matches `Sam's Carpets and Flooring` at 0.91 character similarity. Exactly defect 1.

**A new source-data defect, found by the proximity arm:** **37 rows** have a postcode that matches the
candidate while the row's own lat/lng sits more than 250m away, so those two fields disagree in the
source. It does not change any verdict here (the postcode is what the original matched on) but it means
proximity cannot be trusted as an independent arm for those rows, and it is worth fixing upstream.

**Resolved 2026-08-05 — and it is 34, not 37.** `scripts/source-data/resolve-coordinate-conflicts.py`
settles which of the two fields is at fault, per row. The **lat/lng** is, in 34 cases; the other 3 sit
just under the same 250m threshold and are threshold artefacts rather than defects. Evidence per row in
`coordinate-conflicts-2026-08-05.json`, with a corrected coordinate for each of the 34.

**What the fixed port changes, beyond the four recorded defects.** Token-set similarity alone was
rejecting obvious matches this list is full of — concatenation (`Lewis Carpets` / `Lewiscarpets
Canterbury`, jaccard 0.00) and typos (`Hudspeth Floooring` / `Hudspeth Flooring`). A character-level
arm on the despaced names catches both, with an 8-character floor that keeps defect 2 dead. First pass
without it flagged 61 rows; nearly half were the matcher's fault, not the data's.

**Still open:** the 33 flagged rows are a triage, not a verdict. Applying any of this to
`retailers.match_confidence` is step 2 and deliberately separate.

### Superseded — verification coverage of the 169 is uneven  [original entry, kept for the reasoning]
**What it is.** "169 verified" describes three different standards of evidence, not one:

| Standard | n | What was actually done |
|---|---:|---|
| **Deep** — full `searchText` candidate list | **15** | Alternatives to the matched profile were visible and compared. The 5 short-name `high` rows, the 2 retained suspects, and all 8 `NOT FOUND`. |
| **Light** — single Places Details lookup | **25** | The matched profile's name and address were read and judged, but a *better* match the original run might have missed would not have been visible. |
| **None** | **129** | `high` rows, trusted because both arms passed in the original run. Not re-fetched at all. |

The 25 is the surviving part of the 27 `review` rows judged "same business" — one was de-duplicated
out (`Northumbria Flooring & Furniture`, North Shields) and one is the closed business (`Winnens
1929 ltd`).

**The 129 is the larger exposure, and it is the one that was never named.** The earlier framing worried
about the 25; the 129 is five times bigger. It rests entirely on "both arms passed" being trustworthy
— and the defects logged under *Deferred — the batch matcher* show both arms can fail independently:
defect 3 hands jaccard 0.67 to any `Tees Valley X Ltd`, and defect 4 fires the postcode arm on any
neighbour sharing a business-park postcode. A row where *both* failed together would land in `high`
and would not have been looked at.

**Why it is nevertheless accepted.** Both arms agreeing is materially stronger than either alone, and
the one deliberate probe into that population — the 5 short-name `high` rows, chosen precisely
because they were the weakest names in it — came back **clean at jaccard 1.00 with exact postcode
hits**. That is real evidence, but it is 5 of 134, so it bounds nothing.

**Consequence for the stated confidence.** The band **72.3 – 75.3 (±1.5)** reflects the *treatment
choice* for the 7 unverifiable rows. It does **not** quantify verification risk in the 129 or the 25,
which is unmeasured. These are two different uncertainties and should not be conflated when the number
is defended.

**What would close it.** One pass of `searchText` over all 169 with the full candidate list — the same
standard the 15 got. Also removes the two-date inconsistency in condition 4 above. Worth doing before
any second baseline, or if Tarkett pushes on methodology; not required to stand behind 75.3 today.

**Honest framing if it comes up:** 75.3 rests on 169 matches — 15 verified to a deep standard, 25 to a
lighter one, and 129 inherited from the original run's both-arms-passed test. Nothing in the 154 is
known to be wrong, and none of it has been independently confirmed either.

### Superseded — no mean or average from the pre-launch baseline goes to Tarkett or anywhere external  [rule — until the review bucket is resolved]
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

### `classifyMatch` has four defects, two of which produce hard false zeros  [CLOSED — the port fixes all four; verified 2026-08-05]

**The port exists and all four are fixed in it.** `scripts/source-data/verify-all.py` carries the
corrected `classifyMatch`, and it is what re-verified all 180 rows on 2026-08-03; those verdicts were
applied to `retailers.match_confidence` in `caaf075`. Checked line by line rather than taken from the
script's own header: apostrophes stripped before tokenising (`:126`), single-character tokens dropped
from the token set (`:144`), a shared *distinctive* non-trade token now required (`:147`, `:196`), and
location evidence demoted to corroborating-only with a proximity arm (`location_evidence`).

`publicAudit.ts` itself is **deliberately still defective** — it is the archive of how the 2026-06-21
baseline was produced, and rewriting it would destroy the record of what actually generated those
scores. That is the point of "fix in a port, not in the archived file".

The defect write-ups below are kept in full: they are the reasoning behind the port, and they are what
anyone productising the batch scorer needs to read first.

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

## Deferred — retailer invite flow

### Live end-to-end tests must not use a real retailer row  [rule — set 2026-08-03 after reversing one]
**What happened.** The 2026-07-30 end-to-end proof of the invite engine was run against
`retailers.source_ref=29438` — **"A Wood Idea", Blaydon-on-Tyne**, a real business on Tarkett's list,
score 91, `high` confidence. It worked, which was the point. It also left that row claimed:
`retailers.user_id` set to the tester's account.

**Why that is worse than it sounds.** `linkInviteToUser` claims with `.is('user_id', null)`, so a
claimed row is *permanently unclaimable* by anyone else. Had this survived to the pilot, the real
A Wood Idea would have accepted their invite, hit the silent `retailer ... is already claimed by
another user` branch, and ended up with an account and no linked retailer — the exact failure the
`/login` entry below describes, arriving through the *correct* door and therefore much harder to
diagnose. It would have been found by a confused retailer, not by us.

**Reversed 2026-08-03.** Token revoked at Google — the endpoint answered `revoked`, **not** `already
invalid`, so by the same test recorded under the OAuth consent entry the credential was live for the
four days in between. Then nulled with `token_status='offboarded'`, `retailers.user_id` cleared, and
both invite rows for that retailer set to `revoked`. Verified after: retailer 29438 unclaimed with its
91 baseline intact, no retailer claimed anywhere in the table, no user holding a Google token except
`liam@wearecanny.uk`, and `sent_at` null on every row of `retailer_invites` — **nothing has ever been
emailed to anyone.**

**The rule from here.** Test the invite flow against a **seeded throwaway retailer row**, not a row
from Tarkett's 180. If a real row must be used, unclaim it in the same session — a claimed row is
invisible until the real business turns up, which is the worst possible moment to discover it. Note
the reversal script was deliberately **not committed**: it names a personal Gmail address and this
repo is public (see the public-repo decision above).

**Also worth knowing:** the invite marked `accepted` still held `user_id`, which alone would have made
any replay of that link bail out safely. It was revoked anyway, because left as `accepted` it counts
as a real retailer acceptance in any funnel query during the pilot.

### Let a no-invite arrival ask for one, instead of bouncing  [deferred — build once Tarkett's first-contact answer is known]
**What it is.** The gate below refuses cleanly, but it is still a dead end: a retailer who arrives
without an invite is told to email `team@stellarlocal.co.uk`, and whether they do is out of our hands.
The better behaviour is to capture them — business name and email into a request row — so a no-invite
arrival becomes a lead rather than a bounce.

**Why it is deliberately not built yet.** Which retailers arrive this way, and what they will have
been told before they do, depends entirely on how Tarkett answers the first-contact question above.
If **Tarkett makes first contact** (option 1), no-invite arrivals become the *main* flow and the
capture form is load-bearing — it needs to echo whatever wording Tarkett actually sent, or the
retailer thinks they are in the wrong place. If **Stellar emails the confirmed corporates** (option 3),
the invite link is the only door and this stays a rare fallback worth almost nothing. Building it now
means guessing which, and the guess is free to make later: the refusal branch in the callback is a
single `return`, and the panel is one conditional in `app/login/page.tsx`.

**Guardrail for whoever builds it:** a request row must not be a shortcut into `retailers.user_id`.
The whole point of the gate is that only a verified invite links a retailer, and a self-asserted
"I am Elvet Flooring" is not that. Queue for review, or mint a real invite and send it — do not link.

**Related:** `inviteAdmitsSignup` in `app/api/auth/callback/google/route.ts`, and the post-hoc linking
entry below, which is the other half of the same problem.

### The generic `/login` route is open on the Stellar host and produces an unlinked account  [CLOSED 2026-08-03 — gated]
**Closed by gating `/login` on the Stellar host.** Two changes, both tenant-scoped so Chocka is
untouched:

- **The real gate is server-side**, in `app/api/auth/callback/google/route.ts` (Step 3b). On the
  Stellar tenant, account *creation* now requires an invite ref that would actually link:
  `inviteAdmitsSignup()` mirrors `linkInviteToUser`'s preconditions exactly — signature verifies, the
  invite row exists, `accepted_at` is set, `user_id` is null, status is `pending`, and the retailer is
  itself unclaimed. Refusal redirects to `/login?error=invite_required` and writes nothing.
- **The panel in `app/login/page.tsx`** replaces the Connect button with "invite-only" on the Stellar
  host. This is a sign, not a lock — hiding a button does nothing for anyone hitting the callback URL
  directly, which is why the gate above exists.

**Three decisions inside it worth knowing:**

1. **It gates creation, not sign-in.** The check sits after the `existingUser` branch has returned, so
   a properly invited retailer coming back later through `/login` is unaffected. Gating sign-in too
   would lock out exactly the people the invite flow onboarded.
2. **The declined credential is revoked.** At the refusal point we hold a live Google refresh token
   for someone we have just turned away. It is never stored, so it is handed back to Google
   best-effort rather than left as a standing grant for an app that gave them nothing.
3. **`expires_at` is deliberately not checked.** Expiry is enforced at accept time; re-testing it here
   would reject a retailer whose invite lapsed during the seconds they spent on Google's consent
   screen, after they had already granted access. `linkInviteToUser` does not check it either, and the
   two must not diverge.

**Not covered by tests.** This repo has no API-route tests at all, and the gate lives inside the
callback's request flow. `npm test` (139 tests) and `next build` both pass, but the gate itself was
verified by reading, not by execution. Worth an integration test if route testing is ever set up.

**Original context, kept because the reasoning still applies to the entry above.** There were two ways
into Stellar Local, not one. The invite link
(`/invite/<token>`, delivered by email or handed over by a rep) is the intended route. But
`app.stellarlocal.co.uk/login` also carries a live "Connect Google — see your score" button, which
fires `/api/auth/callback/google?action=login&plan=…` with no token and no invite. It works: real
OAuth, real Stellar-branded account.

**Why that matters.** `linkInviteToUser` is the *only* code anywhere that sets `retailers.user_id`,
and it runs only when a signed invite ref arrives in the OAuth `state`. There is no fallback matching
— nothing reconciles a signup against `retailers` by email, `place_id` or business name. So the two
routes produce materially different things:

| Route | Result |
|---|---|
| `/invite/<token>` | account **+ retailer linked** + 2026-06-21 baseline score attached |
| `/login` | account only — `retailers.user_id` stays null, baseline score not connected |

The end state is a Stellar user and an unclaimed retailer row for the same business, with nothing
joining them. The baseline the whole 2026-07-30 verification exists to defend is simply not attached
to that retailer.

**How reachable is it today:** `stellarlocal.co.uk` is live but contains **no link to the app** — no
CTA, no "get started", no mention of invites. So the route is reachable only by someone who knows or
guesses the app hostname. Not advertised, but not gated either. It matters for the rep-in-person
case: a rep who hands over "stellarlocal.co.uk" rather than a minted invite link gets the retailer in
by the wrong door.

**Options when picked up:** gate `/login` on the Stellar host behind "you need an invite" with a
contact route; or leave it open and rely on post-hoc linking below; or leave it open deliberately for
self-serve retailers outside the Tarkett cohort, which is a positioning decision rather than a
technical one.

**Cheaper now than later.** Deciding this after fifty retailers have signed up by the wrong route
means reconciling fifty accounts by hand.

### Post-hoc linking, to rescue signups that arrive without an invite  [deferred — build eventually]
**What it is.** A mechanism to attach an already-created user to their unclaimed `retailers` row when
they did not come through an invite. Without it, any such signup is stranded: they have an account,
we have their baseline score, and nothing connects the two.

**Two candidate keys, both imperfect:**

- **`place_id`** — the strongest signal, because it identifies the actual Google listing rather than a
  name. Blocked on `profiles.google_place_id` being populated at bind time, which is its own deferred
  decision above. 8 of 180 retailers have no `place_id` at all, so it can never be the only key.
- **`contact_email`** vs the signup's Google account email — cheap, and works when a retailer signs up
  with the same address Tarkett holds. Weak on its own: 71 of the addresses are role accounts
  (`info@`, `sales@`) which one person may hold across several businesses, and 4 retailers have no
  address at all.

**Guardrails it will need:** the same `.is('user_id', null)` conditional claim the invite path uses, so
a match cannot steal a retailer already linked; and the partial unique index on `retailers.user_id`
already stops one user holding two retailers. A wrong automatic link is worse than no link — it
attaches someone else's score and history to a real business — so anything below high confidence
should queue for review rather than write.

**Related:** `app/api/auth/callback/google/route.ts` (`linkInviteToUser`), and the
`profiles.google_place_id` decision above, which unblocks the better of the two keys.

### Store `profiles.google_place_id` at bind time  [CLOSED 2026-08-03 — and it cost nothing]
**Done, but not by either option this entry proposed.** Both assumed the price was an extra
`findPlaceId` Places call on a path every signup takes, which is why it was deferred. There was a third
way: `getLocations` was requesting a readMask of `name,title,storefrontAddress,latlng,categories` and
simply **not asking for `metadata`** — which carries `mapsUri`, which carries the place id. Adding one
word to that mask yields the id on a call every signup already makes.

**So the cost is zero extra requests and zero new failure modes on the signup path.** No `findPlaceId`
fallback was added at bind time deliberately: that would put a new network dependency on the critical
path to buy a marginal number of extra ids. The dashboard's existing fallback still fills in later for
anything Google returns no mapsUri for.

Both insert sites now set it — `bindManageableListing` in the OAuth callback and
`app/api/listings/select`, the latter overwriting on a re-pick, since the point of re-picking is that
the previous listing was the wrong business. `placeIdFromMapsUri` is exported from `lib/google.ts` and
uses the identical expression the dashboard has always used, so the two cannot disagree about what a
place id is. Four tests, including that it returns `undefined` rather than `''` — those write NULL and
a resolved-but-empty id respectively, and the second would compare equal to nothing.

**`warnOnProfileMismatch` is now a real check.** Where both sides know a place id it compares
identities and returns, instead of guessing from name tokens and a town substring. It falls back to the
old test when either side lacks one — 8 of the 180 retailers have no place id at all, so this stays a
best-effort signal and never a gate.

**Still outstanding, and now the cheaper half of the same question:** whether to import lat/lng onto
`retailers` from `retailers-locations.csv` for a distance check as a second signal.

**The blocker on it is cleared (2026-08-05).** The 37 rows whose postcode and lat/lng disagreed have
been resolved: `scripts/source-data/resolve-coordinate-conflicts.py` establishes that the **lat/lng is
the field at fault in 34 of them**, and supplies a corrected coordinate for each. The other 3 sit just
under the 250m threshold and are artefacts of where Google places its pin, not source defects. Full
evidence in `coordinate-conflicts-2026-08-05.json`; method and worked example in
`scripts/source-data/README.md`.

Two points that matter if the import is picked up:

- **The corrections come from postcodes.io, not from the matched Google business.** Deriving them from
  the match would make proximity a tautology — it would then confirm every match forever, including the
  wrong ones. The postcode route keeps Google out of the input, which is the only thing that makes
  proximity worth having as a second arm.
- **Nothing has been applied.** `retailers-locations.csv` is untouched and `retailers` still has no
  coordinate columns. The import would need to overlay the 34 corrections from the artefact, or it will
  import the same broken coordinates — one of which (`29849` Carpet Creations) is **306km out, in the
  sea off Kintyre**, while its name, street and postcode all match its Google profile exactly.

**Also still outstanding — `profiles.tenant_id` is never set on new rows.** Deliberately not folded in
here: `bindManageableListing` does not currently receive the tenant, so fixing it means threading a new
argument through both of its call sites, which is a different change from adding a column that was
already in hand. Same two insert sites though, so do them together when picked up.

### Superseded — the original framing of the place_id decision  [kept for the reasoning]
**Context:** `warnOnProfileMismatch` in `app/api/auth/callback/google/route.ts` exists to catch the
case where a retailer accepts one invite and connects a different business — they open Elvet's invite
and connect their own unrelated profile. The check it can actually perform is weak: it compares name
tokens and town, because those are the only overlapping fields that exist.

The check it *should* perform — does the connected profile's `place_id` match `retailers.place_id` — is
not possible **at bind time**. `bindManageableListing` (same file) writes `google_account_id`,
`google_location_name`, `business_name`, `category`, `address`, `latitude` and `longitude`, but not
`google_place_id`. And `retailers` carries no coordinates — the lat/lng stayed in
`scripts/source-data/retailers-locations.csv` and was never imported — so a geographic comparison is
not available either.

**The capability already exists elsewhere, which is the useful part.**
`app/api/dashboard/route.ts:69-76` resolves a place id two ways — a regex over
`location.metadata.mapsUri`, falling back to `findPlaceId(business_name, address)` from
`lib/google.ts:383` — and caches the result onto `profiles.google_place_id`. So nothing new has to be
invented; the resolution is written and working.

What limits it is *when* it runs: that block is inside the dashboard's `revList.length === 0` fallback,
so it only fires for profiles whose reviews did not come back from the Business Profile API. Verified
2026-07-30: **1 of 6 production profiles has `google_place_id` set** (`Twenty First Century Herbs`),
which is consistent with it being a conditional fallback rather than a standard part of onboarding.

**Two ways to pick this up, and they differ in cost:**

1. **Resolve at bind time** — call `findPlaceId` inside `bindManageableListing`. Gives a real mismatch
   check at exactly the moment the invite flow wants one. Costs one extra Places call per signup, on a
   path **every** signup takes, Chocka and Stellar alike. That blast radius is why it was not folded
   into the invite commit.
2. **Defer the check** — leave binding alone and re-run the mismatch comparison whenever
   `google_place_id` later becomes known. No new cost, but the warning arrives after the retailer has
   already onboarded, which may be too late to be worth much.

If (1) turns out to need more than one call, or `findPlaceId` proves unreliable on retailer-style
names, the name/town check may simply be the right permanent answer — in which case close this and
record that.

**Also worth deciding at the same time:** whether to import lat/lng onto `retailers` from
`retailers-locations.csv`. It would give a distance check as a second signal, and 180 rows already have
coordinates sitting in the repo unused.

**Related:** `app/api/auth/callback/google/route.ts` (`warnOnProfileMismatch`, and the comment there
saying the same thing), `scripts/source-data/retailers-locations.csv`.

## Deferred — schema drift

### `users.tenant_id` and `profiles.tenant_id` exist in production with no migration  [latent risk — partly resolved 2026-07-30]
**Update 2026-07-30 — the drift was wider than recorded, and the tracking half of it is now fixed.**
`retailers` and `score_history` were also live in production with 180 rows each while their migration
existed only on an unmerged branch, and the remote migration history table was **completely empty** —
all four local migrations showed a blank `Remote` column. So `supabase db push` would have attempted
every migration rather than the newest.

Repaired with `supabase migration repair --status applied` for the three already-live versions, after
which a `--dry-run` confirmed only `20260730120000` was pending. History now matches reality and
`db push` is trustworthy. See `supabase/README.md` → "Migration history was repaired".

**What is still outstanding:** the *schema* drift itself. `users.tenant_id` and `profiles.tenant_id`
remain uncaptured by any migration, so this directory still does not reproduce production and a fresh
environment will lack those columns. The repair fixed the bookkeeping, not the missing baseline.
Writing that baseline is the remaining task.


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
