# Legitimate interests assessment — the Stellar retailer records

**Status: DRAFT for review. Not agreed, not relied upon, nothing published from it.**

**Not legal advice.** This is an engineer's structured reading of ICO guidance, written so the
reasoning is visible and can be checked by someone qualified. Two conclusions below are
uncomfortable, and they are stated rather than smoothed over — an LIA that reaches the answer you
wanted is not worth recording.

Follows the ICO's three-part structure: purpose test, necessity test, balancing test.

---

## 0. What is actually held, and about whom

Counted from production on 2026-08-05, excluding one synthetic test row (`source_ref` `wt-002`):

| | n |
|---|---:|
| Real retailer records | **180** |
| With a contact email | 176 |
| — of which **non-generic** local part (`firstname@…`) | **105** |
| — of which generic (`info@`, `sales@`, …) | 71 |
| Names containing `ltd` / `limited` / `llp` / `plc` | 19 |
| **Retailers who have signed up** | **0** |

Per record: business name, address, postcode, website, contact email, a computed Google Business
Profile score, a band, and a score history with measurement dates.

**Whose personal data is this?** A limited company's details are not personal data. But 19 is a
*name heuristic*, not a Companies House check, and FOLLOWUPS already records that a name match does
not establish the address belongs to that company. The remaining ~161 are likely sole traders or
unincorporated partnerships, where the business name, address and email can identify a natural
person. The 105 non-generic addresses are near-certainly personal data.

**Working assumption: most of the 180 are personal data.** Only confirmed incorporated bodies sit
outside UK GDPR, and that set has not been confirmed.

## 0.1 Two different processing operations, which must be assessed separately

Conflating these is the main way this assessment could go wrong.

- **P1 — holding the records and scoring them.** Matching each retailer to their Google Business
  Profile, computing a score from public Google data, keeping it and its history.
- **P2 — first-contact email.** Emailing a retailer, who has never heard of us, to invite them.

The Article 14 notice on `/privacy` concerns P1, which is what we do *today*. P2 has not happened —
`scripts/send-invites.ts` is held — and has an additional gate that is not UK GDPR at all (§4).

---

## 1. Purpose test — why do we want to process this data?

### P1 — holding and scoring

**The interest.** Delivering a service Tarkett commissioned for its stockist network: identify which
retailers exist, match each to the right Google listing, measure how that listing performs, so that
(a) a retailer who joins sees their own baseline and their improvement, and (b) Tarkett can be told
in aggregate how its network is doing.

**Is it legitimate?** Yes. Commercial interests are expressly capable of being legitimate interests.
There is also a modest third-party benefit: consumers searching for a local flooring shop are better
served when those listings are accurate and complete.

**Is it real and specific, or speculative?** Real, but currently **prospective**. Nought of 180 have
signed up, so no individual has yet received the benefit that partly justifies holding their data.
The interest is genuine; the realised benefit is, so far, entirely Tarkett's and ours.

**Who benefits, and how much?** Useful for Humans Ltd (commercial), Tarkett (network insight), the
retailer (a free service that improves their visibility) — but only if they engage, and none have.

### P2 — first-contact email

**The interest.** Telling a retailer that a service exists which is free to them.

**Is it legitimate?** Direct marketing is named in Recital 47 as capable of being a legitimate
interest. That establishes it can be, not that it is — Recital 47 also says the balance must still
be struck, and the same recital stresses reasonable expectations.

---

## 2. Necessity test — is this processing necessary for that purpose?

"Necessary" does not mean indispensable; it means the purpose cannot reasonably be achieved by a
less intrusive route.

### P1 — passes, but only for some of the fields

- **Name, address, postcode:** necessary. You cannot match a retailer to the correct Google listing
  without them. The matching work is direct evidence of this — even *with* those fields, four
  matcher defects produced false zeros and 33 rows needed a human. Less identifying data would make
  the matching worse, and mis-matching attaches one business's score to another.
- **Website:** helpful corroboration for matching. Defensible.
- **Score and history:** necessary for the stated purpose of showing improvement over a baseline.
- **Contact email: NOT necessary for P1.** Scoring and baselining do not require it. It is held
  solely to enable P2. This is the cleanest finding in the whole assessment: **105 people's personal
  email addresses are being retained for a purpose that does not need them.**

### P2 — does not pass

There is a demonstrably less intrusive route to the identical outcome, and it is already written
down as option 1 in FOLLOWUPS: **Tarkett makes first contact.** Tarkett has an existing commercial
relationship with every one of these retailers. It can tell them about the service without a company
they have never heard of processing their personal email address for marketing.

When a less intrusive means is not merely conceivable but *already identified as the preferred
option*, the necessity limb fails. This is not a close call.

---

## 3. Balancing test — do our interests override the retailer's rights?

### Pointing our way

- The source data is **public** — Tarkett publishes it on its own store locator.
- It is **business-context** data, not private life; no special category data; no children.
- The purpose is **benign and pro-retailer**: a free service that improves their visibility.
- **No profiling of individuals**, no automated decision with legal or similarly significant effect,
  no sale of data, no use for advertising, no enrichment from other sources.
- The dataset is **small (180) and narrow**.

### Pointing against

- **No relationship whatsoever.** They know Tarkett. They have never heard of Useful for Humans Ltd
  or Stellar Local. Reasonable expectations are the heart of the balancing test, and a retailer who
  published an email address so *customers* could reach them would not expect a third party to copy
  it, assess their business, and store the result.
- **The score is not public data.** This matters more than it first appears. The *inputs* are public
  (rating, review count, completeness), but the **derived score and band — "Weak", "Strong" — are a
  new judgement about their business that did not exist before, was created without their knowledge,
  and is stored against their name.** That is meaningfully more intrusive than holding a copy of a
  public listing, and it is the part a retailer would be most surprised by.
- **They have not been told, and the deadline has passed.** Article 14(3) requires notice within a
  reasonable period and **at the latest one month** after obtaining the data. Obtained June 2026; it
  is now August 2026; nobody has been told. This is a live compliance gap **independent of which
  lawful basis applies** — a correct basis does not cure a missing notice.
- **No retention limit exists.** Nothing deletes a retailer record, ever. `retailers.user_id` is
  `on delete set null`, so records deliberately survive account deletion, and no policy or job
  removes them otherwise. Indefinite retention of personal data with no stated period weighs
  directly against us on the balance.
- **No opt-out has ever been offered**, because nobody has been contacted.
- **The benefit is unrealised.** 0 of 180 signed up. Today the processing serves our interest and
  Tarkett's, and nobody else's.

### Mitigations that would change the balance

1. **Give the Article 14 notice.** Overdue; drafted; the single highest-value action.
2. **Unconditional erasure and objection route**, not conditioned on having an account. Drafted.
3. **Set a retention period** and actually delete — e.g. records of retailers who never engage.
4. **Stop holding the 105 personal emails** until contact is actually authorised, or hold only the
   generic ones, or only confirmed corporate bodies.
5. **Tarkett makes first contact**, removing the "never heard of you" objection where it bites most.

---

## 4. The point that overrides all of the above for P2

For **direct marketing by electronic mail**, PECR — not UK GDPR — is the operative gate, and
**legitimate interests cannot cure a PECR breach.**

Under PECR, sole traders and unincorporated partnerships are treated as **individual subscribers**.
Unsolicited marketing email to them requires **consent**, or the soft opt-in (an existing customer
relationship arising from a prior sale or negotiation, for similar products, with an opt-out offered
at collection and in every message).

**Soft opt-in fails here.** There has been no prior sale or negotiation between the retailer and
Useful for Humans Ltd. Tarkett's relationship is Tarkett's, and soft opt-in is not transferable
between controllers.

Corporate subscribers (limited companies, LLPs, PLCs) may be emailed without consent, still subject
to Regulation 23 (identify the sender, provide a valid opt-out address). That is the 19 — and 19 is
an unconfirmed name heuristic.

**Therefore:** perfecting this LIA does not unblock the invite send. Even a flawless legitimate
interests case leaves the PECR position unchanged for the majority of the cohort. **The LIA is not
the blocker; PECR is.** This is the substantive reason to take option 1 (Tarkett makes first
contact) rather than a reason to keep refining the paperwork.

---

## 5. Outcome

| Processing | Outcome |
|---|---|
| **P1** — name, address, postcode, website, score, history | **Legitimate interests is arguable and probably holds** — *conditional on* the Article 14 notice being given, an unconditional erasure route existing, and a retention period being set. Two of those three are not met today, so the basis is **not yet safely relied upon**. |
| **P1-email** — the 105 personal email addresses | **Weakest element. Fails necessity for P1.** Held only to enable P2, which itself does not pass. |
| **P2** — first-contact marketing email | **Fails the necessity test** (less intrusive route exists and is already preferred), and is **separately barred by PECR** for individual subscribers regardless. |

## 6. What this means for the privacy notice

The notice should state the basis for **what we actually do now** — holding and scoring — and should
**not** assert a basis for marketing email while P2 is unresolved. Proposed wording, subject to your
agreement and ideally to a solicitor's eye:

> **Our lawful basis.** We rely on legitimate interests: we need to know which retailers are in
> Tarkett's network, and how their Google listings are performing, in order to provide the service
> Tarkett funds for them. We have weighed that against your rights and recorded the assessment. You
> can object at any time, and we will remove your record — you do not need a reason, and you do not
> need to have an account.

## 7. What still needs a solicitor

- Whether the P1 conclusion is right at all, given the notice is already overdue.
- The PECR classification of each retailer (individual vs corporate subscriber). 19 is a heuristic.
- Whether the derived score changes the analysis in a way this assessment has understated.
- The liability clause in `/terms`, which is anchored to fees a free retailer never pays — tracked
  separately and untouched.
