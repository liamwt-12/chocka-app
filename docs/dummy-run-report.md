# Dummy run on staging: report

Run on 16 November 2026, three times. **Final result: 39 of 39 checks pass, and staging was left exactly as it was found.**

The first run found **two real bugs**, both in code that predates this month's work. They are fixed in PR #47.

## Update, 17 November 2026: 52 of 52 on the new onboarding flow

The run was brought up to date for PRs #54 to #60 and run again several times. **Final result: 52 of 52 checks pass, and staging was left exactly as it was found.** The run found **three real bugs** in the new code, all fixed in #60:

1. **An undo was refused as "changed since" when nothing had changed.** The database stores a logged value with its keys in a different order from the one Google returns, and the two were compared as text.
2. **The count of live shops left rows behind.** They do not hang off the shop's record (on purpose, so a past month survives a shop leaving), so the clean-up has to remove them by name.
3. **The command-line undo script reported every change it had chosen to skip as a failure.**

Checks added in this round:

| Area | What is proven against the staging database |
|---|---|
| Launch check | Every database change is in place; no secret appears in the answer |
| Connecting | A connected shop lands on "You're connected" with everything off and no mobile number asked for |
| Welcome email | Off: nothing. On: one email to the shop that connected (captured, not sent); a second sign-in sends nothing |
| Wrong Google account | No account is made; the reason is recorded and shown to support; the same link then works with the right account |
| Cancel, and the unticked box | Each leads to a help page that keeps the invitation; no account; the link is still good; support sees which it was |
| "This is not my shop" | A button, not a link; removes only the signed-in shop's own account; the invitation works again |
| Invite opened | Recorded once, by the page's script; a made-up link gets the same answer |
| Not live | The wrong listing and the unverified listing are connected and are not counted as live |
| Opening hours | An empty or missing week is refused and nothing is written. There is no default |
| Applying changes | Each change on its own, checked on "Google"; replies sent a few at a time, each with its own result; a reply to a low-star review refused; the score afterwards is measured and the score at activation is unchanged |
| Honesty | A change "Google" refuses is reported as not done, in plain words, and recorded as failed |
| Posts | Post 1 is the one the shop read and ticked. Posts 2 and 3 wait; approve, change the wording and skip all work from the dashboard; another shop is refused; nothing piles up while one waits |
| Held shops | No post is written for a shop on an unconfirmed listing until a person says "this is right" |
| Daily check | A listing Google has since verified goes from "waiting" to connected by itself; a person's confirmation is kept; today's live shops are marked once |
| Statement | Live shops by name; with a cap, the shops above it are a credit and the total adds up (made-up test settings) |
| Ad spend | Saved by an admin; nonsense refused; not in the shop's dashboard or emails; in Tarkett's console with "Clear rise" and no raw counts |
| Lost access | The daily check notices; the shop is told on its dashboard; support sees "Connection lost" in plain words |
| Settings | Holiday hours and website written, read back and logged; a past date and a nonsense address refused |
| Undo | The shop undoes one of its own changes; not twice; not another shop's; support undoes one from the admin page; an undo that would lose a later change is refused |

Totals for the last run: 52 checks, about 325 requests to "Google" faked, 15 model calls faked, 13 emails and 9 texts captured and not sent (all to test addresses), no request blocked, none the fake could not answer.

The account below is of the first version of the run, on 16 November, kept as it was written.

## What this was

Every code PR (#24 to #43, without #30) merged together locally, then driven end to end against the **staging database**, through the **real route handlers**: the same code Netlify would run.

- **Google was faked.** A small in-memory Google answers sign-in, listings, reviews, posts, photos and performance figures, and remembers everything written to it.
- **The AI model was faked.** Canned text, with every prompt recorded.
- **Email and SMS were faked.** Captured and counted. Nothing was sent.
- **Everything else was blocked.** Any request to anywhere other than the staging database or one of the fakes is refused and counted. The count was **zero**.
- **The database was real.** That is the point: it tests what the unit tests cannot, including queries that had never run against a real database.

The run is repeatable: `scripts/dummy-run/run.py` (see "Running it again").

### Test data

Seven shops, all named `ZZ-TEST Shop A (dummy run)` to `G`. People were `dummy-run+a@invalid.example` and so on (a domain that cannot receive mail). The one phone number was in Ofcom's range reserved for fiction. Staging held no shops and no users beforehand; the run refuses to start otherwise, so **no real row was ever in reach**.

## Results

| Area | What was checked | Result |
|---|---|---|
| **Switches** | With nothing set: console is a 404, photo upload is a 404, photo admin refuses, preview email is off | Pass |
| **Setup** | Seven TEST shops added through /admin/pilot. A wrong admin password is refused. Invite links generated; **no message sent**. A second link for the same shop is refused | Pass |
| **Ownership statuses** | All five, each from a different fake Google account: | |
| | *invited*: link issued, not used | Pass |
| | *connected*: manages the expected listing (matched by place ID) | Pass (three shops) |
| | *check listing*: manages a different listing. Flagged, not blocked | Pass |
| | *waiting on Google*: right listing, not yet verified | Pass |
| | *no access found*: manages no listing. Sent to the "no profile" page | Pass |
| | Signing in with no invite is refused and no account is created | Pass |
| | The Google credential is stored encrypted, never as it arrived | Pass |
| **Onboarding** | Audit scores the listing and pulls 541 days of history. No session, or a forged session cookie, is refused | Pass |
| | Voice answers saved against the shop. A phone number in them is refused with a plain message | Pass |
| | Previews are written in the shop's voice. The reply sample is a 5-star review, never a low one | Pass |
| | Applying the fixes: description, services, categories and hours reach "Google". The 4 and 5 star reviews get a reply ending with the shop's sign-off. **No 1 to 3 star review gets a reply.** No message sent | Pass |
| **Change log** | Every change recorded, each with what was there before | Pass |
| **1 to 3 star holding reply** | At onboarding: the recent 2-star gets the fixed holding reply queued; the 60-day-old 1-star is left alone (14-day rule). The dashboard shows it. Opening the approve link changes nothing; a tampered link is refused; pressing the button publishes it word for word; pressing again is refused | Pass |
| **Posts and first-three approval** | Post 1 waits. Run the publisher: **nothing is published**. Approve, then it publishes. Posts 2 and 3 the same. Post 4 does not wait, and gets the usual preview (captured, to the test address). The preview-for-waiting-posts job says "not sent: switched off" | Pass |
| | Shops that did not ask for posts get none | Pass |
| **4 and 5 star replies** | A new 5-star review is replied to. A second run does nothing | Pass |
| **A new 1 to 3 star review** | Nothing is published. The fixed holding reply waits on the dashboard. The review text is never sent to the model | Pass |
| | **A review the shop already answered itself is left alone** | **Failed, fixed in #47, now passes** |
| | **A review answered at onboarding is not answered again** | **Failed, fixed in #47, now passes** |
| **Photos** (flag on locally only) | Upload by link. The stored file has no GPS position, device, XMP, IPTC or appended data. It is **not publicly readable**. A PDF renamed `.jpg` is refused. A wrong link is refused | Pass |
| | A photo waiting for approval is never attached: the next post goes out as text | Pass |
| | Once approved it goes on the next post, handed to "Google" as a short-lived signed address. That address was then fetched with no credentials, as Google would: **it returned the photo** | Pass |
| | The change log records which photo, never its address. "Add to Google listing" is refused (its flag is off) | Pass |
| | With the photo flag switched off again, a post that has a photo attached goes out as text | Pass |
| **Report, corrected numbers** | Last month's views, calls, website clicks and directions in the report equal exactly what the fake Google served (2,040 / 102 / 153 / 51). **Not four times it.** One report per shop | Pass |
| | *(added with the monthly report fix)* Every listing is marked for the month once its report goes, a second run sends nothing, and the database refuses a malformed marker. The run is now **40 checks** | Pass |
| **Before and after** | The shop with an ad date sees "Change during your ads": +100% (the fake doubles its figures from that date) against four shops without ads, which were flat. A shop with no ad date does not see the section. A badly formed date is refused | Pass |
| **Console and league** (flag on locally) | Sign-in by a one-time link (captured, not sent). Opening the link does not use it up; the button does; it cannot be used twice. A stranger's address gets the same answer as a real one | Pass |
| | Seven shops shown. A joined shop shows posts, replies and percentage changes. **A shop that has not joined shows no figures at all.** No contact details, phone numbers or review text anywhere in the response | Pass |
| | The league ranks five shops, with the shop whose figures doubled at the top ("Strong rise") | Pass |
| | A shop's own login cannot open the console. Flag off again: 404 | Pass |
| **Revert** | The real revert script, pointed at the test listing: 7 posts deleted; description, services, categories and hours back to what they were; our automatic replies removed. **The shop's own replies and all 8 reviews untouched.** The one reply the shop approved by hand is left and reported for a manual check, as designed | Pass |
| **Leaving** | Deleting the account deletes the shop's photo file from storage and its record, and kills the upload link. The shop's record stays, as designed | Pass |
| | The retention job, dry run: would delete 1, deletes 0. For real: deletes the long-delisted unclaimed TEST shop, keeps the claimed one, and checks for photo files first | Pass |
| **Nothing left the building** | 196 Google requests and 14 model calls, all faked. 11 emails and 9 texts captured, all addressed to test data, **none sent**. 0 requests to anywhere else | Pass |

## The two bugs it found

Both are in older code, both would have happened to real shops, and neither is something a mocked unit test could have caught, because both depend on how the real database behaves.

### 1. Reviews answered at onboarding were never recorded, so they were answered twice

After onboarding replies to a review, it saves a record so the daily check knows that review is dealt with. **That save has never worked.** It told the database to match on one column, but the table is only unique on two together, so the database refused it. The code did not check for the refusal.

**What a real shop would have seen:** the morning after joining, a text saying "New 5-star review!" about a review that was days old, and a second, different reply replacing the one written at onboarding. For every unanswered 4 or 5 star review from the last fortnight.

The daily check's own record of old reviews failed in the same way. That one did log its error, every run.

### 2. The daily check replied over a reply the shop had written itself

The daily check replied to any recent review it had not seen before, without looking at whether the review **already had a reply**. A shop that had personally answered a customer in the two weeks before joining would have had its own words replaced by ours.

It would have been undoable: the change log recorded what was there. But it should not happen.

**Both are fixed in PR #47**, with tests, and the dummy run now checks for both.

## Things I noticed that are not failures

Worth knowing. None is fixed here.

1. **A shop marked "check listing" is treated as live.** Shop B signed in with an account that manages a *different* business from the one expected. It is flagged in /admin/pilot, and it is also fully connected to that other listing: if posts were on, they would go there. That is the agreed behaviour ("flag, never block"), but it means **a rep must look at every "check listing" before that shop's posts are switched on.**
2. **A shop "waiting on Google" is treated as live too**, for the same reason. Posts to an unverified listing will probably be refused by Google; that needs the real test.
3. **Categories are written with a display name only.** When onboarding adds categories, it sends the primary category by its name in words, without Google's own identifier. The fake accepts that. **Real Google may not.** If it refuses, that one step fails and the rest carry on, so nothing breaks, but it is the first thing to look at in the real test (step 3 of the test-listing runbook).
4. **Every review, post and text is filed under the Chocka brand in the database**, including Stellar shops'. Those tables default to Chocka's id and the code does not set it. Nothing reads it today, so nothing is wrong today. It will matter the day anything is reported or deleted by brand.
5. **The model is asked for by the new name** (`claude-sonnet-5-5`) on every call. Whether the real service accepts the request is still for step 1 of the test-listing runbook; the fake cannot tell us.

## Clean-up, and proof nothing else changed

The run deletes its own data at the end, pass or fail. Then the launcher compares staging with a snapshot it took before starting:

| Compared | Before | After |
|---|---|---|
| Schema: tables, columns, constraints, indexes, policies, functions | | **Identical** |
| Row count of every table | All zero except `tenants` (2) | **The same** |
| The two tenant rows | | **Unchanged** |
| Files in storage | 0 | **0** |
| Storage buckets | | **Unchanged** |

This held on all three runs, including the first, which failed partway.

## How the staging key was handled

Driving the real code needs the staging database's service key. I do not read `.env` files, so the launcher fetches that key from Supabase's management service at the start of each run, using the same keychain login the migration scripts already use. It is passed to the one test process and discarded. **It was never printed, logged or written to a file**, and the launcher refuses any project other than staging. Every other secret the app needs was random, made up for the run.

That is a judgement call, so it is flagged in the overnight report as a question.

## Running it again

```bash
git checkout <a branch with every code PR merged>
/usr/local/bin/python3.14 scripts/dummy-run/run.py
```

About two minutes. It refuses to run unless staging is empty, and it is not part of `npm test`.

**Worth doing after any change to sign-in, onboarding, posts, replies, photos or the report.** It is the only test here that uses a real database.

## What it does not prove

- **Anything about real Google.** Whether Google accepts our photo address on a real post, the categories write, posts to an unverified listing, how far back history really goes. The test-listing runbook is for those.
- **The real model.** The fake always answers politely.
- **Real email or SMS delivery.**
- **The screens.** This drives the server, not a browser. The onboarding pages, the dashboard card and the photo upload page have not been clicked through.
- **A rep adding us as a manager** (the route most shops will use). Every shop here signed in for itself.
- **Timing.** Jobs were run by hand, one after another. The scale check covers how long they take.
