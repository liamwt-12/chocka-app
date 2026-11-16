# Test-listing runbook: one full pass on your own Google listing

Written 16 November 2026. **Nobody has run this yet.** It is written from the code, so treat the first run as a test of the runbook as well as of the product, and tell me where it was wrong.

## What this is, and the rules

One pass through the whole service, end to end, on **your own Google Business Profile**. It answers the questions that mocked tests cannot: does the model call work, does Google accept what we send, how far back does the history go, does undo really undo.

- **Only ever your own listing. Never a Tarkett shop.**
- **Staging database only.** The app runs on your Mac and talks to the staging database. Production is not touched.
- **It makes real changes to your real listing.** Your description, services and hours may change, a post will be published, a review may get a reply. Step 9 puts all of it back. If you would rather not risk your main listing, use a spare one you own.
- **Messages go only to you.** The staging database has nobody else in it. Step 0.6 checks that.

**Time:** about two hours of your attention. Two steps may need you to wait for Google (marked).

**There is no staging website.** Staging is a database. That is why the app runs on your Mac for this.

### What each step proves

| Step | Proves | Answers the open question from |
|---|---|---|
| 1 | The AI model call works with your key | PR #24 |
| 2, 3 | Invite link, sign-in, listing choice, onboarding, change log | #25, #26, #31, #36, #38 |
| 3 | How far back Google's history really goes; unverified-listing handling | #33, #36 |
| 4 | A post reaches Google, after approval | #29, #35 |
| 5 | A reply reaches Google; low-star replies wait for you | #27, #35, #42 |
| 6 | A photo is cleaned, approved, and Google accepts it on a post | #39 |
| 7 | The monthly report's numbers are right | #28, #33, #34 |
| 8 | Undo really undoes | #26 |
| 9 | Everything is put back, including photo files | #43 |

Fill in the results table at the bottom as you go.

---

## Step 0: Setup (once)

### 0.1 Get the code with everything in it

Nothing here touches `main`.

```bash
cd ~/chocka-app
git fetch origin
git checkout -B test/all origin/fix-review-findings
npm ci
rm -rf .next && npx tsc --noEmit && npm test && npm run build
```

That one branch is the top of the stack: it already contains every code PR (#24 to #53, without the legal ones).

**Pass:** the last line finishes without an error (609 tests when written).
**Fail:** a failing test or a build error. Stop and tell me.

### 0.2 A settings file for staging

The app reads its settings from `.env.local`. Yours may point at production. **Put it safely aside first:**

```bash
mv .env.local .env.production-backup.local
```

Then create a new `.env.local` with the values below. Keep it out of git (it is ignored already).

| Setting | Value for this test |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pauwvdntclmxlcettfgc.supabase.co` (staging) |
| `SUPABASE_SERVICE_ROLE_KEY` | From the Supabase dashboard, project **chocka-staging**: Project Settings, API, `service_role` |
| `STELLAR_APP_URL` | `http://stellar.localhost:3000` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The same ones the live app uses (Google Cloud project `map-boost-app`) |
| `GOOGLE_PLACES_API_KEY` | The same one the live app uses |
| `ANTHROPIC_API_KEY` | A key that is **not** the production one, if you have one. Otherwise the real one: the cost of this test is pennies. |
| `SECRET_ENCRYPTION_KEY` | A new random value, **not** production's: `openssl rand -hex 32` |
| `CANCEL_HASH_SECRET`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_PASSWORD` | A new random value each: `openssl rand -hex 24`. Note the last two down, you type them later. |
| `RESEND_API_KEY` | The real one. Needed for step 7 only. Every email goes to you (see 0.6). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Optional. With them, you get real texts on your own phone. Without them, texts fail quietly and everything else works. |
| `SHOP_PHOTOS` | `on` (staging only, for step 6) |
| `SHOP_PHOTOS_TO_LISTING`, `EARLY_POST_PREVIEW_EMAILS`, `TARKETT_CONSOLE_ENABLED` | **Leave out.** They stay off. |

### 0.3 THE SAFETY CHECK. Do not skip it.

```bash
grep -o 'https://[a-z]*\.supabase\.co' .env.local
```

**Pass:** it prints exactly `https://pauwvdntclmxlcettfgc.supabase.co`.
**Fail:** anything else, especially `emilonrdyljbydtgrvof`. **That is production. Stop.** Fix the file before going any further.

### 0.4 Let Google send you back to your Mac

In Google Cloud console, project `map-boost-app`: APIs and Services, Credentials, the OAuth client, "Authorised redirect URIs". Add:

```
http://stellar.localhost:3000/api/auth/callback/google
```

**This is the least certain step in the runbook.** Google is strict about addresses that are not `https`. If it refuses to save that address, stop here and tell me: the fallback is a Netlify branch deploy pointed at staging, which I will write up.

### 0.5 Start the app

```bash
npm run dev
```

Open **http://stellar.localhost:3000** (not plain `localhost`: the `stellar.` is what makes it Stellar Local rather than Chocka).

**Pass:** the Stellar Local sign-in page, in Stellar's colours.
**Fail:** Chocka's page (you used plain `localhost`), or an error page (a setting in 0.2 is missing: the Terminal window running `npm run dev` says which).

Leave that Terminal window running. Use a second one for commands.

### 0.6 Check staging is empty

In the Supabase dashboard, project **chocka-staging** (check the address bar contains `pauwvdntclmxlcettfgc`), SQL Editor:

```sql
select (select count(*) from users) as users, (select count(*) from retailers) as retailers,
       (select string_agg(slug, ', ') from tenants) as tenants;
```

**Pass:** `users` 0, `retailers` 0, `tenants` reads `chocka, stellar`. (I added those two tenant rows on 16 November; the app cannot start a sign-in without them.)
**Fail:** any users or retailers already there. Tell me before continuing: a cron run would message whoever they are.

### 0.7 Write down what your listing looks like now

Open your listing at business.google.com and screenshot: the description, opening hours, services, categories, and your list of posts and reviews. Step 8 is checked against these.

---

## Step 1: The AI model call (PR #24)

The model the app used was retired in June. PR #24 moves to a current one. This makes one real call through the app's own code.

```bash
npx tsx --env-file=.env.local -e "import('./lib/ai.ts').then(async (m) => { console.log(await m.generatePost({ businessName: 'Test Flooring', category: 'Flooring shop', city: 'Leeds', month: 'November', season: 'autumn', recentPosts: [] })); }).catch((e) => { console.error('FAILED:', e.message); process.exit(1); })"
```

**Pass:** two or three sentences of a plausible Google post, in British English, with no price, phone number or web address.

**Fail, and what each one means:**

| It prints | Meaning | What to do |
|---|---|---|
| `authentication_error` or `invalid x-api-key` | The key in `.env.local` is wrong | Fix the key. Nothing is wrong with the code. |
| `not_found_error` mentioning the model | Your Anthropic account cannot use `claude-sonnet-5-5` | Add `ANTHROPIC_MODEL=<a model your account has>` to `.env.local` and run again. Tell me which one worked. |
| `invalid_request_error` mentioning `thinking` | The no-thinking setting in PR #24 is not accepted | **Tell me, with the exact message.** This is a real bug in #24 and must be fixed before it is merged. |
| `returned no text (stop_reason: max_tokens)` | The model spent its allowance thinking | Same: tell me. A real bug in #24. |
| `AI content validation failed after retry` | The model wrote something the safety checks refused, twice | Run it again. If it happens three times running, tell me what the warnings above it said. |
| `credit balance` or `billing` | The Anthropic account has no credit | Top it up. |

**Do not go on to step 3 until this passes.** Onboarding needs it.

---

## Step 2: Add your shop and make an invite link

1. Open http://stellar.localhost:3000/admin/pilot and enter the `ADMIN_PASSWORD` you set.
2. "Add a shop Tarkett has given you": your business name and town. Add.
3. Tick your shop, "Generate links for 1 selected". **Copy the link now.** It is shown once.

**Pass:**
- The shop appears with "Not invited", then "Link issued" after step 3.
- The "Google connection" column reads as invited.
- The link starts `http://stellar.localhost:3000/invite/`.
- No email arrived. Nothing here sends anything.

**Fail:** "Stellar tenant not found" (the tenant rows from 0.6 are missing), or the link starts `https://app.stellarlocal.co.uk` (`STELLAR_APP_URL` is not set; a link like that would take you to the live site, so do not open it).

**Also check here (PR #40):** the "Review link" column says "No listing yet". Correct: a shop added by hand has no Google listing on record until it connects.

---

## Step 3: Onboarding

Open the invite link **in the same browser**.

| On screen | Do | Check |
|---|---|---|
| Invite page | Continue to Google | |
| Google's consent screen | Choose the Google account that manages your listing. Allow. | It names "Stellar Local". |
| "Which listing is yours?" (only if you manage several) | Pick your own | |
| "Analysing your Google profile" | Wait about 15 seconds | It reaches a score rather than an error. |
| Score | "See What We Can Fix Right Now" | The items listed match what is really missing from your listing. |
| **"Make it sound like you"** (PR #38) | Pick a tone. Type a sign-off, for example "Liam and the team". Add one word to avoid. Continue. | Try typing a phone number in the description first: it must be refused with a plain message. |
| "Here's what we'll fix" | **Read every word.** Edit anything you would not want public. | The post and the reply sample end with your sign-off and avoid your word. No prices, no "best in", no accreditations. The reply sample is for a 4 or 5 star review, never lower. |
| "Ready?" | Apply These Changes | The list matches the previous screen. |
| "Nearly there" | Your own mobile. Turn **both** switches on. Continue. | |
| "Fixing your profile" then "Sorted." | Go To Dashboard | |

**Pass, on Google** (give it a few minutes; Google can hold an edit for review, sometimes for a day):
- Your description, services, categories and hours now show what you approved.
- Unanswered 4 and 5 star reviews (up to 20) have a reply. **No 1 to 3 star review has a reply.**
- **No post has appeared yet.** The first post is waiting for approval.

**Pass, in the staging database** (SQL Editor):

```sql
select action, target, status, source, created_at from change_log order by created_at;
select status, scheduled_for, left(content, 80) as content from scheduled_posts;
select connection_status, connection_detail, voice_profile is not null as has_voice from retailers;
select count(distinct date) as days, min(date) as earliest, max(date) as latest from daily_metrics;
select metrics_history_start, metrics_backfilled_at from profiles;
```

- `change_log`: one row per change, every one `applied`, source `onboarding`.
- `scheduled_posts`: one row, status `awaiting_approval`.
- `retailers`: `connected`, and `has_voice` true.
- `daily_metrics`: **write down `earliest`.** This is the answer to "how far back does Google really go" from PR #33. Up to about 18 months is expected; if it is much less, tell me the date.

**Also pass:** back in `/admin/pilot`, your shop is "Live", the "Voice" column says "Set, edit", and the "Review link" column now has "Copy link" and "Card" with **no** "check first". Open the card and **scan it with your phone**: it must open the review page for your own business. Print one if you like.

**Fail:**
- An error after the Google consent screen: the address in 0.4 was not saved exactly.
- "No Google Business Profile found": you chose a Google account that does not manage the listing.
- A `change_log` row with status `failed`: its `error` column says what Google refused. Tell me.
- A reply on a 1 to 3 star review. **That is the most serious failure in this runbook. Stop and tell me.**
- If your listing is unverified, the connection reads "waiting on Google" instead of connected. That is correct behaviour, and answers the open question from PR #36: note exactly what it said.

---

## Step 4: One post

Your first three posts need your approval. The email that would ask you is switched off, so for this test you approve in the database, which is what pressing the button does.

1. Approve it and make it due now (staging SQL Editor):

   ```sql
   update scheduled_posts set status = 'pending_approval', approved_at = now(), scheduled_for = now()
   where status = 'awaiting_approval' returning id, left(content, 80);
   ```

2. Run the publisher (second Terminal window; replace the secret with yours):

   ```bash
   curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/post-publisher
   ```

**Pass:** it answers `{"success":true,"published":1}`. Within a few minutes the post is on your Google listing, word for word what you approved. `change_log` has a new `create_post` row, `applied`.

**Check the guard too.** Before step 1, run the `curl` once: it must answer `"published":0`. A post that has not been approved must never go out.

**Fail:**
- `Unauthorized`: the secret does not match `CRON_SECRET` in `.env.local`.
- `"published":0` after approving: the Terminal running the app shows why. Usually Google refused the post; the message is there.

---

## Step 5: One reply

Pick whichever of these your listing allows. **A** costs nothing; **B** and **C** need a new review.

**A. Already done in step 3.** If you had unanswered 4 or 5 star reviews, onboarding replied to them. Read each reply on Google.
**Pass:** warm, short, uses the reviewer's first name, ends with your sign-off. Nothing about refunds, fault, discounts or prices.

**B. A new 4 or 5 star review.** Ask a friend to leave one. Then:

```bash
curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/review-alerts
```

**Pass:** `"processed":1`, and the reply is on Google within minutes. You may get a text.

**C. A new 1 to 3 star review** (ask a friend, and have them delete it afterwards). Run the same command.

**Pass:**
- **Nothing appears on Google.**
- You get an email to approve or decline (this is your own listing's alert, to you).
- Your dashboard at http://stellar.localhost:3000/dashboard shows **"Replies waiting for you"** (PR #42) with the review and this exact reply: "Thank you for your feedback, [first name]. We're sorry to hear your experience wasn't what you hoped for. We'd like to understand more, so please contact us directly and we'll look into it."
- Press "Approve this reply". A page asks you to confirm. Only after you press its button does the reply appear on Google.

**Fail:** any reply on a low-star review before you approved it. Stop and tell me.

**Worth knowing:** reviews more than 14 days old are never replied to by this check. If you run it and `"processed":0` comes back with old reviews on the listing, that is the rule working.

---

## Step 6: A photo (staging only; the flag stays off everywhere else)

Use a photo taken on your phone **with location switched on**, so there is something to remove. Send it to your Mac without stripping it (AirDrop keeps the location; some messaging apps remove it).

1. **Check the original has a location.** Open it in Preview: Tools, Show Inspector, the "GPS" tab. If there is no GPS tab, pick a different photo.
2. `/admin/pilot`, your shop's "Photos" column, "Generate an upload link". Copy it.
3. Open the link. Choose the photo. **Pass:** "Saved".
   Also try a file that is not a photo (a PDF renamed to `.jpg`). **Pass:** refused with "Photos need to be JPEG or PNG files."
4. Back in the Photos panel: the photo shows as "Waiting for a decision".
5. **Check the stored copy is clean.** Supabase dashboard, chocka-staging, Storage, `shop-photos`, your shop's folder: download the file. Open it in Preview, Show Inspector.
   **Pass: no GPS tab at all**, no camera model, and the photo is the right way up.
   **Fail:** a GPS tab. Stop, tell me, and delete the file.
6. **Check it is not used before approval.** The generator writes one post a week, and you published one in step 4, so first tell the database that post was last week's (staging SQL Editor):

   ```sql
   update scheduled_posts set scheduled_for = now() - interval '8 days' where status = 'published';
   ```

   Then run the generator:

   ```bash
   curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/post-generator
   ```

   and look: `select status, photo_id from scheduled_posts order by created_at desc limit 1;`
   **Pass:** `"generated":1`, the new post is `awaiting_approval`, and its `photo_id` is **empty**: an unapproved photo is never used.
7. Delete that test post: `delete from scheduled_posts where status = 'awaiting_approval';`. **Approve** the photo in the Photos panel. Run the generator again.
   **Pass:** the new post's `photo_id` is filled in.
8. Approve and publish as in step 4 (the `update`, then the publisher).
   **Pass:** the post is on Google **with the photo**.
   **Also a pass, but tell me:** the post is on Google **without** the photo, and the app's Terminal says "Google refused the photo, publishing as text". That means Google will not fetch from our storage address, which is the open question from PR #39, and I need to change how the photo is handed over.

**"Add to Google listing" must not appear** on any photo. That needs a second flag, which stays off.

---

## Step 7: The report

1. Bring the stored figures up to date:

   ```bash
   curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/metrics-sync
   ```

2. Optional, to see the "change during your ads" section: in `/admin/pilot` set "Ads started" for your shop to a date about five weeks ago.
3. Send the monthly report. **This emails you**, and texts you if Twilio is set:

   ```bash
   curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/monthly-report
   ```

**Pass:**
- One email, to you, from Stellar Local, for last month.
- Its views, calls, direction requests and website clicks match your listing's own Performance page in Google for the same month, to within a few. **They must not be about four times too high**: that was the bug PR #33 fixed.
- A presence score between 0 and 100.
- The ads section says "not enough history" or "too early" rather than inventing a number. With one shop there is nothing to compare against, so that is the right answer.

**Fail:** numbers that do not match Google's; a report with figures for a month where the database holds fewer than 20 days (it should say "not yet"); more than one email.

---

## Step 8: Undo

This is the promise in the terms: every change is logged and can be put back.

1. Find your listing's name: `select google_location_name from profiles;` (it looks like `locations/1234567890`).
2. **Dry run first.** Nothing is written:

   ```bash
   npx tsx --env-file=.env.local scripts/revert-listing-change.ts --location locations/YOURNUMBER --since 2026-11-16
   ```

   **Pass:** the first line says `Database: pauwvdntclmxlcettfgc.supabase.co`. Then a plan, newest change first: delete each post, delete each reply we wrote, restore the description, services, categories and hours to their earlier values. Read it against your screenshots from 0.7.
   **Fail:** a different database on the first line. Stop.

3. If the plan is right, do it:

   ```bash
   npx tsx --env-file=.env.local scripts/revert-listing-change.ts --location locations/YOURNUMBER --since 2026-11-16 --confirm
   ```

**Pass, on Google** (again, allow a few minutes):
- The posts from steps 4 and 6 are gone.
- The replies we wrote are gone. **The reviews themselves are untouched.**
- The description, services, categories and hours match your screenshots.
- A field that was empty before is empty again.

**Expected and fine:** a line saying a change was skipped because "previous reply not known; check the review by hand". That is the reply you approved from the dashboard in step 5C; delete that reply on Google yourself.

**Fail:** anything on the listing that does not match your screenshots. Tell me which field. Then fix it by hand in Google.

---

## Step 9: Put everything back

In this order.

1. **Check the listing by eye** against the screenshots, once more. Fix anything left by hand.
2. **Delete the test account**, which also tests PR #43: http://stellar.localhost:3000/settings, delete account (it asks you to type DELETE).
   **Pass:** in Supabase staging, Storage, `shop-photos`: **your shop's folder is empty or gone.** And `select count(*) from shop_photos;` is 0.
   **Fail:** the photo file is still there. Tell me, then delete it by hand in the dashboard.
3. **Remove the app's access to your Google account:** myaccount.google.com, Security, "Your connections to third-party apps and services", Stellar Local, remove.
4. **Empty staging** (staging SQL Editor; check the address bar first):

   ```sql
   delete from retailer_invites; delete from retailers; delete from change_log;
   select (select count(*) from users) as users, (select count(*) from retailers) as retailers;
   ```

   **Pass:** both 0. Leave the two tenant rows.
5. **Remove the test address from Google Cloud** (the one added in 0.4), unless you will run this again soon.
6. **Stop the app** (Ctrl+C in its Terminal window) and **put your settings back:**

   ```bash
   mv .env.local .env.staging.local
   mv .env.production-backup.local .env.local
   grep -o 'https://[a-z]*\.supabase\.co' .env.local     # back to what it was
   ```

   Keeping `.env.staging.local` saves the setup next time. It is ignored by git.
7. **Leave the test branch:** `git checkout main`. Delete it with `git branch -D test/all` when you are finished.
8. If a friend left a low-star test review, ask them to delete it.

---

## Results (fill in and send back)

| Step | Pass / fail | Notes |
|---|---|---|
| 0.4 Google accepted the local address | | |
| 1 Model call | | Model used: |
| 2 Invite link | | |
| 3 Onboarding | | Earliest date in `daily_metrics`: |
| 3 Unverified listing message (if it applies) | | Exact wording: |
| 3 Review card scanned | | |
| 4 Post, and the not-approved check | | |
| 5 Reply (A / B / C) | | |
| 6 Photo stored without location | | |
| 6 Photo on a Google post | | With photo / as text: |
| 7 Report numbers match Google | | Ours vs Google's: |
| 8 Undo | | Anything not restored: |
| 9 Photo files deleted with the account | | |

## What this run does not cover

- **A Tarkett rep adding us as a manager** (the route most shops will use). That needs a second Google account and is in `TEST_MATRIX.md`.
- **The emails to shops that are switched off** (the preview for posts awaiting approval). Step 4 approves in the database instead.
- **The Tarkett console**, which stays off.
- **The weekly text and the Friday preview** for a shop past its first three posts.
- **Scheduled timing.** Every job here is run by hand; whether Netlify runs them on time is checked in the merge runbook.
