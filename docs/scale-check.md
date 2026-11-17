# Scale check: the scheduled jobs at 10, 180 and 500 shops

Run 16 November 2026. Updated the same day when the monthly report was fixed (the last section).

## The short version

**Before these fixes, four of the scheduled jobs would have quietly stopped working somewhere between 17 and 75 shops.** They work through shops one at a time, each shop takes one to three and a half seconds, and Netlify stops a job after 60. Whoever was not reached got nothing: no post, no weekly text, no review check. No error, and always the same shops.

| Job | Shops reached before it is cut off (before) | At 180 shops, before | At 180 shops, now |
|---|---|---|---|
| Weekly post writer | **about 17** | 163 shops get no post, every week | All 180, over 2.5 hours on Friday morning |
| Weekly stats text | about 43 | 137 shops get no text | All 180, within an hour on Monday |
| Daily review check | 42 to 75 | Over 100 shops never checked | All 180 checked through the day |
| Post publisher | 40 per run (its own cap) | Works, but raised false failure alerts | Works, no false alerts |
| Monthly report | about 35 | 145 shops get no report | All 180, within an hour and a quarter on the 1st (fixed separately: see the last section) |
| Figures sync, onboarding texts, approval previews | No limit reached | Fine | Fine |

The pilot is small, so none of this would have bitten on day one. It would have bitten well before 180.

## How it was measured

The real job code, run against simulated shops (`scripts/scale-check/`). Nothing real is touched: the database is in memory, Google and the model are fakes, and time is virtual. Each kind of call is charged a fixed cost, and the simulation adds them up, counting calls made side by side as overlapping. So the answer is how long a run **would** take, worked out in seconds, and it is the same every time.

To run it: `npx vitest run --config scripts/scale-check/vitest.config.ts`

### What I assumed

**Netlify's limits**, read from Netlify's documentation on 16 November 2026:

| Kind of function | Limit |
|---|---|
| A normal function, which is what each job's code runs as | **60 seconds** |
| A scheduled function, which is what starts each job | 30 seconds |
| A background function (not used yet) | 15 minutes |

There is a third limit of our own: the scheduled function that starts a job waits **25 seconds** for an answer (`netlify/shared/run-cron.mts`) and then raises a failure alert, although the job itself carries on to 60.

**How long each call takes:**

| Call | Assumed |
|---|---|
| One database request | 45 ms |
| Google: exchanging the stored credential | 250 ms |
| Google: one read | 300 ms |
| Google: publishing a post or reply | 450 ms |
| Google: one performance-figures request | 600 ms |
| The AI model writing one post or reply | 3,000 ms |
| Sending one email | 250 ms |
| Sending one text | 350 ms |

These are reasonable middle figures, not measurements. The model time matters most; if real posts take five seconds instead of three, the post writer reaches four per run instead of six.

**The database figure assumes the functions run in the same region as the database.** The database is in Ireland. Netlify's default region is the eastern United States, and changing it needs a Pro plan. If the functions are in the US, each database request takes about 90 ms longer, which adds roughly half a second per shop to the post writer and the weekly text. The time budgets below adjust by themselves: fewer shops per run, more runs. **Worth checking which region the site's functions are in.**

**Google's quota** is assumed to be the default 300 requests a minute for the Business Profile APIs, shared by every shop and both brands, because there is one Google project.

## Time per shop

| Job | Per shop | What the time goes on |
|---|---|---|
| Weekly post writer | **3.5 s** | One piece of writing from the model (3 s), one email, five database requests |
| Monthly report | 1.7 s | Seven Google requests for the presence score, an email, five database requests |
| Daily review check, a shop with a new review | 4.7 s | Sign-in, read reviews, the model, publish the reply, a text |
| Daily review check, a shop with nothing new | 0.6 s | Sign-in and one read of its reviews, every time |
| Weekly stats text | 1.4 s | Sign-in, one figures request, a text, four database requests |
| Post publisher | 1.3 s | Sign-in, publish, a text |
| Figures sync | 0.9 s | Sign-in, one figures request, one save |
| Onboarding texts | 0.5 s, only for shops in their first week | A text |
| Approval previews | 0.3 s, only for shops with a post waiting | An email |

## Before: one run, all shops

Seconds for one run. **Bold** is over the 60-second limit: the job is cut off partway.

| Job | 10 shops | 180 shops | 500 shops |
|---|---|---|---|
| Weekly post writer | 35 | **626** | **1,738** |
| Monthly report | 17 | **302** | **838** |
| Daily review check, quiet day (1 shop in 20 has a new review) | 10 | **144** | **400** |
| Daily review check, busy day (1 in 5) | 14 | **255** | **709** |
| Weekly stats text | 14 | **248** | **690** |
| Post publisher, a normal 15-minute slice | 1 | 19 | 51 |
| Post publisher, everything due at once | 13 | 51 | 51 |
| Onboarding texts (1 shop in 10 is new) | 1 | 9 | 24 |
| Figures sync | 9 | 19 | 19 |
| Approval previews, switched on | 0.4 | 6 | 17 |

Two things in that table are worth a second look:

- **The post writer is over our own 25-second alert line at just 10 shops** (35 seconds). It would finish, but the scheduler would report a failure every Friday.
- **The figures sync never overruns.** It was built with a time budget: it stops at 18 seconds and carries on next hour. That is the pattern this PR copies to the others.

## What this PR changes

Small and safe, in the spirit of what the figures sync already does. No job is made faster. Each one now **stops cleanly before time runs out, says how many shops are left, and carries on at its next run.**

| Job | Change | How it knows who is done |
|---|---|---|
| Weekly post writer | Runs every 5 minutes, 09:00 to 12:55 UTC on Fridays (was once, at 09:00) | A shop already has a post for the week. Read once for everyone, not once per shop |
| Weekly stats text | Runs every 5 minutes, 08:00 to 10:55 UTC on Mondays (was once, at 08:00) | A shop already has this week's stats row. Read once for everyone |
| Daily review check | Runs every 15 minutes, 08:00 to 18:45 UTC (was once, at 09:00). Each run starts 6 shops further down the list | It does not need to know. A review already seen is skipped, so checking a shop twice is harmless |
| Post publisher | Stops when its time is up, not only at 40 posts | A post is marked published |

A run with nothing left to do costs two database requests.

### Two bugs fixed on the way

1. **A new shop would have been written a fresh post on every run.** The "does this shop already have a post this week?" check did not count a post that is waiting for approval. That was harmless with one run a week. With several, every shop in its first three posts would have got a new one each time. Fixed, with a test.
2. **A listing with more than 1,000 reviews could have had old reviews answered again.** The database returns at most 1,000 rows per request without saying so, and the review check read its list of already-seen reviews in one request. It now reads in pages.

### After: on the new schedules

| Job | 180 shops | 500 shops | Longest single run |
|---|---|---|---|
| Weekly post writer | All done in 30 runs (2.5 hours) | **288 of 500** in the 48 runs available | 21 s |
| Weekly stats text | All done in 12 runs (1 hour) | All done in 34 runs | 21 s |
| Daily review check, quiet day | All 180 checked; all 9 new reviews answered | 277 of 500 checked | 21 s |
| Daily review check, busy day | All 180 checked; all 36 new reviews answered | 267 of 500 checked | 22 s |
| Post publisher, clearing a full backlog | 12 runs (3 hours) | 32 runs (8 hours) | 20 s |

No shop was done twice in any run: no duplicate post, text or reply.

**What shops will notice:** the Friday preview email and the Monday text arrive some time in a three-hour window in the morning, not on the dot. A new review is answered the same working day, not the next morning: within a quarter of an hour while there are up to about 20 shops, and within about seven and a half hours at 180.

**This holds to about 250 shops. It is not the answer for 500.** That needs the proper fix below.

## Still to do

### The proper fix for all of them: background functions

Netlify's background functions run for 15 minutes instead of 60 seconds. Moving the four heavy jobs there would remove the stop-and-resume juggling and cover 500 shops comfortably:

| Job | 500 shops, one after another | Fits in 15 minutes? |
|---|---|---|
| Weekly post writer | 29 minutes | Only by writing three or four at a time |
| Monthly report | 14 minutes | Just |
| Daily review check | 7 to 12 minutes | Yes |
| Weekly stats text | 12 minutes | Yes |

It is a bigger change than it sounds, because today the job code lives in the Next.js app and is called over the web by a thin scheduled function. It would have to move into the function itself. Worth doing once the pilot shows the shape of things; not worth doing before.

## Google quota

At the assumed 300 requests a minute, shared by all shops:

| Job | Google requests per minute while running | Verdict |
|---|---|---|
| Monthly report | about 250 while a run is working, but each run is now only 20 seconds in every five minutes | Fine as scheduled. Do not speed it up by running shops side by side without also pacing it |
| Daily review check | about 180 | Fine |
| Weekly stats text | about 90 | Fine |
| Post publisher | about 95 | Fine |
| Figures sync | about 130 | Fine |

Two jobs running in the same minute add together. The new schedules overlap on Monday mornings (stats text and publisher) at about 185 a minute combined: fine.

**At 180 shops a month's report needs 1,260 Google requests**, which is over four minutes at the quota however it is arranged. That was another reason to spread the monthly report over several runs, which it now is (last section).

## Database load

Nothing here fans out badly, with one exception:

- **The monthly report's "change during your ads" section** reads the figures for every shop *without* an ad date, all at once, the first time it meets a shop *with* one. At 180 shops that is a burst of about 145 database requests in the same instant. It happens once per distinct ad start date per run, so it is a spike rather than a flood, but it should be done ten at a time. **Now done ten at a time** (last section).
- Everything else makes four or five database requests per shop, one after another.
- **The 1,000-row limit** did not bite anywhere at 500 shops. Two places would have at larger numbers and are now read in pages (the review check, above). One remains: the list of active shops itself would be cut off silently beyond 1,000 shops. Not a concern at this size; noted.

## What to do, in order

1. **Merge this PR** with the others. It makes four jobs safe to about 250 shops.
2. **Check which region the site's functions run in** (Netlify: Project configuration, Functions). If it is the US and the plan allows, move it to match the database.
3. **Run the scale check again** after any change to a scheduled job. It takes about ten seconds.
4. **Plan background functions** before 250 shops.

## Corrections after review (PR #53)

An independent review of the first round found problems in it. All are fixed, and the tables above are from the corrected code.

1. **A post the shop cancelled was written again five minutes later.** The "already has a post?" check counted only live posts. With one run a week that was harmless; with a run every five minutes, a shop that pressed "cancel" got a fresh post and a fresh email from the next run, all morning. Any post for the week now counts, cancelled ones included.
2. **Posts were going out fortnightly, not weekly.** This one is older than any of this work. The check asked "is there a post since last Sunday?", and last week's post, published on the Monday just gone, always answered yes. So every other Friday every shop was skipped. It now asks about the *coming* Monday. **Shops will get a post every week, which is what the terms have always said, and twice as often as the code was actually doing.**
3. **The Monday text could repeat.** The row that marks a shop as done was written without checking that the write worked. If it failed, the next run, five minutes later, would text the shop again, up to 36 times. Now, if the row cannot be written, no text is sent.
4. **"0 views" when Google could not be read.** A failed read from Google came back as all zeros and was texted to the shop as its figures. The shop is now left for the next run.
5. **The review check could miss the shops just behind a busy stretch.** It moved 12 shops down the list each half hour and relied on every run reaching at least 12. Answering a new review takes nearly five seconds, so a run that met three of them did not get that far. It now moves 6 at a time, every 15 minutes.
6. **Reading in pages was not safe as written.** Pages were read without a fixed order (so a row could be missed between pages) and the loop stopped at the first short page (wrong if the server's own limit is lower than the page size). Both fixed.
7. **The simulation depended on the day it was run.** It now always starts from the same fixed moment.

## The monthly report (fixed in its own PR)

It was left out of the first round because it could not tell who it had already sent to: an email leaves no trace, so running it again would have sent some shops two reports.

**The fix:** one new column, `profiles.monthly_report_sent_for`, holding the month a listing's last report covered. With that, the report gets the same treatment as the others: stop when the time is up, carry on at the next run.

| | Before | After |
|---|---|---|
| Schedule (UTC) | Once, 08:00 on the 1st | Every 5 minutes, 08:00 to 11:55, on the 1st and the 2nd |
| How it knows who is done | It did not | The marker, written just before each email goes |

### Timings

Simulated shops, same assumptions as above.

| Shops | Before: one run | After: one run | After: runs until everyone is sent | Reached | Sent twice |
|---|---|---|---|---|---|
| 10 | 17 s | 17 s | 1 | 10 of 10 | 0 |
| 180 | **302 s** (cut off at 60: about 35 sent) | 21 s, sends 12 | **15 runs: 75 minutes** | 180 of 180 | 0 |
| 500 | **838 s** (cut off at 60) | 21 s, sends 12 | **42 runs: 3.5 hours** | 500 of 500 | 0 |
| 500, with 1 shop in 5 on ads | **842 s** | 21 s, sends 11 | 46 runs: 3.8 hours | 500 of 500 | 0 |

48 runs are available each morning, so 500 fits on the 1st with a little to spare. The 2nd is there so that a bad morning on the 1st is not a missed month. On a normal month the runs on the 2nd find nobody left and each costs two database requests.

### Why "claim, then send"

The marker is written **before** the email goes, and only if it is not already that month. That choice has consequences worth knowing:

- **Two runs overlapping cannot both send.** The database lets only one of them write the marker. This was run against the real staging database, not just the simulation.
- **If the email is refused**, the marker is put back and the next run tries again.
- **If the job dies between writing the marker and sending**, that one shop misses that month's report. That is deliberate: a missed report is a smaller harm than a shop getting the same report twice, or every five minutes all morning.
- **If the marker cannot be written at all** (the migration has not been applied, or the database is down), **nothing is sent.** So the migration must be applied before this code is deployed.

### Also in that PR

The "change during your ads" comparison now reads the other shops' figures ten at a time, not all at once. That was the burst of about 145 simultaneous database requests noted above.

### Two things to know when releasing it

1. **Apply the migration first** (`20261116120000_profile_monthly_report_marker.sql`).
2. **Do not release it on the 1st or 2nd of a month.** Every listing starts with no marker. If the old code has already sent that month's reports and this code goes live the same morning, it would send them again.

### Google quota

Unchanged per shop (seven requests), but now spread out: about 84 requests per five-minute run, far below the 300-a-minute limit. The earlier worry, 1,260 requests in a few minutes at 180 shops, no longer applies.


## 92 shops in one week (17 November 2026)

A second simulation, for the question "can every shop Tarkett has start in the same week?". Same harness, same assumed timings as above, with shops joining as well as jobs running.

To run it: `npx vitest run --config scripts/scale-check/day-one.vitest.config.ts`

### What it found before the fixes

Run against the code as it stood on 16 November, the simulation found four things that would break and several that would back up:

| What | Before |
|---|---|
| Applying changes for a shop with 20 unanswered reviews | One request of about 76 seconds against a 60-second limit. Cut off part-way; the screen said "Sorted" anyway |
| A "too many requests" answer from Google | Not retried while scoring or applying. On the sign-in refresh it marked the shop as disconnected |
| First posts | Nobody could approve one. 276 waiting after two Fridays, none published |
| A history pull that keeps failing | Went first every hour for ever. With 30 failing listings, the other 62 got no figures in 24 runs |

### After

| What | Now |
|---|---|
| Longest single request while a shop sets up | **3.9 seconds** (5.7 if the model takes 5 seconds, not 3). Changes are applied one small request at a time, each checked |
| A shop with 20 unanswered reviews | 11 requests, 27 changes, about 25 seconds in all. Every change done and checked |
| "Too many requests" on the sign-in refresh, or on the first read | The shop is told Google is busy and offered a retry. It is **not** marked disconnected |
| "Too many requests" on every edit, or every reply | Retried with back-off. What still fails is listed as **not done**, with a "Try again". Nothing is reported as done that was not |
| The model refusing every call | The screen says suggestions could not be written, with a "Try again". It no longer says the listing needs nothing |
| First posts after two Fridays, nobody approving | **92 waiting, one per shop** (was 276). Approved from the dashboard |
| 30 listings whose history pull always fails | The other **62 of 62** get their figures |

### Arrivals

| Pattern | Shops | Busiest minute: requests to Google | Model calls in the busiest minute | Every change done |
|---|---|---|---|---|
| Spread over a working day (a fifth of 92) | 19 | 62 | 24 | 19 of 19 |
| 60 shops within two hours of the email landing, mixed listings | 60 | 267 | 54 | 60 of 60 |
| The same, but every listing empty with 20 unanswered reviews | 60 | 371 | 96 | 60 of 60 |
| Ten shops pressing the button in the same second | 10 | 369 | 123 (28 at once) | 10 of 10 |

The assumed limit is 300 requests a minute. The figures above include sign-in refreshes, which go to a different Google service and are not thought to count against that limit, so the true numbers are lower. The two rows above 300 are the deliberately extreme ones. If the limit is hit, requests are retried with a growing wait, and anything that still fails is shown to the shop as not done with a retry. **Nothing is lost and nothing is misreported**; the cost is a slower screen.

A shop uses about 24 requests to Google to connect and be scored, and between 57 and 91 if it then applies every suggestion.

### Scheduled jobs at 92

Unchanged from the table at the top of this document: every job finishes inside its window with nobody sent anything twice. Longest single run 22 seconds.

### Still true, and worth knowing

- **Old reviews beyond the cap are never answered.** At most 20 are offered when a shop looks at its suggestions, newest first, and the daily check leaves anything older than 14 days alone. The screen now tells the shop how many it is not showing.
- **The Monday text shows a false rise for a shop's first four weeks.** No mobile number is asked for any more, so a new shop gets no text unless it adds one.
- **The old day-by-day welcome sequence still sends nothing.** It is replaced by one welcome email at connection, off unless switched on.
- **The model's own rate limit is not known.** A busy answer is now retried twice.
- **What the simulation cannot show:** calls made side by side do not slow each other; the timings are assumed; Google's real limits have not been observed.

## Re-run for the retention build (#64 to #69)

Both were run again on the head of #69: the scale check at 10, 180 and 500 shops (58 pass) and the simulation of 92 shops in one week (38 pass). Run it: the two commands above.

One thing in these PRs adds work to a scheduled job: **the hourly figures job now also reads each listing's reviews once a day**, to note its rating, its review count and how many have a reply (#68). Measured in the simulation at 92 shops, on the same listings before and after:

| | Before | After |
|---|---|---|
| Every shop due its daily refresh, one run | 19.3 s | 19.6 s |
| 92 history pulls that failed at onboarding, retried hourly | done in 9 of the day's 24 runs | done in 11 of 24 |
| Longest single run | 19.7 s | 19.3 s |

So it fits, with room. The simulated listings have few reviews; a listing with several hundred costs a few more requests on its one run a day, and the job stops on time and carries on at the next run as before.

Two things are **not** measured here:

- **With `REVIEW_ALERT_EMAILS` on, the review job looks at every connected shop**, not only those with replies on. The simulation already runs that job across all 92 shops with replies on (44 runs in the working day, every shop reached), which is the same number of shops looked at, so the cost is the one in the table at the top. It has not been run with the switch on and replies off for most shops.
- **Opening the console.** The league and the monthly summary now read last year's figures as well as this year's: four reads of stored figures per joined shop where there were two. That is a page a person opens, not a scheduled job, and it has not been timed at 92 or 180 shops.
