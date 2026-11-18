# DRAFT, needs solicitor review

Legal drafts for Stellar Local, written 14 November 2026. **None of these is published or sent.** They are not legal advice.

| File | What it is | Replaces |
|---|---|---|
| `privacy-policy.md` | One privacy policy that matches what the product does today | `app/privacy/page.tsx` |
| `terms-of-service.md` | One set of retailer terms that matches the product | `app/terms/page.tsx` |
| `article-14-notice.md` | The notice owed to the 180 store-locator records, plus a two-line version for Tarkett's first message | Nothing (never sent) |
| `solicitor-briefing.md` | **Start here if you are the solicitor.** A data map, the Article 14 position and timeline, the six questions below with the context to answer each, what changes if Tarkett sees per-shop data, and the exact documents to send | Nothing (a briefing, not a published document) |

## What changed in the app in this PR

The in-app privacy page and terms page promised that Tarkett is told only **how many** retailers use the service, and (privacy page) that our assessment of a listing is "not handed back". Neither survives the agreed scope:

- invoices name each live retailer
- one-pager item 5 is a console showing every participating retailer's health

Both pages now say Tarkett is told *that* a retailer takes part, and can see a health summary. Contact details, phone numbers, review text and customer details are excluded. A retailer who has not joined has their score withheld. **Merging deploys that wording, so it needs the same solicitor review as these drafts.**

## Questions for the solicitor

1. Does sharing a per-retailer health summary with Tarkett change the legitimate interests balance? `LEGITIMATE_INTERESTS_ASSESSMENT.md` relied on "aggregate counts only" as a mitigation.
2. The Article 14 notice is overdue (data obtained June 2026). What is the best course now?
3. Is the two-line notice acceptable inside Tarkett's first message, without making Tarkett a joint controller?
4. What transfer mechanism applies for each US processor?
5. What liability cap is right for a free service? The current "fees paid in 12 months" cap is zero.
6. Does reading and replying to reviews need anything beyond legitimate interests for the reviewers' data?

## Decisions only Liam can make (marked [ ] in the drafts)

- Company number and registered address.
- Retention periods: the change log, the text and email records, and what happens after a retailer stops. The current terms say 30 days, but the code deletes immediately on account deletion.
- Whether "reversed the same working day" is a commitment you can keep.
- The exact list of what the console shows Tarkett (ask Tarkett on Monday: brief question 5).
- Whether DPAs are signed with each processor.
