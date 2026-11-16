# Consistency checks

Run 16 November 2026 on every open code PR merged together (`integration/nov-2026-c`, plus the scale-check PR).

## Summary

| Check | Result |
|---|---|
| Hardcoded retired model ids | **None.** One mention, in a comment explaining the change |
| Environment variables: code against the runbooks | **4 gaps in the documentation**, none in the code. Full table below |
| Route-by-route access | **Every route has a check.** One was weaker than the rest and is fixed here |
| Logging of tokens, emails or phone numbers | **No tokens. Two places could log a phone number or email**; fixed here |
| TODO and FIXME markers | **None** |
| Full test suite, three times, then once in shuffled order | **566 of 566 each time.** No flaky tests |

Small fixes are in this PR. Things too big for it are listed at the end.

---

## 1. Retired model ids

The model the app used until June (`claude-sonnet-4-20250514`) appears **once**, in a comment in `lib/ai.ts` saying it was retired. No code uses it.

The current model id (`claude-sonnet-5-5`) is written in one file, `lib/ai.ts`, twice: as the default, and in a check that sends one extra setting only to that model. Setting `ANTHROPIC_MODEL` in Netlify overrides the default without a deploy.

**Worth knowing:** that extra setting is only sent when the model is exactly `claude-sonnet-5-5`. If you ever point `ANTHROPIC_MODEL` at a different model that also "thinks" by default, replies could come back empty. The code would raise a clear error rather than publish nothing, but it is a line to revisit when the model next changes.

No other model, from any provider, is named anywhere.

## 2. Environment variables

Every variable the app reads, and where it is documented.

**New this month** (all in the merge runbook, correctly):

| Variable | Read by | In merge runbook | If missing |
|---|---|---|---|
| `SESSION_SECRET` | Sign-in cookie, console login | Yes | Falls back to `CANCEL_HASH_SECRET` |
| `SESSION_ACCEPT_LEGACY_COOKIE` | Sign-in cookie | Yes | Old cookie still accepted |
| `ANTHROPIC_MODEL` | AI writing | Yes | Uses the built-in default |
| `CRON_ALERT_EMAIL`, `CRON_ALERT_WEBHOOK_URL`, `CRON_ALERT_FROM` | Scheduled-job failure alerts | Yes | Failures go to the log only |
| `CRON_ACCEPT_QUERY_SECRET` | Scheduled jobs | Yes | Secret in the address still accepted |
| `EARLY_POST_PREVIEW_EMAILS` | Approval previews | Yes | Off |
| `TARKETT_CONSOLE_ENABLED` | Console | Yes | Off |
| `SHOP_PHOTOS`, `SHOP_PHOTOS_TO_LISTING` | Photos | Yes | Off |

**Already in Netlify before this month** (the merge runbook does not list them, because nothing about them changes):

| Variable | Read by | If missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Everything | The app cannot start |
| `SECRET_ENCRYPTION_KEY` | Stored Google credentials | Sign-in and every job fail |
| `CANCEL_HASH_SECRET` | Every signed link: cancel, approve, invite, photo upload, review card | Those links cannot be made or checked |
| `CRON_SECRET` | Scheduled jobs | Every job is refused |
| `ADMIN_PASSWORD` | /admin, /admin/pilot | Admin pages answer "not configured" |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google sign-in | Sign-in fails |
| `GOOGLE_PLACES_API_KEY` | Dashboard fallbacks | Those parts show nothing |
| `ANTHROPIC_API_KEY` | AI writing | No posts or replies are written |
| `RESEND_API_KEY`, `RESEND_FROM` | Email | Emails fail, logged |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Texts | Texts fail, logged |
| `NEXT_PUBLIC_APP_URL` | Chocka's own links | Falls back to the request's address |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID` | Chocka's paid plan only | Checkout fails. Stellar never uses Stripe |
| `URL` | Scheduled jobs, to find the site | Set by Netlify itself |

### The four documentation gaps

None is a code problem. Each is a variable the code reads that neither runbook mentions.

| Variable | What it does | Does anything need doing? |
|---|---|---|
| `STELLAR_APP_URL` | Overrides Stellar's web address. Built in as `https://app.stellarlocal.co.uk` | **No, and do not set it in production.** It is in the test-listing runbook, for local testing only. Not in the merge runbook, which is right, but worth a line saying "leave unset" |
| `STELLAR_RESEND_FROM` | Overrides Stellar's email sender. Built in as `Stellar Local <hello@stellarlocal.co.uk>` | No. Leave unset |
| `CRON_TARGET_URL` | Points the scheduled jobs at a different address from the site's own | No. Leave unset |
| `GOOGLE_REDIRECT_URI` | Chocka's sign-in return address. Stellar works its own out | No, already set. Mentioned so the list is complete |

**One real thing to check:** `ADMIN_PASSWORD` and `CRON_SECRET` are not in the merge runbook because they already exist. After the secrets scan, `ADMIN_PASSWORD` should be **changed**, and that step is not in the runbook. It is the first item in the overnight report.

I did not compare against `.env.example`: I do not read `.env` files.

## 3. Route-by-route access

Every web address the app answers, and what it checks before doing anything. Read from the code of each route after all the merges.

### Signed-in shop (the signed session cookie from #25)

| Route | Methods | Also |
|---|---|---|
| `/api/audit`, `/api/audit/previews` | POST | |
| `/api/profile-fix` | POST | |
| `/api/dashboard` | GET | |
| `/api/listings`, `/api/listings/select` | GET, POST | |
| `/api/voice` | GET, POST | The shop is found from the session, never from the request |
| `/api/account/delete` | PATCH, DELETE | |
| `/api/referral` | GET, POST | |
| `/api/checkout`, `/api/billing-portal` | POST | Chocka only |

### Admin password

| Route | Methods | Also |
|---|---|---|
| `/api/admin` | POST | **Fixed here: now compared in constant time, like the other two** |
| `/api/admin/pilot` | POST | Stellar's shops only, whatever ids are sent |
| `/api/admin/photos` | POST | Refuses unless `SHOP_PHOTOS` is on. "Add to listing" needs a second flag |

### Scheduled jobs (the cron secret, in a header)

`/api/cron/metrics-sync`, `monday-stats`, `monthly-report`, `onboarding-sequence`, `post-generator`, `post-previews`, `post-publisher`, `retailer-retention`, `review-alerts`. All GET. All refuse without the secret.

### A signed link (no sign-in; the link is the permission)

| Route | Methods | What the link allows |
|---|---|---|
| `/api/posts/cancel` | GET, POST | Cancel one post. GET shows a page; only POST acts |
| `/api/posts/approve` | GET, POST | Approve or skip one post. GET shows a page; only POST acts |
| `/api/reviews/auto-reply` | GET, POST | Publish or decline one drafted reply. GET shows a page; only POST acts |
| `/api/invite/accept` | POST (GET refused) | Start sign-in for one invited shop |
| `/api/photos/upload` | GET, POST | Add photos for one shop. 404 unless `SHOP_PHOTOS` is on |
| `/review-card/[id]` (a page) | GET | See one shop's name, town and public Google review link |

### The Tarkett console (404 unless `TARKETT_CONSOLE_ENABLED` is on)

| Route | Methods | Also |
|---|---|---|
| `/api/console/login` | POST | Gives the same answer whether or not the address has access |
| `/api/console/verify` | GET, POST | One-time link. GET shows a page; only POST signs in |
| `/api/console/data` | GET | Needs the console's own session. A shop's session does not work |
| `/api/console/logout` | POST | |
| `/console`, `/console/league` (pages) | GET | Checked on the server |

### Other services calling us

| Route | Check |
|---|---|
| `/api/webhook` (Stripe) | Stripe's signature |
| `/api/sms/webhook` (Twilio) | Twilio's signature |
| `/api/auth/callback/google` | Google's sign-in exchange. A new Stellar account also needs a valid invite |

### Pages with no check of their own

`/`, `/login`, `/privacy`, `/terms`, `/no-profile`, `/ref/[code]`, `/invite/[token]`: public by design.
`/dashboard`, `/onboarding`, `/settings`, `/admin`, `/admin/pilot`, `/photos/[token]`: the page itself is an empty shell. Everything on it comes from one of the routes above, which does the checking. Opening `/dashboard` without signing in shows a page with nothing in it.

**The staging dummy run confirmed the important ones for real:** no session and a forged session are both refused, a wrong admin password is refused, a tampered approval link is refused, a shop's login cannot open the console, an uninvited sign-in creates no account.

### Things an attacker could still lean on

Not holes, but worth knowing:

1. **Nothing limits how fast the admin password can be guessed.** It is one shared password with no lockout. A long random one makes that academic; a short one does not. **Change it (see the secrets scan) and make it long.**
2. **Nothing limits how fast photos can be uploaded** through a valid link, beyond 40 photos per shop and 4 MB each. A leaked link could fill a shop's allowance with junk, which a rep would then reject. Cancelling the link stops it.
3. **The signed links for posts and replies do not expire.** A cancel or approve link in an old email works for as long as that post or reply is still waiting. That is how email links have to work, but it means forwarding one of those emails forwards the permission.

## 4. Logging of tokens, emails and phone numbers

I read every log line in the app, the jobs and the shared code.

**Tokens and secrets: none logged.** Where a credential fails, the log says that it failed and for which account, never the credential. The sign-in route logs whether an email was `present` or `absent`, not the address.

**Two places could log a phone number or an email address. Fixed here:**

| Where | What happened | Now |
|---|---|---|
| `lib/twilio.ts` | When a text is refused, Twilio's whole error was logged. Twilio's errors quote the number ("The 'To' number +44… is not valid") | The number is replaced with `[phone]`. The reason is kept |
| `lib/email.ts` | When an email is refused, the provider's whole error was logged, which can quote the address | The address is replaced with `[email]` |

**Left as they are, and why:**

| Where | What is logged | Why it is acceptable |
|---|---|---|
| `lib/ai.ts` | Text the model wrote that failed the safety checks | It is our own draft, needed to see why it was refused. A reply draft can contain a reviewer's first name, which is already public on Google |
| `app/api/profile-fix` | The first 300 characters of what a shop approved at onboarding | Business description and services: about to be published anyway |
| `lib/google.ts` | The first 200 characters of each change sent to a listing | The same: public listing content |
| Shop and user **ids** in many places | Internal ids | Not personal on their own, and necessary to trace a problem |

## 5. TODO and FIXME

**None**, anywhere in the app, the jobs, the shared code or the scripts. Deferred work is tracked in `FOLLOWUPS.md` instead, which is the better place.

## 6. Flaky tests

The full suite was run three times in a row, then once more with the tests in random order.

| Run | Files | Tests | Result |
|---|---|---|---|
| 1 | 35 | 566 | All pass |
| 2 | 35 | 566 | All pass |
| 3 | 35 | 566 | All pass |
| Shuffled order | 35 | 566 | All pass |

Nothing failed intermittently, and nothing depends on the order tests run in.

**One thing that could become flaky:** several tests work with "today" and "last month". They passed on 16 November. Tests like that sometimes fail on the 1st of a month or around the clock change. I did not find one that would, but if a test fails on a 1st with no code change, look there first.

---

## Fixed in this PR

| Fix | Why |
|---|---|
| `/api/admin` compares the password in constant time and reads it per request | It was the only one of the three admin routes using a plain comparison |
| Phone numbers and email addresses are removed from failed-send logs (`lib/redact.ts`, with tests) | See section 4 |
| Test data no longer uses a real shop's name and web domain | From the secrets scan. Replaced with an invented shop and the reserved `example.co.uk` |
| Test data no longer uses a named Tarkett contact's email address | From the secrets scan. Replaced with an invented address |
| `FOLLOWUPS.md` no longer names two people at Tarkett | Replaced with their roles |
| `.DS_Store` removed from the repository and ignored | From the secrets scan |

## Not fixed here (too big, or not mine to decide)

| What | Where it is written up |
|---|---|
| Change `ADMIN_PASSWORD`; decide about the public repository and the committed shop data | `docs/secrets-scan.md` (not committed) |
| The monthly report runs out of time at about 35 shops | `docs/scale-check.md` |
| Next.js and the Netlify plugin need upgrades beyond a patch | PR #46 |
| Reviews, posts and texts are all filed under the Chocka brand in the database | `docs/dummy-run-report.md` |
| A limit on admin password guesses | Above, section 3 |
