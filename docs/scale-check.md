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
| Daily review check | Runs every half hour, 08:00 to 18:30 UTC (was once, at 09:00). Each run starts 12 shops further down the list | It does not need to know. A review already seen is skipped, so checking a shop twice is harmless |
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

**What shops will notice:** the Friday preview email and the Monday text arrive some time in a three-hour window in the morning, not on the dot. A new review is answered within the hour instead of the next morning.

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
