# DRAFT, needs solicitor review

> Not published. Not legal advice. Written 14 November 2026 from what the code actually does, to replace `app/privacy/page.tsx` once a solicitor has reviewed it. Square brackets mark facts Liam must fill in or decisions still to make. Written for Stellar Local; the same text works for Chocka with the Tarkett sections removed and Stripe added.

# Stellar Local privacy policy

Last updated: [date of publication]

## 1. Who we are

Stellar Local is run by Useful for Humans Ltd [company number, registered address]. We are the **data controller** for the personal data described here: we decide what is collected and why.

Contact: privacy@stellarlocal.co.uk. Everything in this policy can be asked about, or acted on, through that address.

Stellar Local is funded by Tarkett. Tarkett is not a controller of your data under this policy and does not decide what we do with it. Section 7 says exactly what Tarkett can see.

## 2. Who this policy covers

| You are | Sections that apply |
|---|---|
| A retailer who uses Stellar Local | All of it |
| A retailer on Tarkett's public store locator who has not signed up | Section 9, and the separate notice in `article-14-notice.md` |
| Someone who left a review on a listing we manage | Section 4.6 |
| [Only if the direct-contact review engine is chosen: a customer of a retailer] | [Section to be written then. Nothing in today's service collects customer details.] |

## 3. What we collect, and where it comes from

| What | Where it comes from |
|---|---|
| Your name and email address | Google sign-in, or Tarkett when it sets up your invite |
| Your mobile number | You, during set-up, for text updates |
| A Google connection: an encrypted access credential, or the manager access you or a Tarkett rep gave us | Google |
| Your Google Business Profile: business name, address, phone, website, hours, categories, services, description, photos (counts and dates), posts | Google |
| Reviews on your listing: reviewer's display name, rating, comment, date, and any reply | Google |
| Performance figures: views, calls, direction requests, website clicks | Google |
| What we write and publish for you: posts, review replies, drafts awaiting your approval | Us, with AI assistance (section 5) |
| A log of every change we make to your listing, with the values before and after | Us |
| Messages we send you: texts and emails, and when they were sent | Us |
| Invite details: the email address an invite link was sent to, and a scrambled copy of the link | Tarkett and us |
| One sign-in cookie, and standard server logs (IP address, time, page requested) | Your browser |

We do not collect payment details: the service is free to you.

## 4. What we do with it, and our lawful basis

| Purpose | Lawful basis (UK GDPR Article 6) |
|---|---|
| 4.1 Running the service: weekly posts with a Friday preview you can cancel, review replies, weekly stats by text, a monthly report with your presence score | Contract: it is what you signed up for |
| 4.2 Improving your listing at set-up (description, services, categories, hours), with your agreement on screen | Contract |
| 4.3 Keeping a log of every change so any change can be reversed on request | Contract, and legitimate interests (being able to put things right) |
| 4.4 Telling Tarkett which retailers take part, and showing it a health summary (section 7) | Legitimate interests: Tarkett pays for the service on your behalf and needs to see it working. [Solicitor: confirm, and update the legitimate interests assessment, which was written when Tarkett saw a head count only.] |
| 4.5 Keeping the service secure, and investigating faults | Legitimate interests |
| 4.6 Reading and replying to reviews left on your listing, which involves the reviewer's display name and what they wrote | Legitimate interests (yours and ours): replying to customers publicly, as the review platform intends. We do not contact reviewers. |
| 4.7 Meeting legal obligations | Legal obligation |

We do not sell personal data, and we do not use it for advertising.

## 5. AI, and what happens automatically

Posts and review replies are drafted by an AI model from Anthropic. To write them we send it your business name, trade and town, and for a reply the reviewer's display name, the rating and the review text. [Solicitor/Liam: confirm Anthropic's commercial terms on retention and training for API data, and state them here.]

Some things happen without you pressing a button:

- **Posts.** Each Friday we email you next week's post with a link to cancel it. If you do not cancel it, it is published on Monday morning, UK time.
- **4 and 5 star reviews.** If you have turned automatic replies on, we publish a reply and text you to say so.
- **1 to 3 star reviews.** We draft a reply and wait for you to approve it. Nothing is published without you.
- **Older reviews.** Our daily check does not reply to reviews more than 14 days old. At set-up we offer to reply to up to 20 of your unanswered reviews, and only if you ask.

None of this is a decision about you with legal or similarly significant effects, so Article 22 does not apply. The presence score is our assessment of a public listing, not a decision about a person.

## 6. Who processes data for us

| Provider | What for | Where |
|---|---|---|
| Supabase | Database | Ireland (EU) |
| Netlify | Hosting the app and running scheduled jobs | [USA; confirm region] |
| Google | Business Profile and Places APIs | [USA / global] |
| Anthropic | Drafting posts and replies | [USA] |
| Twilio | Text messages | [USA] |
| Resend | Email | [USA] |

Each acts on our instructions under a data processing agreement. [Liam: confirm a DPA is in place with each.] Where data leaves the UK, we rely on [the UK-US Data Bridge / the UK IDTA or Addendum: solicitor to confirm per provider].

## 7. What Tarkett sees

If you use the service, Tarkett is told that you do, because it is invoiced for each retailer taking part. It can also see a summary of how your Google listing is doing [final list to be agreed with Tarkett, for example: your presence score and band, whether this week's post went out, how many reviews were replied to].

Tarkett is not given your contact details, your phone number, the text of your reviews, or anything about your customers.

If you do not use the service, Tarkett is not given your score or anything else we worked out about your listing.

[If a network league is shown to other retailers, add here what they can see.]

## 8. How long we keep it

| Data | How long |
|---|---|
| Your account and everything attached to it | Until you delete your account in Settings, when it is removed straight away. [Liam: the current terms say "30 days after stopping". Decide which is true and make both documents match.] |
| The change log | [Decide: suggest 24 months, so changes can be reversed for a reasonable time. Entries survive account deletion without your name attached, because they hold only public listing content.] |
| Text and email records | [Decide: suggest 12 months] |
| Server logs | [Netlify's retention: confirm] |
| Your record from Tarkett's store locator | See section 9 |

## 9. If we held a record about you before you signed up

We took a copy of Tarkett's public UK store locator in June 2026 and hold a record for each business on it. The separate notice (`article-14-notice.md`) explains exactly what we hold, why, and how to have it removed. That record is separate from your account and is not deleted with it. Email privacy@stellarlocal.co.uk to have it removed; you do not need an account or a reason.

## 10. Your rights

You can ask us to give you a copy of your data, correct it, delete it, restrict what we do with it, or send it to you in a portable format. Where we rely on legitimate interests you can object, and for the store-locator record we will simply remove it. You can delete your account yourself from Settings, and remove our access in your Google Business Profile settings at any time.

You can complain to the Information Commissioner's Office at ico.org.uk/make-a-complaint. We would rather you raised it with us first, but you do not have to.

## 11. Cookies

We use one cookie, which keeps you signed in for up to 30 days. It is strictly necessary, so it needs no consent. We use no analytics, advertising or tracking cookies.

## 12. Changes

If this policy changes in a way that matters, we will email you before it takes effect.
