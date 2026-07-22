# Multi-tenancy plan

Make the app properly multi-tenant so **Stellar Local is a real tenant row**, resolved by
hostname, not a hardcoded `/stellar` page. This is a spec for review — no code yet.

Grounding facts (from the current code):

- **Hosting:** Next.js 14.1 App Router on Netlify (`@netlify/plugin-nextjs`). **No `middleware.ts` exists yet.**
- **DB:** Supabase, accessed *only* through `supabaseAdmin` (service-role key) in `lib/supabase.ts`.
  Every read/write **bypasses RLS**. There is no anon/JWT client anywhere. So today's isolation is
  **app-level filters only** — a forgotten `.eq('user_id', …)` leaks across accounts silently.
- **Schema lives only in the Supabase dashboard** — no `*.sql`, no `supabase/`, no generated types in-repo.
- **Session:** a trusted `chocka_user_id` cookie (raw `users.id` UUID, httpOnly, 30-day, unsigned).
  Resolution chain: cookie → `users.id` → `profiles.user_id` → `profiles.id` → posts/reviews/stats.
- **Tenancy today = 1.** The only existing tenant seams are `NEXT_PUBLIC_APP_URL` and `RESEND_FROM`
  (both env-driven). Everything else — brand name, palette, legal entity, emails, OAuth — is literal.
  Roughly **130–140 hardcoded brand spots across ~30 files**.
- **Stellar** is a fully self-contained one-off under `app/stellar/` (own palette scoped to `.stlr`,
  own icon, own metadata, Tarkett copy), whose Connect buttons point at the shared
  `/api/auth/callback/google`. It shares Chocka's OAuth client, DB rows, `/privacy`, `/terms`.

The guiding constraint throughout: **Chocka is live and must never break.** Every slice is
value-preserving — the Chocka tenant row carries the *exact* current literals, so early slices are
pure refactors with zero visible change.

---

## 1. The `tenants` table + hostname resolution (middleware)

### Table: `tenants`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text unique | stable internal key, e.g. `chocka`, `stellar` |
| `status` | text | `active` \| `disabled` — disabled hosts get a 404/holding page |
| `hostname` | text unique | primary host, e.g. `app.chocka.co.uk`, `get.stellarlocal.co.uk` |
| `hostname_aliases` | text[] | apex/www/preview/`*.netlify.app` hosts that resolve to this tenant |
| `app_url` | text | canonical base URL (replaces `NEXT_PUBLIC_APP_URL`) |
| `brand_name` | text | display wordmark, e.g. `Chocka`, `Stellar Local` |
| `legal_entity` | text | e.g. `Useful for Humans Ltd` |
| `palette` | jsonb | design tokens — see §3 for the exact key set |
| `fonts` | jsonb | `{ heading, body }` font-family stacks |
| `email_from` | text | replaces `RESEND_FROM`, e.g. `Stellar Local <hi@…>` |
| `support_email` | text | `team@…` / `hello@…` / `privacy@…` (or a small jsonb of these) |
| `sponsor` | jsonb null | white-label copy: `{ eyebrow, funded_by_line, vertical_noun }` (Stellar's "a brand by Tarkett", "Tarkett pays for it", "flooring shop") — null for Chocka |
| `price_label` | text | `£29/month` etc. (also drives referral credit) |
| `google_client_id` | text | per-tenant OAuth — see §5 |
| `google_client_secret` | text (secret) | per-tenant OAuth — see §5 |
| `google_redirect_uri` | text | per-tenant OAuth — see §5 |
| `created_at` | timestamptz | |

Secrets (`google_client_secret`) ideally live in a Vault/secret store keyed by slug rather than a
plaintext column; the table can hold a reference. Flagged, not blocking, for the first slices.

### Resolution: `middleware.ts` (new, at repo root)

1. Read the `Host` header on every request.
2. Look up the tenant by `hostname` / `hostname_aliases`. Because middleware runs on the edge and
   can't hold a service-role Supabase connection cheaply, back the lookup with a **cached tenant
   registry** (options, smallest-first): (a) a static `hostname → slug` map generated at build from
   the tenants table; (b) a cached fetch to a tiny internal `/api/_tenant?host=` route with
   `s-maxage`. Start with (a) — the host set changes rarely and a redeploy is acceptable.
3. Inject a resolved header — `x-tenant-slug` (and `x-tenant-id`) — onto the request so server
   components and route handlers read it via `headers()`, never the raw Host.
4. Unknown host → configurable: 404, or rewrite to a Chocka holding page. Never silently serve one
   tenant's data under another tenant's host.
5. A server helper `getTenant()` reads the header and loads the **full** tenant row (request-cached
   via React `cache()`), so the rest of the app depends on `getTenant()`, not on env or Host.

**Interim during early slices:** `getTenant()` returns a single hardcoded Chocka tenant object from a
config module (no DB, no middleware yet). This lets §3 theming land before the table exists.
`chocka.co.uk` and the Stellar host both resolve to Chocka until §6 gives Stellar its own row.

---

## 2. What needs `tenant_id`, and how existing data is migrated

### Add `tenant_id uuid not null references tenants(id)` to all 8 tables

`users`, `profiles`, `scheduled_posts`, `reviews`, `review_replies`, `sms_log`, `weekly_stats`,
`referrals`. (Child tables are already reachable via FK to `users`/`profiles`, but a direct
`tenant_id` on each is required for RLS policies in §4 and cheap tenant-scoped indexes.)

### Unique constraints that must become per-tenant

These are currently global and **will break or leak** with a second tenant:

- `users.email` (looked up globally at `auth/callback:37`) → **unique `(tenant_id, email)`**. The same
  shop owner must be a *distinct* user under each tenant they connect to.
- `users.referral_code` → **unique `(tenant_id, referral_code)`** (referrals are within a tenant).
- `reviews.google_review_id` (global unique; dedupe at `review-alerts:30`, upsert `onConflict` at
  `profile-fix:76`) → **unique `(tenant_id, google_review_id)`**.
- `weekly_stats(profile_id, week_start)` — already fine (`profile_id` is tenant-bound).

Leave **globally** unique (they belong to external systems): `stripe_subscription_id`,
`stripe_customer_id`.

### Migration (backfill, done as an expand → backfill → constrain sequence)

Because there is no in-repo schema, this becomes the **first committed SQL migration** (see §6 — we
should start a `supabase/migrations/` dir and treat the current dashboard schema as the baseline).

1. Create `tenants`; insert the **Chocka** row carrying today's exact literals (palette `#E8541A`
   etc., `Useful for Humans Ltd`, `Chocka <hello@chocka.co.uk>`, `app.chocka.co.uk`, current Google
   client).
2. Add `tenant_id` as **nullable** to all 8 tables.
3. Backfill: `users.tenant_id = <chocka>` for all rows; child tables inherit from their parent
   (`profiles` from `users`, `scheduled_posts`/`reviews`/`weekly_stats` from `profiles`,
   `review_replies` from `reviews`, `sms_log`/`referrals` from `users`).
4. Swap the unique constraints to the composite forms above.
5. Set `tenant_id NOT NULL` + add `(tenant_id, …)` indexes on hot query paths.

Every step is additive/backwards-compatible; Chocka keeps working with the column ignored until §3–4
start reading it.

---

## 3. Theming/branding becomes tenant-driven

Today branding lives in **four uncoordinated systems** — and the brand orange is literally
inconsistent across them (`#D4622B` in Tailwind/globals, `#E8541A` in inline UI + email, `#FF6B35`
in server-rendered route HTML). Consolidating onto one `tenant.palette` is also a bug fix.

**Mechanism:** `getTenant()` → root `app/layout.tsx` emits a `<style>:root{ --brand:…; --brand-dark:…; … }</style>`
(or sets the vars on `<body>`). Tailwind tokens and CSS switch to *reference* those vars, so every
utility class and every `var(--…)` becomes tenant-driven automatically. Client components that need
palette values in JS get them from a `TenantProvider` (server-passed), replacing the inline `V`
objects. Emails and server-rendered route HTML can't rely on CSS vars, so those templates take the
tenant palette as an argument and inline the hex at render time.

The `palette` jsonb key set (superset of what's used today): `brand`, `brandDark`, `brandLight`,
`cream/bg`, `warmBg`, `charcoal/ink`, `text`, `gold`, `green`, `red`, `grey/muted`, `star`, plus
`headingFont`/`bodyFont`.

### The spots that convert (grouped; ~130 literals across ~30 files)

1. **Tailwind tokens** — `tailwind.config.ts:7–14` (`brand`, `slate`, `cream`, `gold`, `charcoal`,
   `muted`, font) → reference CSS vars.
2. **Global CSS vars** — `app/globals.css:10–20` `:root` block → emitted per-tenant; move the three
   external font `@import`s to tenant-driven `next/font` (also closes the Google-Fonts-CDN gap the
   Stellar page already fixed).
3. **Inline `V` palette objects** (the `#E8541A` duplication) — `app/no-profile/page.tsx:3`,
   `app/settings/page.tsx:5`, `app/dashboard/page.tsx:5`, `app/admin/page.tsx:5`,
   `app/onboarding/page.tsx:6`, `app/login/page.tsx:5–14`, wordmark color at
   `app/dashboard/layout.tsx:19` → read from `TenantProvider`.
4. **Text wordmark "CHOCKA"** (no image logo exists — it's text everywhere) → `tenant.brand_name`.
   Notably the **9 copies** in `app/onboarding/page.tsx` (196, 264, 292, 324, 374, 503, 529, 563,
   590), plus `dashboard/layout.tsx:19`, `admin/page.tsx:53,91`, `no-profile:14`, `login:66`,
   `ref/[code]:20`, `privacy:4`, `terms:4`, `settings:111`, `lib/email.ts:38`.
5. **Root + route metadata** — `app/layout.tsx:5–6` title/description; server HTML `<title>` at
   `posts/cancel/route.ts:69` and `reviews/auto-reply/route.ts:100` → tenant-driven.
6. **Email templates** — `lib/email.ts`: `CHOCKA` header (38), footer `chocka.co.uk` (41), body copy
   (114), and every `#E8541A`/`#2D7A4F`/`#F0EDE8` → take `tenant` (palette + brand + domain +
   `email_from`). `sendEmail` already reads `RESEND_FROM` → switch to `tenant.email_from`.
7. **Server-rendered route HTML colors** — `#FF6B35` at `posts/cancel/route.ts:74`,
   `reviews/auto-reply/route.ts:105`, `cron/onboarding-sequence/route.ts:55` → tenant palette.
8. **Copy: sign-offs & legal & support** — "- Chocka" / "The Chocka team" across the cron + webhook
   routes (`posts/cancel:53`, `sms/webhook:62,80`, `post-publisher:60,80`, `monday-stats:63`,
   `onboarding-sequence:46,52,55,63,90`, `monthly-report:81`, `review-alerts:87,116`); legal entity
   in `privacy:11,52` / `terms:53`; support emails `privacy@ / hello@ / team@` (`privacy:47,52`,
   `terms:53`, `login:110,282`, `onboarding:252,259`) → `tenant.brand_name` / `legal_entity` /
   `support_email`.
9. **Domains & links** — the `|| 'https://app.chocka.co.uk'` fallbacks (`stellar/page:15`,
   `checkout:42`, `billing-portal:20`, `post-generator:69`, `monthly-report:80`, `review-alerts:108`),
   the literal `app.chocka.co.uk/settings` in `post-publisher:80`, referral links
   `chocka.co.uk/ref/…` (`dashboard/page:218`, `ReferralCard.tsx:12`), wordmark link `login:66` →
   `tenant.app_url`.
10. **Price** — `£29/month` (`layout:6`, `settings:76,111`, `onboarding:543`, `dashboard:64`,
    `ref/[code]:31`, `admin:106`) and referral credit `-2900` pence (`webhook:46,56`) →
    `tenant.price_label` + a derived pence value.
11. **Cookie / storage keys** — `chocka_user_id` (~15 route files) and sessionStorage `chocka_ref` /
    `chocka_fix_data` → generic names (`session_user_id`, `ref`, …) behind a helper. **Compat:** read
    old cookie name as fallback through one deploy so live Chocka sessions survive rename.
12. **Chocka-specific proof copy** — "North East" lines (`login:95,282`) → tenant copy or drop for
    non-Chocka.

Result: swapping a tenant row reskins the whole app. The Chocka row reproduces today's look exactly
(we standardize on one of the three oranges deliberately, as a visible-but-tiny cleanup).

---

## 4. Real data isolation (not just app-level filters)

App filters alone are not isolation — and today **every query uses the service-role key, which
bypasses RLS entirely.** The fix has two layers:

**Layer 1 — Postgres RLS as the backstop.** Enable RLS on all 8 tables with a policy
`USING (tenant_id = current_setting('app.tenant_id')::uuid)`. This makes cross-tenant reads
*impossible at the database*, so a forgotten app filter can't leak.

**Layer 2 — stop request paths from using the RLS-bypassing role.** RLS does nothing while we
connect as service-role. So introduce a **tenant-scoped DB path** for all user-facing routes:

- A `tenantClient(tenantId)` wrapper that runs queries as a **non-superuser Postgres role that does
  not bypass RLS**, setting `app.tenant_id` per request (via `set_config`/a transaction GUC, or a
  short-lived Supabase JWT carrying a `tenant_id` claim used with the anon-key client). Recommended:
  the GUC + restricted-role approach, since our session is a raw cookie, not a Supabase JWT.
- Route handlers resolve `tenantId` from `getTenant()` (the host), **cross-check** it against the
  `users.tenant_id` of the `chocka_user_id` cookie, and use `tenantClient` for all data.
- **Keep the app-level `.eq()` filters too** — defense in depth. RLS is the guarantee; filters are
  the fast path and the intent.

**Reserve service-role for genuinely cross-tenant work, each made tenant-aware:**

- **Cron** (`lib/cron.ts:18` + all 6 cron routes) legitimately scans many users. Scope each run/query
  by `tenant_id` (loop per tenant, or add `tenant_id` to `getActiveUsersWithProfiles`) so per-tenant
  sends, from-addresses, and copy are correct — not just so isolation holds.
- **Admin** (`admin/route.ts`, global scans at 18/24/29/34/40) → tenant-filtered, or an explicit
  cross-tenant super-admin view. Today it's password-only and global.
- **Stripe webhook** (`webhook:76,97`, by `stripe_subscription_id`) → derive tenant from the resolved
  `users.tenant_id` after lookup.
- **SMS webhook** (`sms/webhook:26,36`, by inbound phone) → resolve tenant from the **`To` (Twilio)
  number**, since each tenant has its own `TWILIO_PHONE_NUMBER`; then scope the user lookup to it.
  Prevents a phone number colliding across tenants.
- **Email action links** (`posts/cancel:26`, `reviews/auto-reply:28`, HMAC + row-id) → include/verify
  tenant in the signed payload; these bypass the cookie so they need their own tenant proof.

---

## 5. Per-tenant OAuth redirect handling

Today: one `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` (env), `getGoogleAuthUrl`/`exchangeCodeForTokens`
read env directly (`lib/google.ts:55–81`), the callback sets `chocka_user_id`, and Stellar's Connect
buttons hit the shared `/api/auth/callback/google` (`StellarLanding.tsx:162,170,226`).

**Why per-tenant, not just per-redirect:** the whole point of white-label is that the Google consent
screen shows **"Stellar Local"**, not "Chocka". That requires each tenant's own Google Cloud project /
OAuth consent screen → **its own client_id/secret and its own authorized redirect_uri.** Sharing one
client can't show tenant-branded consent. So the target is a **per-tenant OAuth client**, with creds
in the tenants table (§1).

**Design:**

1. `getGoogleAuthUrl(tenant, state)` and `exchangeCodeForTokens(tenant, code)` take the tenant and use
   `tenant.google_client_id/secret/redirect_uri` instead of env.
2. **`state` carries the tenant slug** (CSRF-signed) so the callback knows the tenant even before the
   cookie exists, and validates it against the resolving host.
3. The callback runs on the **tenant's own host** (its registered `redirect_uri`), so the session
   cookie is set on the right domain — no cross-domain cookie handoff needed. Generic cookie name
   (§3.11).
4. New users are stamped with `tenant_id` at insert (`auth/callback:113`); the auto-bind
   (`bindManageableListing`, `:175`) and the returning-user/reconnect paths all carry tenant.
5. Stellar's Connect buttons initiate the tenant-aware flow (with Stellar's client + state) instead of
   the raw shared callback.

**Interim fallback** (if a tenant isn't ready with its own Google project): one shared client with a
single canonical redirect host, tenant in `state`, and a one-time-token handoff to set the cookie back
on the tenant host. Uglier cookie story and un-branded consent — acceptable as a bridge, not the goal.

Also resolves two open FOLLOWUPS items: `metadataBase`→Stellar domain, and Stellar-branded
`/privacy` + `/terms` (become tenant-driven legal pages, §3.8).

---

## 6. Build order — smallest safe slice first

Each slice is independently shippable and leaves Chocka pixel-identical until the very end.

**Slice 0 — De-hardcode behind `getTenant()` (no DB, no middleware).**
Introduce a `getTenant()` helper returning a single hardcoded **Chocka** tenant object (all today's
literals). Add a `TenantProvider` for client components. Pure plumbing; nothing changes visually.
*Also start `supabase/migrations/` and capture the current dashboard schema as the baseline* so §2 has
somewhere to live.

**Slice 1 — Theming onto the tenant object (§3).**
Convert all four color systems, wordmarks, emails, route HTML, copy, domains, price, and cookie/storage
names to read from `getTenant()`/`TenantProvider`. Chocka object carries exact values → no visible
change (except deliberately unifying the three oranges). Big mechanical diff, zero behavior change.
Ship and verify Chocka thoroughly before touching the DB.

**Slice 2 — `tenants` table + middleware + Chocka row (§1).**
Add the table, insert Chocka, add `middleware.ts` resolving host→tenant header, point `getTenant()` at
the header + row instead of the hardcoded object. All Chocka hosts (and, for now, the Stellar host)
resolve to Chocka. Still one tenant of data.

**Slice 3 — `tenant_id` columns + backfill (§2), still nullable then NOT NULL.**
Add columns, backfill Chocka, make all writes stamp `tenant_id`, add tenant filters to reads (defense),
swap unique constraints to composite, flip NOT NULL. App still service-role; correctness unchanged for
the single tenant.

**Slice 4 — Real isolation: RLS + `tenantClient` (§4).**
Enable RLS, add the restricted role/GUC path, migrate request handlers off service-role, make cron and
the webhooks tenant-aware. This is the riskiest slice — RLS can silently break reads — so it lands
*after* everything else is stable, with the app filters still in place as a safety net.

**Slice 5 — Per-tenant OAuth (§5).**
Add creds columns, thread tenant through `getGoogleAuthUrl`/`exchangeCodeForTokens`/callback, tenant in
`state`, generic cookie. Chocka keeps its existing Google client (moved from env into its row).

**Slice 6 — Make Stellar a real tenant, retire the one-off.**
Insert the Stellar row (hostname, palette from `.stlr`, Tarkett `sponsor` copy, own Google client +
redirect_uri, own `email_from`, Stellar-branded `/privacy` + `/terms`). Point the Stellar host at it.
Replace `app/stellar/` — the hardcoded landing, `metadataBase`, scoped `.stlr` styles — with the normal
tenant-rendered pages (or keep `/stellar` as a redirect to the Stellar host). Delete the Tarkett/flooring
hardcoding; it now lives in the row.

*Also in slice 6 — trim the client-side tenant payload.* Observed on the slice-2 Deploy Preview: the
`TenantProvider` (slice 1) serialises the **whole** tenant object into the RSC flight payload, so the
rendered HTML ships `slug`, `brandName`, `wordmark`, `legalEntity`, `appHost`, `emailFrom`, `meta`, …
to the browser (~1.9KB over the pre-slice-1 page). Harmless with one tenant — it's Chocka's own config
on Chocka's own site — but once Stellar is real, **one tenant's config must not ship to another
tenant's users**, and the payload is only correct as long as it happens to match the requesting host.
Fix: split the tenant into a small client-safe subset (the visual/branding fields the client components
actually read) and a server-only remainder (`emailFrom`, OAuth/`google_client_*`, anything operational);
pass only the subset to `TenantProvider`. Worth an audit of `useTenant()` call sites at that point to
see which fields genuinely need to be client-side. Blocking for slice 6, not before.

*Also in slice 6 — settle the hostname→tenant map before host resolution goes live.* The domain setup
is currently untidy and the middleware's fallback hides it. Netlify has **`app.mapboost.co` as the
site's primary domain**, with `app.chocka.co.uk` serving as an alias; there are also
`mapboost-app.netlify.app` and the `deploy-preview-*--mapboost-app.netlify.app` preview hosts; and
Stellar's host is still to come. **None of the mapboost/netlify.app hosts appear in
`lib/tenant-registry.ts`'s `HOST_TO_SLUG`, nor in the seeded `tenants.hostname` /
`tenants.hostname_aliases`** — they all currently land on `resolveTenantSlug()`'s
`?? PRIMARY_TENANT_SLUG` fallback. With one tenant that is invisible and correct. Once `getTenant()`
actually reads `x-tenant-slug`, that same silent fallback means **any host we forgot to map resolves
to the primary tenant rather than failing** — i.e. a request on an unmapped or misconfigured host can
be served as the wrong tenant. Before slice 6 flips host resolution on, decide and write down
deliberately:
- which domain is canonical per tenant (and whether `app.mapboost.co` stays primary on Netlify, gets
  demoted, or is retired) — the Netlify primary and the app's notion of a tenant's `hostname` should
  not disagree;
- where preview/branch hosts (`deploy-preview-*`, `*.netlify.app`) and local hosts map to, given they
  are per-deploy and cannot be enumerated in a static map;
- what an **unknown** host does — 404 / holding page / explicit primary — replacing the silent
  `?? PRIMARY_TENANT_SLUG` fallback with a deliberate choice;
- that `HOST_TO_SLUG` and `tenants.hostname`/`hostname_aliases` agree, or better, that one is derived
  from the other rather than maintained twice.
Blocking for slice 6: getting this wrong is a cross-tenant mis-serve, not a cosmetic bug.

**Why this order:** branding (Slice 1) is the largest, safest change and unblocks visual verification
before any data risk. The table/middleware (2) and `tenant_id`/backfill (3) are additive and invisible
to one tenant. RLS (4) — the one slice that can break live reads — comes only once tenant scoping is
proven and app filters still backstop it. OAuth (5) and the Stellar cutover (6) are last because they're
the only slices that introduce a *second* real tenant, and by then every layer beneath them is
tenant-ready.

### Out of scope / incidental (flag, don't fix here)
- `users.onboarding_step` is written as both integers (cron) and the string `'complete'`
  (`profile-fix:95`, read at `callback:86`) — a pre-existing type inconsistency; note it, don't fix in
  this work.
- Moving `google_client_secret` into a proper secret store (vs. a plaintext column).
