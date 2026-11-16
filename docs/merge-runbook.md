# Merge runbook: every open pull request (#24 to #60)

Updated 17 November 2026 for #54 to #60 (stage 11). Every step below was rehearsed on a throwaway local branch (`rehearsal/final-2026-11-16` for stages 1 to 10, then `rehearsal/final-2026-11-17` on top of it for stage 11; neither was pushed), with typecheck and the full test suite after every merge and a production build at the end. The result is file-for-file identical to the head of #60, which is the tree that also passed the staging dummy run (52 of 52), the scale check and the 92-shop simulation.

**31 code PRs in 11 stages, 13 database migrations, 3 documents, and 2 legal PRs that wait for the solicitor.**

| Stage | PRs | Migration first |
|---|---|---|
| 1 | #24, #25 | none |
| 2 | #26, #27, #29, #28, #31 | 1 |
| 3 | #32 | 2 |
| 4 | #33, #34 | 3, 4 |
| 5 | #35 | 5 |
| 6 | #36 | 6 |
| 7 | #37 | 7 |
| 8 | #38, #40, #46, #42, #47 | 8 |
| 9 | #39, #43 | 9 |
| 10 | #48, #49, #50, #52, #53 | 10 |
| 11 | #54, #55, #56, #57, #58, #59, #60 (together, never partway) | 11, 12, 13 |
| any time | #41, #45, #51 (documents) | none |
| after the solicitor | #30, then #44 | none |

## Before you start

**How this works.** The merges are done on your machine and pushed, not clicked on GitHub. Three of them have conflicts GitHub cannot resolve for you, and the later PRs contain the earlier ones' commits, so:

- **Always a merge commit. Never squash, never rebase.** A squash breaks every PR stacked on top of it.
- Each **stage** below ends with one push to `main`, which is one Netlify deploy.
- Where a stage needs a database migration, **apply the migration first, then push**. The new code asks for the new columns, and asking for a column that does not exist is an error.

**When to do it.** Three things to avoid:

- **Not on the 1st or 2nd of a month** for stage 10. The monthly report's "already sent" marker starts empty; if the old code has already sent that month's reports, the new code would send them again.
- **Not on a Friday between 09:00 and 13:00 UTC, or a Monday between 08:00 and 13:00 UTC.** Those are when posts are written and published and the weekly text goes out. Releasing partway through a job's morning is how a shop ends up with two of something.
- **Stages 8 to 10 in one sitting if you can.** #35 (stage 5) leaves one gap that #38 (stage 8) closes: onboarding replying to low-star reviews. And **#49 must never be live without #53**, which is why they are in the same stage.

**Set a fresh, long `ADMIN_PASSWORD` in Netlify before you start** (`openssl rand -base64 24`), and redeploy. It protects `/admin` and `/admin/pilot`, which these PRs make considerably more capable.

**One-off preparation:**

```bash
cd ~/chocka-app
git checkout main
git pull --ff-only
git fetch origin
git tag pre-nov-merge            # the way back, if you need one
```

**The check to run before every push** (about a minute):

```bash
rm -rf .next && npx tsc --noEmit && npm test && npm run build
```

All three must pass. `rm -rf .next` matters: without it, typecheck reports false errors from the previous build's leftovers. The build prints a few "Dynamic server usage" lines about `request.cookies`; those are noise, and the build still exits successfully.

**Migrations** use Python 3.14 (3.13 has no `certifi`). Dry-run first (leave off `--confirm`), read what it will add, then confirm:

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py <file>.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py <file>.sql --confirm
```

Never paste migration SQL into the Supabase editor. It jams this script afterwards.

### The "still differ" warning: expect it on the first twelve

Staging already has all thirteen migrations. So after **each of the first twelve**, the script:

1. prints `applied and recorded`,
2. then prints `WARNING: production and staging still differ after applying:` followed by a list,
3. and exits with an error code.

**That is expected, every time.** The migration has been applied and recorded. The list is simply what staging still has that production does not. What to check is that the list **gets shorter each time** and contains only things from later migrations.

Only the thirteenth (`20261117110000_ad_spend_and_live_months`) ends with `identical across every probe`. If you stop early, the last one you apply still warns. **This has changed since the first version of this runbook:** the tenth used to end cleanly; now that staging also has 11 to 13, the tenth warns too, listing only things from those three.

**A different message means stop.** If it says `REFUSED: production has objects staging does not. They have diverged`, do not continue. Nothing has been applied. Tell me what it listed.

---

## Netlify variables

Set these in Netlify (Site configuration, Environment variables) for the production site.

| Variable | Value | When | Why |
|---|---|---|---|
| `SESSION_SECRET` | A long random string. Make one with `openssl rand -hex 32`. Mark it secret. | **Before stage 1** | Signs the login cookie (#25). If missing, the app falls back to `CANCEL_HASH_SECRET`, so nothing breaks, but it should have its own. |
| `CRON_ALERT_EMAIL` | Your email address | Before stage 2 | Where a failed scheduled job reports (#29). Sent through Resend. |
| `CRON_ALERT_WEBHOOK_URL` | A Slack-style webhook address | Optional, before stage 2 | Same alerts, to a channel. Either this or the email, or both. |
| `CRON_ALERT_FROM` | A sender address | Optional | Defaults to `RESEND_FROM`. Only set it if alerts should come from somewhere else. |
| `ANTHROPIC_MODEL` | Leave unset | Optional | The default (`claude-sonnet-5-5`) is in the code (#24). Set this only to change model without a deploy. |
| `SESSION_ACCEPT_LEGACY_COOKIE` | `false` | **About a week after stage 1** | Until this is `false`, the old forgeable cookie is still accepted, so **the cookie hole from #25 is not closed until you set it.** The wait lets signed-in shops pick up the new cookie. Watch the logs for "accepted a legacy unsigned session cookie"; when it stops appearing, set this. |
| `CRON_ACCEPT_QUERY_SECRET` | `false` | A few days after stage 2 | Stops the cron secret being accepted in a web address. Set it once the logs no longer show "secret accepted from the URL". |
| `EARLY_POST_PREVIEW_EMAILS` | Leave unset | Only when you decide | `on` sends real emails to shops about posts awaiting approval (#35). While unset, a new shop's first three posts wait for approval and no email goes out. |
| `TARKETT_CONSOLE_ENABLED` | Leave unset | Only after the privacy checklist | `on` opens the Tarkett console (#37). Work through `docs/console-privacy-checklist.md` first. |
| `SHOP_PHOTOS` | Leave unset | Not until the privacy wording is reviewed | From #39. `on` turns on the upload link, approval and photos on posts |
| `SHOP_PHOTOS_TO_LISTING` | Leave unset | Not until then either | From #39. Also needs the one migration this runbook says to leave alone |
| `ADMIN_PASSWORD` | A fresh long random value | **Before stage 1** | Already exists. Set a new one for this release |

PRs #46 to #53 add no new variables. #54 to #60 add these, **all optional, all off or unset by default**:

| Variable | Value | When | Why |
|---|---|---|---|
| `WELCOME_EMAIL` | Leave unset, or `on` | When you decide | `on` sends **one** email to a shop at the moment it connects, and never to a shop that has not (#56). Unset: nothing is sent |
| `LIVE_REQUIRES` | Leave unset | Only to relax the definition | What counts as live beyond "connected". Default `matched,verified,access` (#55). Removing a word relaxes it |
| `BILLING_PRICE_PENCE_PER_SHOP` | Whole pence per live shop | Before the first statement | The price is deliberately not in the code: the repository is public (#58). Unset: the statement shows counts only |
| `BILLING_MONTHLY_CAP_SHOPS` | A number of shops | Before the first statement | Shops above it appear as a credit line (#58). Unset: no cap |
| `BILLING_MIN_LIVE_DAYS` | Leave unset | Optional | Days live in a month to count. Default 1 |

After stage 11, `/admin/pilot` has a **Ready to invite shops?** button that checks every variable is present (never its value), every migration is applied and the scheduled jobs are running.

Changing a variable needs a redeploy to take effect (Netlify: Deploys, Trigger deploy).

---

## Stage 1: the two urgent fixes (#24, #25)

No migration.

```bash
git merge --no-ff --no-edit origin/fix-retired-ai-model        # #24
git merge --no-ff --no-edit origin/fix-signed-session-cookie   # #25
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

Both merge cleanly. Tests after #24: 254. After #25: 274.

**Verify once Netlify has deployed:**
- Open app.stellarlocal.co.uk and app.chocka.co.uk. Both load, each in its own brand.
- Sign in with Google on one. You reach the dashboard. In the browser's cookies there is a `chocka_session` cookie.
- An account that was already signed in still works (the old cookie is accepted for now).
- Netlify function logs: no `Claude API failed` lines the next time something generates text.

---

## Stage 2: change log, reviews, cron hardening, presence score, pilot page (#26, #27, #29, #28, #31)

**Migration 1 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261114120000_create_change_log.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261114120000_create_change_log.sql --confirm
```

Expected: `applied and recorded`, then the "still differ" warning. Still listed: everything from migrations 2 to 10.

**Then merge:**

```bash
git merge --no-ff --no-edit origin/feat-change-log             # #26  clean
git merge --no-ff --no-edit origin/fix-reviews-all-pages       # #27  CONFLICT, see below
```

**#27 conflicts in two files**, `app/api/audit/previews/route.ts` and `app/api/profile-fix/route.ts`. In both it is the same thing: #25 and #27 each added one `import` line in the same place. **Both lines are needed.** This deletes the conflict markers and keeps both:

```bash
sed -i '' -e '/^<<<<<<< /d' -e '/^=======$/d' -e '/^>>>>>>> /d' \
  app/api/audit/previews/route.ts app/api/profile-fix/route.ts
grep -n "lib/session\|lib/review-intake" app/api/audit/previews/route.ts app/api/profile-fix/route.ts
```

The `grep` must print four lines: an import of `getSessionUserId` and an import of `ONBOARDING_REPLY_CAP` in each file. Then:

```bash
git add app/api/audit/previews/route.ts app/api/profile-fix/route.ts
git commit --no-edit
```

```bash
git merge --no-ff --no-edit origin/chore-cron-hardening        # #29  CONFLICT, see below
```

**#29 conflicts in one file**, `app/api/profile-fix/route.ts`, for the same reason: a third import line (`ukTomorrowAt`) next to the other two. Keep all three:

```bash
sed -i '' -e '/^<<<<<<< /d' -e '/^=======$/d' -e '/^>>>>>>> /d' app/api/profile-fix/route.ts
grep -n "lib/session\|lib/review-intake\|lib/post-schedule" app/api/profile-fix/route.ts   # must print three lines
git add app/api/profile-fix/route.ts
git commit --no-edit
```

```bash
git merge --no-ff --no-edit origin/feat-report-presence-score  # #28  clean
git merge --no-ff --no-edit origin/feat-pilot-admin-tools      # #31  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

Tests after each: #26 291, #27 301, #29 320, #28 326, #31 339.

**Verify:**
- `/admin/pilot` asks for the admin password, then lists the Stellar shops with counts across the top.
- Netlify, Functions: the six scheduled jobs are listed (`cron-monday-stats`, `cron-monthly-report`, `cron-onboarding-sequence`, `cron-post-generator`, `cron-post-publisher`, `cron-review-alerts`).
- Wait for the next `cron-post-publisher` run (every 15 minutes) and read its log: it finishes without an error, and you get no alert email.
- In Supabase (production, table editor, read only): `change_log` exists.

---

## Stage 3: security (#32)

**Migration 2 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115090000_lock_down_exposed_tables.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115090000_lock_down_exposed_tables.sql --confirm
```

Expected: applied, then the warning. Still listed: migrations 3 to 10.

**Then:**

```bash
gh pr edit 32 --base main          # so GitHub shows it as merged afterwards
git merge --no-ff --no-edit origin/sec-rls-and-confirm-links   # #32  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

Tests: 346.

**Verify:**
- `/admin/pilot` still lists the shops. (That proves the server can still read the locked tables.)
- Open an old "cancel this post" or "approve" link from an email. It now shows a page with a button, and nothing happens until the button is pressed.
- Supabase, production, Authentication → Policies (or Table editor): `retailers`, `retailer_invites` and `score_history` show row level security **enabled**.

---

## Stage 4: report numbers and before-and-after (#33, #34)

**Migrations 3 and 4 first, in this order:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115100000_daily_metrics.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115100000_daily_metrics.sql --confirm
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115110000_retailer_ad_start_date.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115110000_retailer_ad_start_date.sql --confirm
```

Expected after migration 3: warning, still listing migrations 4 to 10. After migration 4: migrations 5 to 10.

**Then:**

```bash
gh pr edit 33 --base main
gh pr edit 34 --base main
git merge --no-ff --no-edit origin/fix-report-metrics          # #33  clean
git merge --no-ff --no-edit origin/feat-ad-before-after        # #34  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

Tests: #33 362, #34 371.

**Verify:**
- Netlify, Functions: `cron-metrics-sync` now appears (runs at 20 past each hour).
- After its first run, its log shows no error. If any shop is connected, `daily_metrics` in Supabase has rows; with no connected shops it stays empty, which is fine.
- `/admin/pilot` has an "Ads started" column with a date box per shop.

---

## Stage 5: safer automation (#35)

**Migration 5 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115120000_post_approval.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115120000_post_approval.sql --confirm
```

Expected: warning, still listing migrations 6 to 10.

**Then:**

```bash
gh pr edit 35 --base main
git merge --no-ff --no-edit origin/feat-safer-automation       # #35  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

Tests: 386.

**Verify:**
- Netlify, Functions: `cron-post-previews` appears (runs at 40 past each hour).
- Its log says either nothing was due, or `preview(s) due, NOT sent: EARLY_POST_PREVIEW_EMAILS is off`. **It must not say it sent anything.**
- Remember: from now on a new shop's first three posts wait for approval, and with the preview email off there is no way for the shop to be asked. Decide how they get approved (question 2 in the overnight report).

---

## Stage 6: ownership detection (#36)

**Migration 6 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115130000_retailer_connection_status.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115130000_retailer_connection_status.sql --confirm
```

Expected: warning, still listing migrations 7 to 10.

**Then:**

```bash
gh pr edit 36 --base main
git merge --no-ff --no-edit origin/feat-ownership-detection    # #36  CONFLICT, see below
```

**#36 conflicts in two files**, `app/admin/pilot/page.tsx` and `app/api/admin/pilot/route.ts`. #34 added the "Ads started" column to the pilot table and #36 adds "Google connection" to the same rows. Both are wanted. The resolved versions already exist on the integration branch, so take them from there:

```bash
git checkout origin/integration/nov-2026-b -- app/admin/pilot/page.tsx app/api/admin/pilot/route.ts
grep -c "adStartDate\|ad_start" app/admin/pilot/page.tsx app/api/admin/pilot/route.ts     # both above 0
grep -c "connection" app/admin/pilot/page.tsx app/api/admin/pilot/route.ts                # both above 0
grep -c "<<<<<<<\|>>>>>>>" app/admin/pilot/page.tsx app/api/admin/pilot/route.ts          # both 0
git add app/admin/pilot/page.tsx app/api/admin/pilot/route.ts
git commit --no-edit
```

```bash
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

Tests: 396.

**Verify:**
- `/admin/pilot` shows both a "Google connection" column and the "Ads started" column.
- Generate a link for one test shop. Its connection column then reads as invited. (Shops with links made before this stage show a dash until they next do something.)

---

## Stage 7: Tarkett console, switched off (#37)

**Migration 7 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115140000_funder_console.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261115140000_funder_console.sql --confirm
```

Expected: applied, **and still the warning**, now listing only migrations 8 to 10: the `retailers.voice_*` columns (8); the `shop_photos` table, `retailers.photo_link_*` and `scheduled_posts.photo_id` (9); and `profiles.monthly_report_sent_for` (10).

**Then:**

```bash
gh pr edit 37 --base main
git merge --no-ff --no-edit origin/feat-tarkett-console        # #37  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

Tests: 412.

**Verify:**
- `/console` and `/console/league` both return **404**. (The flag is off. If either shows a page, check `TARKETT_CONSOLE_ENABLED` is not set.)
- Everything from stages 1 to 6 still works: sign in, dashboard, `/admin/pilot`.
- `git diff --stat origin/feat-tarkett-console main` prints **nothing**. That confirms main matches what was rehearsed up to here.

---

## Stage 8: voice, review card, dependency patches, low-star handling (#38, #40, #46, #42, #47)

**Migration 8 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261116090000_retailer_voice_profile.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261116090000_retailer_voice_profile.sql --confirm
```

Expected: warning, still listing migrations 9 and 10.

**Then:**

```bash
for n in 38 40 46 42 47; do gh pr edit $n --base main; done
git merge --no-ff --no-edit origin/feat-voice-profile          # #38  clean
git merge --no-ff --no-edit origin/feat-review-link-card       # #40  clean
git merge --no-ff --no-edit origin/chore-dependency-patches    # #46  clean
npm ci                                                         # the installed packages change with #46
git merge --no-ff --no-edit origin/feat-onboarding-low-star    # #42  clean
git merge --no-ff --no-edit origin/fix-review-recording        # #47  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

**Verify:**
- `/admin/pilot` has a "Voice" column and a "Review link" column with "Copy link" and "Card". Open one card and scan it with a phone: it must open that shop's Google review page.
- The site builds and loads as before (that is #46: nothing visible changes).
- A shop's dashboard shows "Replies waiting for you" only when a reply is waiting.
- Send yourself one test text from staging if you can: #46 updated packages the text sender uses.

---

## Stage 9: photos, switched off (#39, #43)

**Migration 9 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261116100000_shop_photos.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261116100000_shop_photos.sql --confirm
```

Expected: warning, still listing migration 10 only (`profiles.monthly_report_sent_for` and its check).

**Then:**

```bash
gh pr edit 39 --base main; gh pr edit 43 --base main
git merge --no-ff --no-edit origin/feat-shop-photos            # #39  clean
git merge --no-ff --no-edit origin/feat-photo-deletion         # #43  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git push origin main
```

**Verify:** nothing visible changes, because both flags are off. `/photos/anything` returns 404. `/admin/pilot` has **no** "Photos" column. In Supabase, production, Storage: a private bucket `shop-photos` exists and is empty.

**Do not set `SHOP_PHOTOS`** until stage 10 is also in (it contains fixes to the photo checks) and the privacy wording has been reviewed.

---

## Stage 10: scheduled jobs that scale, and the review fixes (#48, #49, #50, #52, #53)

**Not on the 1st or 2nd of a month. Not on a Friday or Monday morning.** (See "When to do it".)

**Migration 10 first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261116120000_profile_monthly_report_marker.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261116120000_profile_monthly_report_marker.sql --confirm
```

Expected: `applied and recorded`, then the **"still differ" warning**, listing only things from migrations 11 to 13 (`connect_issue`, `opened_at`, `welcome_email_sent_at`, `ad_spend_pence`, `live_months` and the like). That is correct: staging has those three as well. If it lists anything else, stop and tell me.

**Then, all five together. Do not push partway:**

```bash
for n in 48 49 50 52 53; do gh pr edit $n --base main; done
git merge --no-ff --no-edit origin/test-staging-dummy-run      # #48  clean
git merge --no-ff --no-edit origin/perf-cron-time-budgets      # #49  clean
git merge --no-ff --no-edit origin/chore-consistency-fixes     # #50  clean
git merge --no-ff --no-edit origin/perf-monthly-report-resume  # #52  clean
git merge --no-ff --no-edit origin/fix-review-findings         # #53  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build
git diff --stat origin/fix-review-findings HEAD                # must print nothing
git push origin main
```

`git diff --stat origin/fix-review-findings HEAD` printing nothing is the proof that what you are about to push is exactly the tree that was tested.

**Verify, in Netlify, Functions.** Four schedules have changed:

| Job | Now runs (UTC) | Was |
|---|---|---|
| `cron-post-generator` | Every 5 minutes, 09:00 to 12:55, Fridays | Once, 09:00 Friday |
| `cron-monday-stats` | Every 5 minutes, 08:00 to 10:55, Mondays | Once, 08:00 Monday |
| `cron-review-alerts` | Every 15 minutes, 08:00 to 18:45, every day | Once, 09:00 |
| `cron-monthly-report` | Every 5 minutes, 08:00 to 11:55, on the 1st and 2nd | Once, 08:00 on the 1st |

Their logs will show many short runs. Most say there was nothing left to do. That is correct. No run should take more than about 22 seconds, and you should get no failure alerts.

**Then check:**
- `/admin` still accepts the admin password.
- After the next Friday: every shop with posts on has **one** post for the coming Monday, not two, and a shop that cancelled its post has none. **Posts are now weekly.** They were going out fortnightly because of an old bug that #53 fixes.
- After the next Monday: each shop got **one** text.
- After the next 1st: each shop got **one** report. In Supabase, `profiles.monthly_report_sent_for` holds last month for every live shop.

**Tidy up** (optional, once you are happy):

```bash
git push origin --delete integration/nov-2026 integration/nov-2026-b integration/nov-2026-c integration/nov-2026-d
git branch -D rehearsal/final-2026-11-16
```

---

## Stage 11: one link, connected, safe (#54, #55, #56, #57, #58, #59, #60)

The onboarding flow rebuilt: no default opening hours, every change checked before it is called done, no dead ends at sign-in, a needs-help list, one definition of "live", hours and undo in Settings, ad spend, and the monthly count of live shops.

**All seven together. Never partway:** #60 fixes defects in the six before it.

**Not on the 1st or 2nd of a month. Not on a Friday or Monday morning.**

**Three migrations first, in this order.** Each is additive. For each: a dry run, read it, then `--confirm`.

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261117090000_connection_visibility.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261117090000_connection_visibility.sql --confirm
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261117100000_welcome_email_marker.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261117100000_welcome_email_marker.sql --confirm
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261117110000_ad_spend_and_live_months.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261117110000_ad_spend_and_live_months.sql --confirm
```

Expected: the first two end with the "still differ" warning (shorter each time). **The third ends with `identical across every probe`** and a tick.

**Then merge:**

```bash
for n in 54 55 56 57 58 59 60; do gh pr edit $n --base main; done
git merge --no-ff --no-edit origin/stage1-safe-onboarding     # #54  clean
git merge --no-ff --no-edit origin/stage2-visibility          # #55  clean
git merge --no-ff --no-edit origin/stage3-simple-flow         # #56  clean
git merge --no-ff --no-edit origin/stage4-listing-care        # #57  clean
git merge --no-ff --no-edit origin/stage4-ads-billing-undo    # #58  clean
git merge --no-ff --no-edit origin/stage5-improvements        # #59  clean
git merge --no-ff --no-edit origin/stage6-proof               # #60  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build   # 878 tests
git diff --stat origin/stage6-proof HEAD                      # must print nothing
git push origin main
```

In the rehearsal all seven merged with no conflicts, and typecheck and the suite passed after each (707, 741, 765, 781, 831, 851, 878 tests).

**Verify:**

1. `/admin/pilot`, **Ready to invite shops? → Check now.** Under "Database" every line should have a tick. Under "Settings", fix anything with a cross. Read the switches: the welcome email, the preview email, photos and the console should each say what you expect.
2. `/admin/pilot` shows **Needs help** at the top. With no shops invited it says nobody needs help.
3. Open an invite link for a test shop: the page shows three lines about which Google account to use, ticking the box, and nothing changing. Connecting ends on **You're connected**, not on a score.
4. In Netlify, Functions, `cron-metrics-sync`: its log now also reports `rechecked` and `liveCount`. No new scheduled job was added.
5. The next day, **Live shops in a month** for the current month lists the shops that are live, by name.

**What changes for a shop that is already connected:** nothing is rewritten. A shop on a listing that does not match the one we invited, or that Google has not verified, now shows as **Connected, not live**, appears under Needs help, and has posts, replies, texts and reports **held** until a person presses **This is right** (or Google verifies it). Look at that list once on the day.

**Settings to decide before inviting the 92:**

- `WELCOME_EMAIL=on` if you want each shop to get one email when it connects.
- `BILLING_PRICE_PENCE_PER_SHOP` and `BILLING_MONTHLY_CAP_SHOPS` before the first statement.
- The wording for Tarkett to send is in `docs/invite-wording.md`. Links for every shop: **Generate links for all N without one**, then **Download CSV**.

---

## All thirteen migrations, in order

| # | File | PR | Apply before stage |
|---|---|---|---|
| 1 | `20261114120000_create_change_log.sql` | #26 | 2 |
| 2 | `20261115090000_lock_down_exposed_tables.sql` | #32 | 3 |
| 3 | `20261115100000_daily_metrics.sql` | #33 | 4 |
| 4 | `20261115110000_retailer_ad_start_date.sql` | #34 | 4 |
| 5 | `20261115120000_post_approval.sql` | #35 | 5 |
| 6 | `20261115130000_retailer_connection_status.sql` | #36 | 6 |
| 7 | `20261115140000_funder_console.sql` | #37 | 7 |
| 8 | `20261116090000_retailer_voice_profile.sql` | #38 | 8 |
| 9 | `20261116100000_shop_photos.sql` | #39 | 9 |
| 10 | `20261116120000_profile_monthly_report_marker.sql` | #52 | 10 |
| 11 | `20261117090000_connection_visibility.sql` | #55 | 11 |
| 12 | `20261117100000_welcome_email_marker.sql` | #56 | 11 |
| 13 | `20261117110000_ad_spend_and_live_months.sql` | #58 | 11 |

All thirteen only add things or tighten access. Each is on staging already.

## The documents and the legal PRs

- **#41** (this runbook), **#45** (`docs/test-listing-runbook.md`) and **#51** (`docs/README.md`, the index of documents) change no code and can be merged at any time. **Run the test in #45 before stage 1 if you can:** its first step is the real model call that #24 is waiting on.
- **#30** (legal drafts) and then **#44** (the solicitor briefing, which sits on #30): only after the solicitor. #30 changes the live privacy and terms pages, not only documents.

**One migration to leave alone:** `20261116110000_change_log_add_media.sql` (in #39). Do not apply it anywhere, staging included, until all thirteen above are on production. It changes an existing constraint rather than adding something, and applying it early makes the production script refuse everything after migration 1. It is only needed if listing photos are ever switched on. The file explains this at the top.

---

## If something goes wrong

- **A deploy misbehaves.** Netlify, Deploys, pick the last good one, "Publish deploy". That is instant and touches nothing else. Then tell me what you saw.
- **Undo a merge that has been pushed.** `git revert -m 1 <the merge commit>` and push. Do not reset or force-push main.
- **Migrations stay.** All thirteen only add things (tables, columns, indexes) or tighten access. Old code runs fine against them, so a code rollback never needs a database rollback.
- **A merge conflict that is not described above.** Stop: `git merge --abort`. The rehearsal had exactly three conflicted merges (#27, #29, #36), and none in stage 11. Anything else means a branch has changed since 17 November.

---

## What the rehearsal found

Run on 16 November on `rehearsal/final-2026-11-16`, a local branch that was never pushed. After every merge: typecheck and the full test suite. At the end of every stage: a production build.

| Step | Merge | Typecheck | Tests | Build |
|---|---|---|---|---|
| #24 model | clean | pass | 254 pass | not run at this step |
| #25 cookie | clean | pass | 274 pass | pass |
| #26 change log | clean | pass | 291 pass | not run at this step |
| #27 reviews | **conflict**: `app/api/audit/previews/route.ts`, `app/api/profile-fix/route.ts`: two imports on the same line. Keep both | pass | 301 pass | not run at this step |
| #29 cron hardening | **conflict**: `app/api/profile-fix/route.ts`: a third import beside them. Keep all three | pass | 320 pass | not run at this step |
| #28 presence score | clean | pass | 326 pass | not run at this step |
| #31 pilot tools | clean | pass | 339 pass | pass |
| #32 security | clean | pass | 346 pass | pass |
| #33 metrics | clean | pass | 362 pass | not run at this step |
| #34 before and after | clean | pass | 371 pass | pass |
| #35 safer automation | clean | pass | 386 pass | pass |
| #36 ownership | **conflict**: `app/admin/pilot/page.tsx`, `app/api/admin/pilot/route.ts`: two columns added to the same table. Take both files from `integration/nov-2026-b` | pass | 396 pass | pass |
| #37 console | clean | pass | 412 pass | pass |
| #38 voice | clean | pass | 447 pass | not run at this step |
| #40 review link and card | clean | pass | 458 pass | not run at this step |
| #46 dependency patches | clean | pass | 458 pass | pass |
| #42 low-star at onboarding | clean | pass | 474 pass | not run at this step |
| #47 review recording fix | clean | pass | 479 pass | pass |
| #39 photos | clean | pass | 533 pass | not run at this step |
| #43 photo deletion | clean | pass | 547 pass | pass |
| #48 staging dummy run | clean | pass | 547 pass | not run at this step |
| #49 jobs stop on time | clean | pass | 562 pass | not run at this step |
| #50 consistency fixes | clean | pass | 566 pass | not run at this step |
| #52 monthly report | clean | pass | 582 pass | pass |
| #53 review fixes | clean | pass | 609 pass | pass |

**The final tree is identical to the head of #53** (`git diff` between them is empty). That head is what passed the staging dummy run (40 of 40) and the scale check at 10, 180 and 500 shops.

Three merges conflict (#27, #29, #36). None needs code written: each is two changes that both belong, and the commands are in stages 2 and 6. Every other merge is clean.

Things worth knowing:

- **Leftover build files cause false typecheck errors.** Hence `rm -rf .next` in the check.
- **#32 onwards merge cleanly only because the earlier PRs go in as merge commits.** Squashing any of them turns the later merges into large conflicts.
- **After #46, run `npm ci`** before checking. It changes the installed packages; without it the build uses the old ones.
- The rehearsal was run on a heavily loaded machine. The suite's default test timeout was raised from 5 to 30 seconds in #52 for that reason; before #52 in the order, a slow machine can make one or two tests time out with nothing wrong. Run them again before worrying.
