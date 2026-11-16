# DRAFT, needs solicitor review

> **Briefing pack for the solicitor.** Written 16 November 2026 by the engineering side, from what the code and the existing documents actually say. Not legal advice, and not yet checked by Liam. Square brackets mark facts Liam must fill in before this is sent. Nothing described here as "drafted" has been published or sent.
>
> **This repository is public on GitHub.** Commercial terms and the names of individuals have been left out on purpose. Liam can add them in a covering email.

## How to use this pack

The aim is to save your time. Everything you need to answer the six questions is in this one document. The other documents are listed in section 9 in the order worth reading them, with the parts that matter.

**What we are asking for:**

1. Written answers to the six questions in section 6 (most are yes/no, or "pick one of these").
2. A mark-up of three short drafts: privacy policy, terms of service, Article 14 notice.
3. A steer on section 5: what to do, now, about a notice that is overdue.

**What we are not asking for:** drafting from scratch, a full compliance audit, or advice on the commercial contract with Tarkett (unless question 3 or section 7 makes that unavoidable).

**The one urgent item** is section 5. The rest is needed before specific features are switched on, and each of those features is currently switched off.

---

## 1. Who is who

| | |
|---|---|
| **Useful for Humans Ltd** [company number, registered address] | The company. One director, Liam. Data controller for everything below. |
| **Stellar Local** | The service: it looks after a flooring shop's Google Business Profile (posts, review replies, a monthly report). |
| **Tarkett** | A flooring manufacturer. It pays for Stellar Local on behalf of the independent shops that stock its products. It is the customer; the shops pay nothing. |
| **Retailers / shops** | About 180 independent UK flooring shops on Tarkett's public store locator. Mostly small. See the note on sole traders below. |
| **Tarkett reps** | Tarkett's own field staff, who visit the shops. They introduce the service. |
| **Reviewers** | Members of the public who have left a Google review on a shop's listing. |

**Sole traders matter here.** Of the 180 shops, only 19 have "Ltd", "LLP" or "PLC" in their name, and that is a guess from the name, not a Companies House check. We treat **all 180 as personal data** and as individual subscribers under PECR unless shown otherwise.

**State of play.** [Liam: confirm the number.] As of the last count no shop has joined. A pilot with a small number of shops is about to start. So today the personal data held is almost entirely the 180 store-locator records.

---

## 2. Data map

One row per group of people. "Held" means in our database (Supabase, Ireland) unless it says otherwise.

| Whose data | What is held | Where it came from | Who can see it | Kept how long |
|---|---|---|---|---|
| **A. The 180 shops on the store locator** (most have not joined, and most have never heard of us) | Business name, town, nation, a contact email (176 of 180; 105 look like a named person's address, such as `dave@`). From Google: a listing identifier, rating, review count, photo count, whether there is a website. **Our own score and band** for the listing (for example "Weak"), with its history. Whether Tarkett's ads for the shop have started, and on what date. | Copied from Tarkett's public UK store locator in **June 2026**. The Google figures from Google's public Places data. The score is ours. | Us. Our processors. **Not Tarkett**, for a shop that has not joined. | For as long as the shop is on Tarkett's store locator and we serve that network. Reviewed by hand. A deletion job exists (six months after a shop drops off the list) but is **deliberately not scheduled**, because the published notice says review is by hand. Deleted on request at once. |
| | The same shops' **full address, postcode, map position, website** | Same source | **Anyone.** This sits in a file in our public code repository (`scripts/source-data/retailers-locations.csv`), with emails removed. It is a copy of what Tarkett already publishes, but it is a second copy under our control. | No period set. [Decide: see section 8.] |
| **B. A shop that has joined** | Name and email of the person who signed in. Mobile number. An encrypted Google access credential, or a note that a manager account acts for them. The listing's details from Google (name, address, phone, hours, description, services). Daily performance figures (views, calls, direction requests, website clicks) going back up to about 18 months. Posts and replies we wrote. A log of every change we made to the listing, with before and after. Texts and emails we sent them. | The shop (by signing in with Google and typing a mobile number), Google, and us. | Us and our processors. Tarkett: see section 7. | Deleted straight away when the shop deletes its account. The change log and message records have no period set yet. [Decide.] |
| | **How the shop sounds** (new, PR #38): tone, a sign-off such as "Dave and the team", words it likes and avoids, a short description, specialities. | The shop at set-up, or a Tarkett rep on its behalf. | Us. Sent to the AI provider when a post or reply is written. | With the shop's record. |
| | **Photos of the shop's work** (new, PR #39, **switched off**). Location and all other hidden data are removed before saving. | The shop or a rep, through an upload link. | Us. Public on Google once used on a post. | See `photos-privacy-line.md`. |
| **C. Reviewers** (members of the public) | Display name as shown on Google, star rating, review text, date, and our reply. | Google, from the shop's listing. Already public. | Us. Sent to the AI provider to draft a reply (4 and 5 stars only). The shop. | With the shop's account. |
| **D. Tarkett staff with a console login** (**switched off**) | Work email, name, sign-in link records. | Added by us by hand. | Us. | Until removed. Sign-in records: suggest 30 days. |
| **E. Anyone visiting the app** | One sign-in cookie (strictly necessary). Standard server logs. | The browser. | Us, Netlify. | [Netlify's log retention: confirm.] |
| **F. A shop's own customers** | **Nothing.** No customer names, emails, phone numbers or addresses are collected anywhere in the service. The printable review card (PR #40) is a QR code to Google's public review page; it involves no customer data and sends nothing. | | | |

**What is not collected at all:** payment details (the service is free to shops), special category data, anything about children, analytics or advertising cookies.

### Where data goes (processors)

| Provider | What it gets | Where |
|---|---|---|
| Supabase | The database, and private photo storage if photos are ever switched on | Ireland (EU) |
| Netlify | Hosts the app, runs scheduled jobs, holds server logs | [USA: confirm region] |
| Google | We read and write the shop's own Business Profile through Google's API, with the shop's permission | [USA / global] |
| Anthropic | Drafts posts and replies. Receives the business name, trade, town, the shop's voice notes, and for a reply the reviewer's display name, rating and review text | [USA] |
| Twilio | Text messages to shops that gave a mobile number | [USA] |
| Resend | Email to shops | [USA] |

[Liam: is a data processing agreement signed with each? Question 4 depends on it.]

### Security, in three lines

Google credentials are encrypted at rest. The database tables are closed to everyone except our own server code. Sign-in uses a signed, expiring cookie. (Some of this is in changes awaiting release; none of it weakens the picture above.)

---

## 3. What the service does automatically

This matters for the "automated decisions" wording and for question 6.

| Thing | What happens |
|---|---|
| Weekly post | Drafted by AI, checked by fixed rules (no prices, no accreditations, no guarantees, no contact details). A new shop must approve its first three posts. After that, the shop gets a preview and the post goes out unless cancelled. |
| 4 and 5 star reviews | If the shop has switched replies on: an AI reply is published, after the same fixed checks plus a ban on refund, fault, compensation and legal wording. |
| 1 to 3 star reviews | **Never AI.** A fixed, cautious holding reply is drafted and published **only if the shop approves it**. |
| Reviews more than 14 days old | Never replied to. |
| Everything we change on a listing | Logged with the previous value, so it can be put back. |

We believe none of this is a decision about a person with legal or similarly significant effects (Article 22). The score is an assessment of a public business listing.

---

## 4. First contact: the PECR position (settled, for context)

This is background to questions 2 and 3. We are not asking you to re-open it unless you think it is wrong.

- We concluded in August that **we cannot lawfully email these shops cold**. Most are sole traders, so individual subscribers under PECR; there is no consent, and no soft opt-in because we have never sold them anything.
- So it was agreed with Tarkett on **17 August 2026** that **Tarkett makes first contact**, through its reps or its own message. We send nothing to a shop that has not joined.
- The software reflects that. It can generate an invitation link for a rep to hand over, and it cannot send one. No invitation has ever been sent.

---

## 5. The Article 14 notice: where we are and what we need (URGENT)

**The problem in one sentence.** We copied 180 business records in June 2026, most of them personal data, and have still not told the people concerned, when the law required it within a month.

### Timeline

| When | What |
|---|---|
| June 2026 | Store-locator records copied; Google listings matched and scored. **The one-month clock under Article 14(3)(a) starts.** |
| July 2026 | Deadline passes. Nothing sent. |
| 5 August 2026 | Legitimate interests assessment written and agreed by Liam (not by a solicitor). It records the missing notice as a live gap. A privacy notice covering these records is published on the app's `/privacy` page. **Publishing is not the same as providing**: nobody on the list has been pointed to it. |
| 5 August 2026 | Decided that the four records with no email address must get the notice by post, not be skipped or deleted. |
| 17 August 2026 | Agreed that Tarkett, not us, makes first contact (section 4). |
| 14 November 2026 | Notice drafted (`article-14-notice.md`), with a two-line version for Tarkett's first message. |
| 16 November 2026 | **Still not sent.** About four and a half months late. |

### Why it has not simply been sent

Honestly: it slipped behind the engineering work, and then got tangled with the question of who contacts shops first. There is also a real trap. A message from us saying "we hold your data" is a legal notice. The same message with "and here is a free service" attached is marketing, which section 4 says we cannot send. So the notice has to go **clean**, on its own.

### What we propose (please confirm or correct)

1. Send the clean notice to all 180 **now**, from us as controller: 176 by email, 4 by post. No invitation, no link to sign up, no mention of benefits.
2. Treat all 180 as owed it. Do not try to carve out limited companies.
3. Tarkett's own first message carries the two-line version as well (question 3).
4. Record the delay and the reason in our own records.

### What we need from you

- **Is sending now, late and clean, the right course?** Or is there a better one (for example, waiting days so that Tarkett's message lands first)?
- **Does the delay need reporting to the ICO**, or just recording? Our reading is that a late notice is not a "personal data breach" in the Article 33 sense, but we would like that confirmed.
- **Is email an acceptable way to give the notice** to an address copied from a public directory, given the PECR position? We think yes, because it is not marketing.
- **Does being overdue undermine the legitimate interests basis itself** for the period so far?

---

## 6. The six questions, with what you need to answer each

These are the six from `README.md`, in the same order.

### Q1. Does sharing a per-shop health summary with Tarkett change the legitimate interests balance?

- **Context.** The August assessment relied on Tarkett seeing "aggregate counts only" as a mitigation. That is no longer the plan. Section 7 sets out exactly what Tarkett would see.
- **Key facts.** Only shops that have **joined** would have anything beyond name, town and status shown. A shop that has not joined never has its score shown to Tarkett. The console is built but switched off.
- **Our view.** For a joined shop this probably moves from legitimate interests towards "part of the deal you signed up to", provided it is said plainly at sign-up. For shops that have not joined, the balance is unchanged, because nothing more is shared.
- **What we need.** (a) Is that right? (b) Is legitimate interests still the basis for the Tarkett view, or should it be contract, or consent? (c) Must the assessment be redone before the console is switched on? (We assume yes.)

### Q2. The Article 14 notice is overdue. What is the best course now?

- See section 5, which is this question in full.

### Q3. Is the two-line notice acceptable inside Tarkett's first message, without making Tarkett a joint controller?

- **Context.** Tarkett asked for a short data notice it can include when its rep or its message first mentions the service. The wording is at the bottom of `article-14-notice.md`.
- **Key facts.** Tarkett chose the shops (its own stockists) and pays for the service. Tarkett does not decide what we collect or how we use it, does not have access to our database, and its draft terms say it is "not a controller". But Tarkett's reps will physically help shops connect, may type in a shop's "voice" answers, and may upload photos on a shop's behalf.
- **Our view.** Independent controllers, with Tarkett passing on our notice as a courtesy. The rep activity is the part we are least sure about.
- **What we need.** (a) Is the two-line wording acceptable? (b) Does anything the reps do tip Tarkett into joint controllership, or make reps our processors? (c) Does it need a data sharing agreement with Tarkett, and if so can it be short?

### Q4. What transfer mechanism applies for each US processor?

- **Context.** Five providers are, we believe, in the US: Netlify, Google, Anthropic, Twilio, Resend. Supabase is in Ireland.
- **Key facts.** [Liam: for each, is a DPA signed, and does it include the UK Addendum or rely on the UK-US Data Bridge? This is a lookup, not a legal question: do it before sending so the solicitor is not billed for it.]
- **What we need.** A line per provider for section 6 of the privacy policy, or confirmation that a single sentence covering all of them is acceptable.

### Q5. What liability cap is right for a free service?

- **Context.** The live terms cap liability at "the fees you have paid in the 12 months before a claim". A shop pays nothing, so that is a cap of zero. The draft suggests a fixed figure of [£500].
- **Key facts.** The service changes a shop's public Google listing: description, hours, posts, replies to reviews. The realistic harm is a wrong opening time, an embarrassing post, or a badly judged reply, each reversible within a day from the change log. We never take ownership of a listing, only manager access. Tarkett pays us a monthly fee per live shop. [Liam: say what professional indemnity cover is held, if any.]
- **What we need.** (a) A sensible cap and whether to tie it to something (for example, a multiple of what Tarkett pays for that shop per year). (b) Whether the exclusion of loss of profit is enforceable against a small business on standard terms. (c) Whether the "same working day" reversal promise in section 4 of the terms should be a commitment or an aim.

### Q6. Does reading and replying to reviews need anything beyond legitimate interests for the reviewers' data?

- **Context.** A reviewer's display name and review text are read from the shop's listing, stored, and for 4 and 5 star reviews sent to an AI provider in the US to draft a reply. The reply is then published under the shop's name.
- **Key facts.** The reviewer posted publicly, on a platform designed for the business to reply. We never contact a reviewer. We do nothing with a reviewer's data except draft and store the reply. Low-star reviews never go to the AI. The shop is the one replying; we act for it.
- **Our view.** Legitimate interests (ours and the shop's), and we may be the shop's **processor** rather than a controller for this part.
- **What we need.** (a) Controller or processor for reviewer data? If processor, the shop needs terms to that effect. (b) Is the US transfer of review text a problem? (c) Is the mention in section 4.6 of the privacy policy enough notice to reviewers, who will never see it?

---

## 7. What changes if Tarkett sees per-shop data

**Today (live):** Tarkett sees nothing from us about any individual shop.

**The plan:** a "console" for named Tarkett staff, plus invoices that list each live shop. Built, **switched off**, and not to be switched on until the items below are done.

### Exactly what Tarkett would see

| Shop | Shown to Tarkett | Never shown |
|---|---|---|
| Every shop in its network | Name and town (Tarkett's own published data). Whether the shop has been invited, has connected, or is live. Whether the Google connection is working. | Contact details, phone, **any score** |
| A shop that has joined | Our presence score at the point it joined. How many posts and replies went out in the last 30 days. The change in customer actions and in views since joining, **as percentages**. An improvement band. The date Tarkett's ads for that shop started. Its position in a league of improving shops. | Contact details, phone, review text, raw numbers of views or calls, anything about the shop's customers |

### What that changes

| Area | Before | After |
|---|---|---|
| Legitimate interests assessment | Relied on "aggregate only" as a mitigation | Needs redoing for per-shop visibility (Q1) |
| App privacy page and terms | Said Tarkett learns only how many shops use it | PR #30 changes these to say Tarkett is told which shops take part and sees a health summary. **Merging that PR publishes the wording**, so it needs your review first. |
| Marketing site privacy page | Says figures go to Tarkett "at network level in aggregate" | Becomes untrue. Must change before the console is on. |
| Article 14 notice | Says a non-joined shop's score is not shared | Still true. Says a joined shop's summary is visible to Tarkett: draft already includes this in brackets. |
| Relationship with Tarkett | Tarkett receives a head count | Tarkett receives personal data about sole traders. Is Tarkett then a controller of what it receives? Is a data sharing agreement needed? (Q3) |
| What a shop is told at the door | Nothing about this | Needs a plain line before sign-up: "Tarkett can see how your listing is doing, and where you sit in a league of improving shops." |
| The league | Not shown to anyone | Shown to Tarkett only. If it were ever shown to other shops, each shop would need telling first and an opt-out. Not built. |
| People at Tarkett with access | None | A named list, kept by us, with leavers removed. |

### The question underneath

A shop's commercial relationship with Tarkett is bigger than this service. A shop might reasonably worry that a poor score or a low league position affects how Tarkett treats it. The draft terms say taking part "has no effect on your relationship with Tarkett". **We cannot make that true on Tarkett's behalf.** [Solicitor: should that sentence stay, be softened, or be backed by something in the contract with Tarkett?]

---

## 8. Things only Liam can decide (please settle before sending, to save fees)

Each of these is a bracket in one of the drafts. None needs a lawyer to decide, only to check.

| Decision | Suggested answer | Where it appears |
|---|---|---|
| Company number and registered address | [fill in] | All three drafts |
| Is a DPA signed with each of the six processors? | [look up; sign any missing] | Privacy policy s6, Q4 |
| How long is the change log kept? | 24 months | Privacy policy s8 |
| How long are text and email records kept? | 12 months | Privacy policy s8 |
| After a shop stops: delete at once, or after 30 days? | At once (it is what the code does) | Privacy policy s8, terms |
| "Reversed the same working day": commitment or aim? | "Normally the same working day" | Terms s4 |
| The exact list of what Tarkett sees | The table in section 7 | Privacy policy s7 |
| The public file of 180 addresses in the code repository | Remove it from the repository, or make the repository private | Data map, row A |
| Schedule the deletion job for delisted shops? | Yes, once the notice says so | Article 14 notice, retention line |
| Who at Tarkett gets a console login | [names, kept outside this public document] | Section 7 |

---

## 9. Exactly what to send, in reading order

Seven documents, about [25] pages in all. Send as PDFs or links; the paths are in the code repository.

| # | Document | Path | Read | Why |
|---|---|---|---|---|
| 1 | **This briefing** | `docs/legal-drafts/solicitor-briefing.md` | All | The map and the questions |
| 2 | Draft Article 14 notice | `docs/legal-drafts/article-14-notice.md` | All (2 pages) | The urgent item. Includes the two-line version for Tarkett |
| 3 | Draft privacy policy | `docs/legal-drafts/privacy-policy.md` | All (4 pages) | For mark-up |
| 4 | Draft terms of service | `docs/legal-drafts/terms-of-service.md` | All (3 pages); section 9 is Q5 | For mark-up |
| 5 | Legitimate interests assessment, 5 August 2026 | `LEGITIMATE_INTERESTS_ASSESSMENT.md` | Sections 0, 3, 4 and 5. Skip the rest unless needed | The reasoning Q1 and Q2 rest on. Written by an engineer, and says so |
| 6 | Console privacy checklist | `docs/console-privacy-checklist.md` (in PR #37) | All (1 page) | What we think must happen before Tarkett sees per-shop data |
| 7 | Photos privacy wording | `docs/legal-drafts/photos-privacy-line.md` (in PR #43) | Only if photos are in scope for this instruction | A later feature, switched off. Has its own five questions. Can wait |

**Also attach, from outside the repository:**

- The current live pages, as they stand today: app.stellarlocal.co.uk/privacy and /terms, and the marketing site's privacy page. (So the mark-up can be compared with what is published.)
- [The agreed scope document with Tarkett, and any contract or order form. Liam's email, not in the repository.]
- [Any DPAs already signed with processors.]

**Do not send:** the code, the database schema, the build plans, or the merge runbook. Nothing in them is needed for these questions.

---

## 10. Changes since the drafts were written (14 November)

So the mark-up is not done against a moving target. All of these are in unreleased changes.

| Change | Effect on the drafts |
|---|---|
| **Voice profile** (PR #38): a shop, or a rep for it, can say how its posts should sound | Add a row to privacy policy section 3, and mention in section 5 that these notes go to the AI provider. Low risk: business information, though a sign-off can contain a first name. |
| **Low-star reviews at set-up** (PR #38 and #42): set-up no longer writes AI replies to 1 to 3 star reviews. It drafts the fixed holding reply for recent ones and waits for the shop's approval | Privacy policy section 5, "Older reviews", and terms section 3, "Set-up", need a sentence each. The change makes the service more cautious, not less. |
| **First three posts need approval** (PR #35) | Terms section 3 says a post goes out unless cancelled. That is now true only from the fourth post. |
| **Review card** (PR #40): a printable QR code to Google's review page | No personal data. Terms section 3 says we do not "ask your customers for reviews": still true, the shop does, with a card. Worth one line so nobody is surprised. |
| **Photos** (PR #39, #43), switched off | See document 7. Terms section 3 says we do not add photos: still true while it is off. |
| **Sign-in cookie** (PR #25): now signed and expiring | No wording change; section 11 of the privacy policy is already accurate. |

---

## 11. A suggested scope, if a fixed fee helps

1. Read documents 1 to 6 (about an hour).
2. One call of 45 minutes with Liam, mainly on sections 5 and 7.
3. Written answers to Q1 to Q6 and the four points at the end of section 5, short form.
4. Mark-up of documents 2, 3 and 4.

Photos (document 7) and any agreement with Tarkett can be a second, separate piece of work.
