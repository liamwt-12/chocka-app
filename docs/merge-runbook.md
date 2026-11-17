# Merge runbook: every open pull request (#24 to #69)

Updated for the retention build, #64 to #69 (stage 13), which sits **on top of** the release PR (#63). Before that: 18 November 2026 for #61 and #62 (stage 12) and for the single release PR.

**The retention build is not in #63.** #63 is still exactly the tree it was. Merge #63 first (path A) or stages 1 to 12 (path B), then do stage 13 below. Or, once you have read #64 to #69, merge them into the release branch and release everything at once: "Stage 13" says how.

**There are now two ways to do this.** Both end in exactly the same code. Read "Two ways to merge" below and pick one before you start.

**33 code PRs in 12 stages, 14 database migrations, 3 documents, and 2 legal PRs that wait for the solicitor.** Or: one PR, #63, that contains all of the code and the three documents.

**Then stage 13: six more PRs (#64 to #69) and 3 more migrations**, for 17 in all.

Every step of both paths was rehearsed on throwaway local branches that were never pushed (`rehearsal/final-2026-11-16`, `-17` and `-18` for the staged path; `rehearsal/single-merge-2026-11-18` for the single merge), with typecheck and the full test suite. Both results are file-for-file identical to the head of #62, which is the tree that passed the staging dummy run (54 of 54), the scale check (58) and the 92-shop simulation (38).

## Two ways to merge

| | **A. One merge (#63)** | **B. Twelve stages (#24 to #62)** |
|---|---|---|
| What you do | Apply the 14 migrations in order, then merge one PR | Apply each stage's migrations, merge its PRs by hand, check, push; twelve times |
| Deploys | 1 | 12 |
| Time at the keyboard | About an hour | Most of a day, or spread over several |
| Conflicts to resolve by hand | None | Three (#27, #29, #36), each described below |
| What is live in between | Nothing: old code, then all of the new code | Eleven in-between versions, each for as long as you leave it |
| How well tested is what goes live | The final tree is the one every proof run was run against | Each in-between version passed typecheck and the unit tests in rehearsal. None had the dummy run, the simulation or a browser run. Two are known to be unsafe to leave live: #49 without #53, and #54 to #59 without #60 |
| If something misbehaves | You know it is this release, not which part. Roll back the whole release in one step | You know which stage. Roll back that stage |
| Rolling back | Netlify: publish the previous deploy (instant). Or `git revert -m 1` of one merge commit | The same, for the stage |
| Migrations | All 14 first, against the old code, which runs fine on them: they only add things | The same 14, spread out |
| Review on GitHub | One very large diff. Review it by reading the 33 PRs it is made of; they stay open for that | Thirty-three readable diffs |
| Chance of a slip | One push | Twelve pushes, three hand-resolved conflicts, 33 base changes |

**The risk in A** is that it is everything at once: if a fault shows only in production, the release cannot say which change caused it, and the roll-back takes the good with the bad. **The risk in B** is the in-between versions and the hand work: more chances for a slip, and eleven versions live that were never tested as a whole.

**Recommendation: A, the single merge**, provided no shop has been invited yet. What is being released is one tested tree. Stopping at eleven points on the way to it adds risk without adding information, because none of those points is somewhere you would choose to stay. The usual argument for small steps (find the fault early, with real users) does not apply while there are no real users on this brand: the first real test is the test-listing session, and that needs the final code.

**Choose B instead if** shops are already connected and using the brand by the time you merge, or if you want to watch each scheduled job run on the new code for a day before the next change.

Either way: **all new switches stay off**, and **run the test-listing session (#45) before inviting anyone.**

### Path A, step by step

1. **Not on the 1st or 2nd of a month. Not a Friday or Monday morning.** (Reasons under "Before you start".)
2. Do "Before you start" below: new `ADMIN_PASSWORD`, `SESSION_SECRET`, the tag.
3. **Apply the first 14 migrations, in the order in "All seventeen migrations"**, each with a dry run first. Expect the "still differ" warning on every one of them, the fourteenth included: staging also has the two for stage 13, and the warning after the fourteenth lists only those new columns on `users` and `profiles`. The old code keeps running normally throughout.
4. Merge:

```bash
cd ~/chocka-app && git checkout main && git pull --ff-only && git fetch origin
git tag pre-nov-merge
git merge --no-ff --no-edit origin/release/2026-11            # clean in rehearsal
rm -rf .next && npx tsc --noEmit && npm test && npm run build  # 921 tests
git diff --stat origin/stage8-value HEAD -- . ':!docs'         # must print nothing
git push origin main
```

5. Do **every "Verify" list** in stages 1 to 12 below, top to bottom, once. Then `/admin/pilot`, **Ready to invite shops? → Check now.**
6. The Netlify variables with a "when" of "a week after" or "a few days after" still apply, counted from this deploy.
7. Leave the other PRs open until you are happy; then see "Branches and PRs to tidy afterwards".

Do **not** use GitHub's "Squash and merge" on #63. A merge commit keeps the 33 PRs' history and lets GitHub see them as merged.

### Path B

Stages 1 to 12, in order, as written below.

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
| 12 | #61, #62 | 14 |
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

### The "still differ" warning: expect it on the first sixteen

Staging already has all seventeen migrations (the fourteen for #63 and the three for stage 13). So after **each of the first sixteen**, the script:

1. prints `applied and recorded`,
2. then prints `WARNING: production and staging still differ after applying:` followed by a list,
3. and exits with an error code.

**That is expected, every time.** The migration has been applied and recorded. The list is simply what staging still has that production does not. What to check is that the list **gets shorter each time** and contains only things from later migrations.

Only the seventeenth (`20261120090000_operator_rows_start_off`) ends with `identical across every probe`. If you stop early, the last one you apply still warns. **This has changed three times:** the tenth used to end cleanly, then the thirteenth, then the fourteenth. Now that staging also has the two for stage 13, **the fourteenth warns too**, listing only the new columns on `users` and `profiles` (five each). That is expected if you merge #63 before stage 13.

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
| `LIVE_REQUIRES` | **Leave unset** | Only to relax the definition | What counts as live beyond "connected". Unset means all of `matched,verified,access` (#55). Removing a word relaxes it, and "Ready to invite shops?" then shows a cross. A value with anything else in it is ignored. What a shop has switched on never comes into it (#69) |
| `BILLING_PRICE_PENCE_PER_SHOP` | Whole pence per live shop | Before the first statement | The price is deliberately not in the code: the repository is public (#58). Unset: the statement shows counts only |
| `BILLING_MONTHLY_CAP_PENCE` | Whole pence a month | Before the first statement | The monthly cap, as money (#61). Every live shop is listed; anything above the cap is one credit line. Not in the code either. Unset: no cap |
| `RETENTION_VIEW` | Leave unset, or `on` | After the privacy notice mentions it | `on` opens the retention view in `/admin/pilot` and starts recording when each shop last opened its dashboard: one date per shop (#62) |
| `MONTHLY_REPORT_PLAIN_SUMMARY` | Leave unset, or `on` | When you have read one | `on` opens the shop's monthly report with "what we did" and "what changed" in sentences (#62). Unset: the report is exactly as before |

`BILLING_MONTHLY_CAP_SHOPS` and `BILLING_MIN_LIVE_DAYS` from #58 **no longer exist** (#61). If you set either, remove it. A shop now counts for a month only if it is live on the month's last day.

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

Expected: all three end with the "still differ" warning, shorter each time. After the third it lists only `users.last_seen_at`, which is stage 12's.

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
git diff --stat origin/stage6-proof HEAD -- . ':!docs'        # must print nothing
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
- `BILLING_PRICE_PENCE_PER_SHOP` and `BILLING_MONTHLY_CAP_PENCE` before the first statement (the cap setting is from stage 12).
- The wording for Tarkett to send is in `docs/invite-wording.md`. Links for every shop: **Generate links for all N without one**, then **Download CSV**.

---

## Stage 12: decisions, and three things that show value (#61, #62)

#61 applies the decisions on what #54 to #60 left open. #62 adds a monthly summary to the console, a retention view to `/admin/pilot`, and a plain-words opening to the shop's monthly report. **Everything in #62 is behind a switch that is off.**

**One migration first:**

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261118090000_user_last_seen.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261118090000_user_last_seen.sql --confirm
```

Expected: **ends with `identical across every probe`** and a tick. It adds one empty column.

**Then merge:**

```bash
for n in 61 62; do gh pr edit $n --base main; done
git merge --no-ff --no-edit origin/stage7-decisions           # #61  clean
git merge --no-ff --no-edit origin/stage8-value               # #62  clean
rm -rf .next && npx tsc --noEmit && npm test && npm run build   # 921 tests
git diff --stat origin/stage8-value HEAD -- . ':!docs'        # must print nothing
git push origin main
```

In the rehearsal both merged with no conflicts and the result was identical to the tested tree.

**What changes the moment this is live, with no switch:**

1. **A shop we invited with no expected listing on record shows "Check listing"**, is not live, and has nothing done for it unattended until a person presses **This is right**. That includes any such shop that is *already connected*: the daily check will move it to "Check listing" within a day. **Before this stage, look at "Ready to invite shops?": it says how many shops have no expected listing. If any of them is already connected, be ready to confirm it the next morning.**
2. **The statement counts a shop only if it is live on the month's last day.** The month in progress is marked provisional.
3. **The cap is money**, from `BILLING_MONTHLY_CAP_PENCE`. Remove the two old settings if you set them.
4. "Too few to say" for ads is now under 10 customer actions in the four weeks before, not 20.

**Verify:**

1. `/admin/pilot`, **Ready to invite shops? → Check now.** "When a shop last opened its dashboard" has a tick. The retention view and the plain summary both say **Off**.
2. **Live shops in a month**: the current month says **provisional**. With no price set it shows counts only.
3. **Which shops are not getting much from this? → Show** says the view is switched off.
4. `/console/summary` is a 404 (the console is still off).

**The last day of each month matters now.** The count of live shops is taken by the hourly job. If that job did not run at all on the last day of a month, the statement for that month says so in red and counts nobody, rather than guessing. Check the job's log on the 1st.

**Before switching anything on:**

- `RETENTION_VIEW`: recording when a shop last opened its dashboard is a new use of its data, however small. Add the line to the privacy notice first (it is on the solicitor's list).
- `MONTHLY_REPORT_PLAIN_SUMMARY`: switch it on in the week before a month end and read the first few reports that go out.
- The console summary comes with `TARKETT_CONSOLE_ENABLED`; the privacy checklist for the console covers it.

---

## Stage 13: the retention build (#64, #65, #66, #67, #68, #69)

Six PRs, stacked in this order, each on top of the one before and the first on top of the release branch:

| PR | What | Behind a switch? | Migration first |
|---|---|---|---|
| #64 | Hands-off mode: the shop chooses once, with Pause | **Off** until `HANDS_OFF_MODE=on` | `20261119090000_automation_mode` |
| #65 | Tell every shop about every new review; read the switched-off emails in `/admin/pilot` | **Off** until `REVIEW_ALERT_EMAILS=on` | none |
| #66 | Compare with the same weeks last year, not the weeks before | No switch | none |
| #67 | Review card as a print-ready A6 PDF, and one file of all of them | No switch (a download) | none |
| #68 | Network rating and share of reviews answered in the monthly summary | Comes with the console switch | `20261119100000_review_snapshot` |
| #69 | Live shops with nothing switched on are flagged; the cap belongs to a term; the proof run and review fixes | No switch | none |

**Three migrations first** (two only add empty columns, the third adds one database rule; all are on staging):

```bash
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261119090000_automation_mode.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261119090000_automation_mode.sql --confirm
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261119100000_review_snapshot.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261119100000_review_snapshot.sql --confirm
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261120090000_operator_rows_start_off.sql
/usr/local/bin/python3.14 scripts/apply-migration-to-production.py 20261120090000_operator_rows_start_off.sql --confirm
```

Expected: the first two warn that staging and production "still differ" (later ones are still to come); the third **ends with `identical across every probe`** and a tick. The code that is live before this stage runs normally on both.

**Then merge.** After #63 (or stage 12) is on `main`:

```bash
cd ~/chocka-app && git checkout main && git pull --ff-only && git fetch origin
git tag pre-retention-merge
for n in 64 65 66 67 68 69; do gh pr edit $n --base main; done
git merge --no-ff --no-edit origin/retention/6-live-and-term     # all six: they are one line of commits. Clean in rehearsal
rm -rf .next && npx tsc --noEmit && npm test && npm run build     # 1,109 tests
git diff --stat origin/retention/6-live-and-term HEAD             # must print nothing
git push origin main
```

To take them one at a time instead, merge `origin/retention/1-hands-off`, then `2-stop-silence`, `3-last-year`, `4-review-card`, `5-network-rating`, `6-live-and-term`, in that order. Each is a fast step on from the one before; none conflicts. Do not merge a later one without the earlier ones: they are stacked.

**Or everything in one release.** If you would rather release #63 and these together: merge `origin/retention/6-live-and-term` into `release/2026-11` on your machine, push that branch, and follow path A with **seventeen** migrations instead of fourteen. In rehearsal, `main` + #63 + the six merged with no conflicts and the result was file-for-file the tree every check below ran against.

**What changes the moment this is live, with no switch:**

1. **Live, and so billable, is: connected, the right listing, verified by Google, access working.** It does **not** depend on what the shop has switched on, and pressing Pause does not stop it; only disconnecting (or losing access) does. (Decided 20 November. An earlier version of #69 made a shop with nothing on "not live"; that was reversed before release.)
2. **A live shop with nothing switched on is still shown.** It is listed under Needs help as **Nothing switched on** (or **Paused by the shop**), with what to say to it, and the console's monthly summary counts "live, with nothing switched on" separately. Nothing in the app, and no button in `/admin/pilot`, switches anything on for a shop. `LIVE_REQUIRES` keeps its three words; leave it unset.
3. **The cap is only applied inside its term.** With `BILLING_MONTHLY_CAP_PENCE` set and no term dates, **the cap is not applied**, the statement says so in red, and "Ready to invite shops?" shows a cross. Set `BILLING_TERM_START` and `BILLING_TERM_END` (below) before the first statement.
4. **Every comparison is now with the same weeks last year**: the league, the ad view in the console and in the shop's monthly email, the network summary, and the plain-words monthly report (if that switch is on). A listing with nothing from last year falls back to the old comparison and says so. The league does not rank such a shop.
5. **A rise or a fall needs at least three more (or fewer) customer actions**, as well as ten in the earlier period. Ten to eleven is no longer a "clear rise".
6. **The hourly figures job also notes each listing's review totals** (rating, count, how many answered). One more read of the listing's reviews per shop per day. No review text is stored.

**New variables. All optional, none with a default:**

| Variable | Value | When | Why |
|---|---|---|---|
| `HANDS_OFF_MODE` | Leave unset | **Only after the solicitor has seen `docs/hands-off-wording.md`, and after your own test** | `on` offers each connecting shop the choice of Hands-off or Ask me first, and for a shop that chose Hands-off, posts and replies go out without further approval (#64). Unset: every shop is asked first, as now |
| `REVIEW_ALERT_EMAILS` | Leave unset | **After your own test, below** | `on` emails every connected shop about each new review, whether or not replies are on (#65). Unset: as now |
| `EARLY_POST_PREVIEW_EMAILS` | Leave unset | **After your own test, below** | Already existed (#35). `on` emails a shop 24 hours before a post that is waiting for its approval |
| `BILLING_TERM_START` | The first day of the term, like `2027-01-31` | Before the first statement, if a cap is set | The cap and its credit line apply only to months that **end** on or between the two dates (#69). Not in the code: the repository is public |
| `BILLING_TERM_END` | The last day of the term | With the one above | After it, the statement has no cap and no credit line, and says the term has ended |

**Verify:**

1. `/admin/pilot`, **Ready to invite shops? → Check now.** "Hands-off or ask me first, and Pause" and "Review totals per listing" both have a tick. "Hands-off mode" and "Email every shop about every new review" both say **Off**. "Monthly statement" says whether the term is set.
2. The shop table has a **How we work** column. Every connected shop reads "Ask me first (not chosen yet)" with what it has switched on.
3. **Needs help**: any live shop with nothing on is listed as **Nothing switched on**. It is still **Live** in the shop table and still on the statement.
4. **Live shops in a month**: with a cap and a term set, "The cap applies for the term ...". With a cap and no term, a red line saying the cap has not been applied.
5. **Review cards for the counter → Download all cards (PDF)**: a file with one A6 page per connected shop. Scan one with a phone.
6. **Read the emails that are switched off**: each of the five opens with made-up content.
7. Sign in as a shop: Settings looks as it did (the "How we work" card only appears with `HANDS_OFF_MODE=on`).
8. The day after: `/console/summary` (if the console is on) shows "Reviews, across the network" once three live shops have reviews.

### Switching on the two "silence" emails, after your own test

Both are off. **Do not switch either on until you have done this once, on your own listing** (the one from `docs/test-listing-runbook.md`), with no other shop connected or with the other shops' owners warned.

1. **Read them.** `/admin/pilot` → **Read the emails that are switched off**. Read all five. If any wording is wrong, stop here.
2. **The preview email.** Set `EARLY_POST_PREVIEW_EMAILS=on` and redeploy. On your test shop, switch posts on and wait for a post to be written (Friday morning), or use one that is already waiting. Within an hour of the post being less than 24 hours away you should get **one** email, "Approve your Google post", with two buttons. Press Approve: the page asks you to confirm, and only the confirm button approves. Check you get the email once, not hourly.
3. **The review alert.** Set `REVIEW_ALERT_EMAILS=on` and redeploy. With replies **off** on your test shop, leave a review on your own listing from another Google account. Within 15 minutes (working hours) you should get **one** email saying there is a new review and that nothing was replied. Check on Google that nothing was replied. Then switch replies on and leave another: the email should show the reply we posted, and it should be on Google.
4. **A low review.** Leave a 2-star review with replies off. You should get the "needs your input" email with the holding reply and two buttons, and **nothing on Google** until you press Publish.
5. If all of that is right, leave both on. If anything is not, set the variable back to unset and redeploy: nothing else changes.

What switching `REVIEW_ALERT_EMAILS` on does to the review job: it now looks at **every** connected shop every 15 minutes, not only those with replies on. At 92 shops that is within what the job can cover in a day (see `docs/scale-check.md`). Watch its log on the first day for "checked N of M shops this run".

### Switching on hands-off mode

Not until:

1. the solicitor has reviewed `docs/hands-off-wording.md` (it has four questions for them), and the wording version has been changed if the words change;
2. `SESSION_ACCEPT_LEGACY_COOKIE=false` is set. Until it is, the app refuses to record a hands-off choice at all, because a session could be forged;
3. you have chosen Hands-off on your own test listing and watched one post and one low review go through, then pressed Pause, then chosen "Ask me first".

Then `HANDS_OFF_MODE=on`. It changes nothing for a shop until that shop chooses. Switching it off again is safe: a shop that chose Hands-off is treated as "Ask me first", and a post booked for it among its first three goes back to waiting.

---

## All seventeen migrations, in order

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
| 14 | `20261118090000_user_last_seen.sql` | #62 | 12 |
| 15 | `20261119090000_automation_mode.sql` | #64 | 13 |
| 16 | `20261119100000_review_snapshot.sql` | #68 | 13 |
| 17 | `20261120090000_operator_rows_start_off.sql` | #69 | 13 |

The seventeenth adds one database rule: an account created through an operator account (a shop a rep sets up) starts with posts and replies **off**, whatever the insert says, until a mode is chosen. It changes no existing row.

All seventeen only add things or tighten access. Each is on staging already. **On path A, apply the first fourteen, in this order, before merging #63.** The last two go on before stage 13 (or with the others, if you release everything at once).

## The documents and the legal PRs

- **#41** (this runbook), **#45** (`docs/test-listing-runbook.md`) and **#51** (`docs/README.md`, the index of documents) change no code and can be merged at any time. **Run the test in #45 before stage 1 if you can:** its first step is the real model call that #24 is waiting on.
- **#30** (legal drafts) and then **#44** (the solicitor briefing, which sits on #30): only after the solicitor. #30 changes the live privacy and terms pages, not only documents.

**One migration to leave alone:** `20261116110000_change_log_add_media.sql` (in #39). Do not apply it anywhere, staging included, until all seventeen above are on production. It changes an existing constraint rather than adding something, and applying it early makes the production script refuse everything after migration 1. It is only needed if listing photos are ever switched on. The file explains this at the top.

---

## Branches and PRs to tidy afterwards

Nothing here has been deleted or closed. This is a list for you, for after the release is live and you are happy with it.

**If you took path A (#63):** GitHub marks a PR as merged when its commits reach its base branch. Most of these PRs are based on each other, not on `main`, so they will stay "open" with nothing left to merge. For each, either change its base to `main` (`gh pr edit <n> --base main`), which lets GitHub mark it merged, or close it with a note pointing at #63.

| PRs | State after path A |
|---|---|
| #24 to #29, #31 to #40, #42, #43, #46 to #50, #52 to #62 (33 code PRs) | Superseded by #63: all of their commits are in it |
| #41, #45, #51 (documents) | Superseded by #63: included |
| #30, #44 (legal drafts, solicitor briefing) | **Not included. Still open on purpose**, until the solicitor has been through them. #30 changes the live privacy and terms pages |

**If you took path B:** #63 is superseded. Close it.

**Branches no PR points at, safe to delete once the release is in `main`:**

| Branch | What it was |
|---|---|
| `integration/nov-2026`, `-b`, `-c`, `-d` | Stepping stones the stacked PRs were based on. All four are contained in the release |
| `feat-invite-sending` | August work on sending invitations from the app, never opened as a PR. **Not in the release, and not wanted as it stands:** invitations are sent by Tarkett, not by us. Keep it only if you want the code for reference |
| `release/2026-11` | The release branch, once #63 is merged |
| Already merged into `main` long ago: `fix-invite-token-percent-decode`, `fix-invite-token-whitespace`, `gate-stellar-login-without-invite`, `retailer-invite-engine`, `slice-2`, `stellar-copy-price-sweep`, `stellar-cron-entitlement`, `stellar-match-verification`, `stellar-no-stripe`, `stellar-tenant-resolution` | Old PR branches |

**On your machine only (never pushed), safe to delete:** every branch starting `rehearsal/`, plus `dummy-run/2026-11-16` and `test/all-2026-11-16`. The older planning branches (`slices-0-1`, `slice-2-plan`, `slice-3`, `slice-3-plan`, `slice-4-plan`, `multi-tenant-plan`, `stellar-landing`) are from the summer; look before deleting.

---

## If something goes wrong

- **A deploy misbehaves.** Netlify, Deploys, pick the last good one, "Publish deploy". That is instant and touches nothing else. Then tell me what you saw.
- **Undo a merge that has been pushed.** `git revert -m 1 <the merge commit>` and push. Do not reset or force-push main.
- **Migrations stay.** All seventeen only add things (tables, columns, indexes) or tighten access. Old code runs fine against them, so a code rollback never needs a database rollback.
- **A merge conflict that is not described above.** Stop: `git merge --abort`. The rehearsal had exactly three conflicted merges (#27, #29, #36), none in stages 11 or 12, and none on path A. Anything else means a branch has changed since 18 November.

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
