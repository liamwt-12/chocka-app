# Documents: what each one is and where it lives

Written 16 November 2026, refreshed 18 November 2026, and again for the retention build (#64 to #69). This repository is **public**, so some documents are deliberately kept out of it.

"Where" tells you how to read a document today:

- **On main**: in the repository now.
- **In PR #n**: written, but only on that pull request's branch until it is merged. Read it on GitHub, or with `git show origin/<branch>:<path>`.
- **Not committed**: on Liam's machine only, on purpose.

## Start here

| If you want to… | Read |
|---|---|
| Merge the open pull requests | `docs/merge-runbook.md` (PR #41, and in the release PR #63). It describes two ways: one merge, or twelve stages |
| Test the whole product on your own Google listing | `docs/test-listing-runbook.md` (PR #45) |
| Brief the solicitor | `docs/legal-drafts/solicitor-briefing.md` (PR #44) |
| Know what was done overnight and what is waiting on you | `docs/overnight-report.md` (not committed) |
| Show a Tarkett rep how to onboard a shop | `docs/rep-guide.md` (PR #31, updated in #56 and #61) |
| Give Tarkett the words to invite a shop | `docs/invite-wording.md` (PR #56). On the solicitor's list |
| Write the monthly update to Tarkett | `docs/templates/new-this-month.md` (PR #62). A template; nothing sends it |
| Decide whether to switch on hands-off mode | `docs/hands-off-wording.md` (PR #64). The words a shop agrees to. A draft that needs solicitor review |
| Switch on the review alert and preview emails | `docs/merge-runbook.md`, "Switching on the two silence emails, after your own test" (PR #69) |

## Running and releasing

| Document | What it is | Where |
|---|---|---|
| `docs/merge-runbook.md` | The order to merge the open pull requests, the exact commands, the conflicts and how to resolve them, the database migrations in order, every Netlify setting, and a check after each stage | PR #41 (`docs-merge-runbook`) |
| `docs/test-listing-runbook.md` | A step-by-step end-to-end test on your own Google listing: setup, the model test call, onboarding, a post, a reply, a photo, the report, an undo, and putting everything back | PR #45 (`docs-test-listing-runbook`) |
| `supabase/README.md` | How the database is managed: staging, the migration scripts and their safety checks | On main |
| `TEST_MATRIX.md` | The live Google test for different kinds of account (owner, manager, group), using throwaway accounts | On main |
| `SECRETS_AT_REST.md` | How stored Google credentials are encrypted | On main |

## Checks and reports

| Document | What it is | Where |
|---|---|---|
| `docs/dummy-run-report.md` | The dummy run on staging: every flow driven through the real code with Google and the model faked. What passed, the bugs it found, and how to run it again. 54 checks as of #62 | PR #48, updated in #60 and #62 |
| `docs/scale-check.md` | How long each scheduled job takes at 10, 180 and 500 shops against Netlify's limits, and the simulation of 92 shops starting in one week | PR #49, updated in #60 |
| `docs/consistency-checks.md` | Model ids, settings against the runbooks, which routes check what, what gets logged, and test stability | PR #50 (`chore-consistency-fixes`) |
| `docs/secrets-scan.md` | A scan of the working tree and history for keys, passwords and committed personal data | **Not committed.** Its findings are for Liam first |
| `FOLLOWUPS.md` | Deferred work, with the reasoning for each item. Used in place of TODO comments | On main |

## Legal (all DRAFT, none published, none sent)

| Document | What it is | Where |
|---|---|---|
| `docs/legal-drafts/README.md` | Index of the drafts and the six questions for the solicitor | PR #30 (`docs-legal-drafts`) |
| `docs/legal-drafts/solicitor-briefing.md` | One pack for the solicitor: who is who, a data map, the Article 14 position and timeline, the six questions with context, what changes if Tarkett sees per-shop data, and what to send | PR #44 (`docs-solicitor-briefing`) |
| `docs/legal-drafts/privacy-policy.md` | Draft privacy policy matching what the product does | PR #30 |
| `docs/legal-drafts/terms-of-service.md` | Draft shop terms | PR #30 |
| `docs/legal-drafts/article-14-notice.md` | The notice owed to the shops on Tarkett's store locator, and a two-line version for Tarkett's first message | PR #30 |
| `docs/legal-drafts/photos-privacy-line.md` | Draft privacy wording for shop photos, checked against the code | PR #43 (`feat-photo-deletion`) |
| `docs/console-privacy-checklist.md` | What must be true before the Tarkett console is switched on | PR #37 (`feat-tarkett-console`) |
| `LEGITIMATE_INTERESTS_ASSESSMENT.md` | The August 2026 assessment behind holding the store-locator records. Written by an engineer, and says so | On main |

## For people using the product

| Document | What it is | Where |
|---|---|---|
| `docs/rep-guide.md` | A plain guide for a Tarkett rep: adding a shop, generating its link, what each status means | PR #31 (`feat-pilot-admin-tools`) |
| `docs/invite-wording.md` | Draft words for Tarkett to send a shop with its link. We never send it | PR #56 |
| `docs/templates/new-this-month.md` | A fill-in template for a monthly update to Tarkett, with rules for whoever fills it in | PR #62 |
| `docs/offboarding-email.md` | Draft email to the old Chocka test accounts | On main |

## Background and history

| Document | What it is | Where |
|---|---|---|
| `MULTI_TENANCY_PLAN.md` | How one app came to serve two brands (Chocka and Stellar Local), in stages | On main |
| `scripts/source-data/README.md` | How Tarkett's store list was matched to Google listings | On main |
| `scripts/source-data/MATCH_VERIFICATION.md` | The checking of those matches | On main |

## Not committed, on purpose

These stay on Liam's machine. They contain prices, names or commercial terms, or findings that are for Liam first. **Do not commit them while the repository is public.**

| Document | What it is |
|---|---|
| `docs/overnight-report.md` | Running report of each working session: what was done, pull request links, the merge order, what is blocked, and questions for Liam |
| `docs/secrets-scan.md` | See "Checks and reports" above |
| `docs/pr-review.md` | The review of every open pull request: status, problems found, what was fixed, and decisions for Liam |
| `docs/audit-2026-11-14.md` | The November audit of the product against what was agreed |
| `docs/build-plan-2026-11.md` | The build plan that the November pull requests follow |
| `docs/monday-brief.md`, `docs/monday-plan.md` | Notes for the meeting with Tarkett |
| `docs/localo-audit.md` | Notes on a competing product |
| `docs/flow-visual/` | A page of before-and-after screenshots of the onboarding flow, and the notes on load behind it |
| `docs/expansion-readiness.md` | A sized list of what would have to change to serve another country or kind of customer. Nothing in it is built |
| `docs/retention-strategy.md` | A reading of the product from a shop's side and the funder's, and what to build next. The retention build (#64 to #69) came from it. Also listed in `.git/info/exclude` |
| `docs/PRIVATE-CONTEXT.md` | Background notes for whoever is working on the code. Also listed in `.git/info/exclude`, so it cannot be added by accident |

If one of these is ever needed in the repository, make the repository private first, or take the commercial detail out.

## Keeping this up to date

When a pull request that adds a document is merged, change its "Where" to "On main". When a document is added, add a row.
