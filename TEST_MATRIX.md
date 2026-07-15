# Live Google test matrix — non-owner / multi-location fix

This proves the P0 fix against **real** Google Business Profile (GBP) accounts. The
mocked suite (`lib/google.test.ts`, run with `npm test`) proves the code logic given
assumed API shapes; **this matrix proves those shapes match reality.** Run it against
throwaway accounts **before any Tarkett retailer connects.**

## Why this can't be fully automated
Cases below require creating Google accounts, granting owner/manager/group roles on
real GBP listings, and completing interactive OAuth consent — all human actions on
Google's side. There are no shortcuts; budget time for GBP verification lead times.

But the **backend decision logic** for every case *can* be checked automatically once you've
done the one-time consent — see the harness below. What still needs a human is only the
consent click and a single pass through the UI to confirm the screens are wired to those
decisions.

---

## Semi-automated harness (`scripts/live-matrix.ts`)

You do the one manual step Google blocks (the consent click) once per account; the harness
captures the refresh token and runs the matrix assertions against the **real GBP API** by
calling `getManageableListings` and a faithful replica of the audit path directly.

**Covers automatically (library level):** all of cases 1–8, including the three gating
ones — 2 (manager returns exactly the managed listing + audit ok), 4 (group listing
enumerated + audits, no 403), 8 (a denied listing maps to `listing_access_denied`, plus a
synthetic 403/404→code check that always runs).

**Does NOT cover (needs a human in the browser):** the OAuth consent click; the UI/routing
glue (that len-1 redirects to onboarding, len>1 renders the picker and its buttons work,
len-0 shows `/no-profile`, the error screen copy + "Choose a Different Listing" navigation,
Settings → "Change listing" R1/R2); and case 5's "no `profiles` row" DB side-effect. Run
those from the tables below.

**Setup (one-time):**
1. Add this loopback redirect URI to the OAuth client in the Google Cloud console:
   `http://localhost:53682/oauth2callback` (override port with `OAUTH_LOOPBACK_PORT`).
2. Provide `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (shell export or a gitignored `.env`).

**Run:**
```
npm run live:connect -- manager    # consent as each account, once. Labels:
npm run live:connect -- group      #   owner | manager | manager-multi | group |
npm run live:connect -- denied     #   empty | revoked | mixed | denied
npm run live:run                   # runs all assertions for connected labels
```
`live:run` prints a PASS/FAIL/INCONCLUSIVE table and a logic-level GO/NO-GO on the three
gating cases. Captured tokens live in `.gbp-tokens.json` (gitignored — treat as secrets).

> Case 8's *setup* (an account with account-level manage role but no per-location rights on
> a listing it can still enumerate) is the hard one to reproduce. If you can't produce it,
> the harness says INCONCLUSIVE for the real case but still proves the 403/404→code mapping
> via the synthetic check; the UI recovery ("Choose a Different Listing") then needs the
> manual pass.

---

## Prerequisites

- A deployed (or `next dev`) instance with working Google OAuth env vars
  (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `business.manage` scope on the consent screen).
- Access to the Supabase `users` / `profiles` tables (to inspect rows and reset between runs).
- Three throwaway Google accounts:
  - **Account O (Owner)** — owns one GBP listing directly (personal account).
  - **Account M (Manager)** — its *own* personal Google account has **no** listings;
    added as a **manager** on one of O's listings.
  - **Account G (Group-manager)** — manager of a **location group / business group**
    that contains one or more listings.

> Unverified listings still appear via the API to owners/managers, so full postcard
> verification isn't strictly required to exercise the flow — but do spot-check behaviour
> on at least one verified listing.

### Reset between runs
Delete the test user's `profiles` row **and** `users` row in Supabase, and clear the
`chocka_user_id` cookie (or use a fresh incognito window). Re-connecting then re-triggers
onboarding from scratch.

---

## The matrix

| # | Account / setup | Steps | Expected result (PASS) |
|---|---|---|---|
| **1** | **O** — owner, one listing | Connect Google from `/login` | No picker. Straight to onboarding "Analysing…" → score. `profiles` row bound to the owned `google_location_name`. |
| **2** | **M** — manager of one listing; own personal account empty | Connect Google | **No picker, no "No profile found", no "Something went wrong."** Auto-selects the *managed* listing (not the empty personal account). Onboarding proceeds. This is the exact bug — it must pass. |
| **3** | **M or G** — manager of **several** listings | Connect Google | Picker appears: **"Which listing is yours?"** lists every managed listing with name + address + account. Pick one → onboarding proceeds for that listing only. |
| **4** | **G** — location-group manager | Connect Google | The grouped listing is found (auto-selected if it's the only manageable one, else in the picker). Audit completes — **no 403 → "Something went wrong."** |
| **5** | Fresh Google account, **no** listings anywhere | Connect Google | Lands on `/no-profile` ("No Google Business Profile found"). **No crash.** Verify in Supabase: a `users` row exists but **no `profiles` row** was created. |
| **6** | Any connected account, then **revoke** access | At [myaccount.google.com/permissions](https://myaccount.google.com/permissions) remove the app, then reload the dashboard / re-run the audit | Error screen reads **"Reconnect your Google"** (code `google_disconnected`), **not** "Something went wrong." |
| **7** | Account that is **owner of one** + **manager of a group** | Connect Google | Picker lists **both** the owned and the managed listings. Picking either binds and audits correctly. |
| **8** | **M** — role-manageable account, but bound to a listing they lack **per-location** rights on (residual denial) | Connect; if auto-bound to the denied listing, let the audit run | Onboarding shows **"Listing access problem"** with a **"Choose a Different Listing"** button → returns to the picker. **No crash.** |

---

## Also verify — the "change listing" repair path (Settings)

| # | Setup | Steps | Expected result (PASS) |
|---|---|---|---|
| **R1** | Any user with a bound profile | Settings → Google Connection → **"Change listing"** | Opens the picker (`/onboarding?select=1&return=settings`). Pick a different listing → binds it, a fresh audit runs, returns to the dashboard showing the new listing. |
| **R2** | A profile **mis-bound by the old bug** (wrong `google_location_name`) | Settings → **"Change listing"** → pick the correct listing | Profile re-binds to the correct listing; `audit_score` repopulates for it. Confirms existing broken shops can self-repair. |

---

## Recording results
For each row note: PASS / FAIL, the screen actually shown, and (for 2, 4, 5, 8) the
`profiles` row state in Supabase. Any FAIL on **case 2, 4, or 8** blocks pilot onboarding —
those are the non-owner paths the fix exists to close.

---

## Go / No-Go sheet

Fill in one line per case. **Cases 2, 4, 8 are GATING** — any FAIL there is a **No-Go**
for pilot. Fill `PASS`/`FAIL` in Result and a short note.

| # | Case | Gating? | Result | Note |
|---|------|:---:|:---:|------|
| 1 | Owner, one listing → auto-select | | ☐ | |
| 2 | Manager, one listing (empty personal first) → picks managed one | **GATING** | ☐ | |
| 3 | Manager, several listings → picker | | ☐ | |
| 4 | Group-manager → grouped listing audits, no 403 | **GATING** | ☐ | |
| 5 | No listings anywhere → /no-profile, no bogus profile row | | ☐ | |
| 6 | Revoked token → "Reconnect your Google" | | ☐ | |
| 7 | Owner + group-manager → picker shows both | | ☐ | |
| 8 | Role-manageable but per-location denied → "Choose a Different Listing", no crash | **GATING** | ☐ | |
| R1 | Settings → Change listing → re-binds + re-audits | | ☐ | |
| R2 | Mis-bound profile self-repairs via Change listing | | ☐ | |

**Decision:** GO only if all three gating cases (2, 4, 8) PASS. Non-gating FAILs → fix or
log as a known issue before pilot, at your discretion.
