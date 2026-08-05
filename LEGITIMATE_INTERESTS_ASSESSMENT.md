# Legitimate interests assessment — the Stellar retailer records

**Status: reviewed and agreed 2026-08-05. This is the record behind the lawful basis stated on
`/privacy` for the Stellar tenant, and it is relied upon.**

Agreed by the business owner, not by a solicitor. The points in §7 remain open, and §4's conclusion
stands: this assessment does **not** authorise the invite send, which is gated by PECR rather than by
anything decided here.

**Publishing the notice is not the same as giving it.** Article 14 requires the information to be
*provided* to the data subject; a page they have never visited does not do that. The obligation
described in §6.5 is still outstanding for all 180.

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

**Corrected 2026-08-05 against the real schema** — an earlier version of this section named fields
that are not held, which in a privacy notice is a defect in its own right. What is actually held sits
in **two places**:

| Store | Fields |
|---|---|
| `retailers` (database) | `name`, `town`, `nation`, `contact_email`, plus Google-derived `place_id`, `rating`, `review_count`, `photo_count`, `has_website`, `score`, `band`, `headline_gap`, `scored_at` |
| `scripts/source-data/retailers-locations.csv` (**committed to a public repo**) | id, name, address lines, city, county, postcode, nation, full address, latitude/longitude, website, Tarkett store URL — emails stripped |

`retailers` has **no address, postcode or phone column**. The address data lives only in the
committed file. Any notice must describe both, or it understates what is held.

The committed file being public is not a fresh disclosure — it is a copy of what Tarkett already
publishes — but it is a second copy under our control and it is in scope for an erasure request.

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

### The retention period, as agreed (softened 2026-08-05)

Tied to the stockist relationship rather than an arbitrary clock, because that is what the purpose is
actually tied to — we hold the record to serve Tarkett's network, so it should last exactly as long
as membership of that network does:

The first draft promised an annual re-check and deletion within six months of a retailer dropping off
Tarkett's list. **That was withdrawn**: no refresh job and no deletion job exist, so it would have
been a policy promising an erasure the system does not perform — the same defect this notice was
written to correct, reintroduced two paragraphs later.

Agreed wording, which states the **criteria** and is honest that the review is manual:

> We keep it **for as long as you are listed as a stockist on that page and we are providing this
> service to that network. We review that by hand rather than automatically, so your record may
> persist for a while after you stop being listed.** You can ask us to delete it at any point and we
> will — that request we act on straight away.

Article 14(2)(a) expressly permits stating the criteria where a definite period is not possible, so
this is the supported route rather than a way round the requirement.

**Erasure on request is the one firm commitment here**, and it is one we actually perform — by hand,
off the privacy mailbox. Everything else is described as it really works.

Building the refresh-and-delete remains worth doing, and would let this wording be tightened. It is
logged in FOLLOWUPS as an improvement rather than a blocker, which is the correct status now that the
notice no longer over-promises.

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

## 6.5 Giving the notice — who must receive it, and what it must say

### Who

**Not just the 105.** The Article 14 duty attaches to the *record*, not to the email field. A sole
trader is identifiable from their business name and address whether their address is `dave@` or
`info@` — so a generic email does not make the record non-personal, it only makes that one field
less personal. The 105 is the set where the email is *obviously* personal data, not the set that is
owed a notice.

The population owed a notice is **every record about a natural person** — i.e. all 180 minus
confirmed corporate bodies. That corporate set has never been confirmed: 19 is a name heuristic, and
FOLLOWUPS already records that a name match does not establish the address belongs to that company.

**So: treat all 180 as owed the notice.** Segmenting risks omitting someone entitled to it, saves
nothing, and over-notifying a limited company is harmless — it is information, not marketing.

### The four with no email — HELD, not deleted (decided 2026-08-05)

| `source_ref` | Business | Town |
|---|---|---|
| `29478` | Northumbria Flooring & Furniture | North Shields |
| `29705` | Northumbria Flooring & Furniture | Blyth |
| `30089` | Tees Valley Flooring | Stockton on Tees |
| `29876` | The Design House | Holmes Chapel |

They cannot be emailed: `retailers` holds no phone and no address, and the addresses exist only in
the committed source file. Deleting them would have discharged the obligation, and that was
considered and **rejected** — the records are part of the Tarkett baseline and deleting data to avoid
having to tell someone about it is the wrong instinct even when it is lawful.

**They are held out of any send batch.** Today that is automatic — you cannot email a null address —
but the rule is written down because it must survive someone backfilling an address later:

> A send batch is built from `contact_email is not null` **and** excludes these four `source_ref`
> values. If an email address is ever obtained for one of them, that does **not** make them sendable:
> they are held pending an Article 14 notice delivered by another route.

This is recorded rather than enforced in code because **no sender exists** — `scripts/send-invites.ts`
is referenced in FOLLOWUPS but has never been written. Building one to enforce a hold would be
building the very thing that is on hold. Whoever writes it owns this rule.

Their Article 14 notice therefore has to go by post, or not at all until they are contacted by
another route. Do not reach for Article 14(5)(b) — "proves impossible or disproportionate effort" is
a high bar and four letters clears it easily.

### What it must say

Article 14(1)–(2) sets the required elements. Mapped against the drafted `/privacy` section:

| Required | Where |
|---|---|
| Controller identity and contact details — 14(1)(a) | Present (`Useful for Humans Ltd`, support/privacy addresses) |
| Purposes and **lawful basis** — 14(1)(c) | Added — legitimate interests, stated plainly |
| Categories of personal data — 14(1)(d) | Added — corrected against the real schema |
| Recipients — 14(1)(e) | Added — processors listed, and Tarkett's position stated explicitly: aggregate counts only, and the assessment is not handed back |
| Retention period — 14(2)(a) | Added — tied to stockist status |
| The legitimate interests pursued — 14(2)(b) | Added |
| Rights incl. **objection** — 14(2)(c) | Added, unconditional and not tied to having an account |
| **Right to complain to the ICO** — 14(2)(e) | Added, and it was missing for *every* tenant (Article 13(2)(d) requires it for directly-collected data too) |
| **Source of the data** — 14(2)(f) | Added — named, linked, dated, and flagged as publicly accessible |
| Automated decision-making — 14(2)(g) | Added — none engaging Article 22. The score is an assessment of a public listing, not a decision about a person, and nothing acts on it automatically |

### The trap

**The notice must not carry the invitation.** Sending "we hold your data" is discharging a legal
obligation and is not direct marketing. Bundling it with "and here is a free service, sign up" makes
it a **marketing email**, at which point PECR applies and §4 says most of the cohort cannot lawfully
receive it. The temptation to combine the two will be strong because it saves a send. It would
convert a compliance fix into the exact breach this assessment says to avoid.

Send the notice clean. Let Tarkett make the introduction separately.

## 7. What still needs a solicitor

- Whether the P1 conclusion is right at all, given the notice is already overdue.
- The PECR classification of each retailer (individual vs corporate subscriber). 19 is a heuristic.
- Whether the derived score changes the analysis in a way this assessment has understated.
- The liability clause in `/terms`, which is anchored to fees a free retailer never pays — tracked
  separately and untouched.
