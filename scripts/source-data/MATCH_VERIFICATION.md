# Match verification — 2026-07-30

The task `FOLLOWUPS.md` set as the precondition for quoting the baseline: re-verify the 36 `review`
rows recording **which arm matched**, and spot-check the five `high` rows with three-letter names.

Both are now done. 41 rows re-fetched from Google Places Details against the `place_id` recorded in
`.score-checkpoint.json`, with `normaliseName` and `classifyMatch` ported byte-for-byte from
`publicAudit.ts:176-227` so the recomputation is comparable to the original run.

Raw per-row evidence: `match-verification-2026-07-30.json` (41 records, no contact details).

## Result in one line

The verification is complete, but **it did not clear the baseline** — it found 9 of the 36 `review`
rows to be probably-wrong matches, plus two scorer defects and three source-postcode defects. The
blocker is no longer a missing check; it is now a **decision about how to treat 9 suspect rows, 8
hard zeros and 1 closed business.**

## The five three-letter names — all clean

| Row | Candidate | Postcode | Why it passed |
|---|---|---|---|
| `AMA Flooring` | AMA Flooring | GL51 9PB ✓ | jaccard **1.00** |
| `EBR Flooring` | EBR Flooring | KA1 4AW ✓ | jaccard **1.00** |
| `JSR Flooring` | JSR Flooring | CO15 4QH ✓ | jaccard **1.00** |
| `MS Flooring` | MS Flooring | CA28 7QF ✓ | jaccard **1.00** |
| `RMD Flooring` | RMD Flooring | B78 3EQ ✓ | jaccard **1.00** |

All five matched on an **exact** name (jaccard 1.00), not the weak substring clause, with a full
postcode hit, the right town, and `businessStatus: OPERATIONAL`. The concern was real in principle —
`MS` normalises to just `ms`, and would falsely pass `nameStrong` against `Image Flooring
Chelmsford` or `Sams Carpet and Flooring Ltd` — but it did not fire on any of the five. **These five
need no further action and can count at full weight.**

Note the flagged set was scoped to the `high` bucket only. The same short-name weakness also affects
`CM Flooring` (`cm`) and `JA flooring` (`ja`) in `review` — both verified below and both fine — and
`JL Flooring` (`jl`), which is one of the eight `NOT FOUND`.

## The 36 `review` rows — which arm matched

Recorded at last: **18 `NAME_ONLY`, 18 `POSTCODE_ONLY`.** Of the 36, **27 are the same business** and
**9 are probably not.**

The original hypothesis — "name matched, postcode didn't" is usually right; "postcode matched, name
didn't" may be a different business — held only partly. Both arms produced false matches, and the
`POSTCODE_ONLY` failures were the more dangerous, as predicted.

### The 9 suspect rows — scores that should not be trusted

| Row | Arm | Score | Reviews | Problem |
|---|---|---:|---:|---|
| `Floor Store U.K` | POSTCODE_ONLY | 91 | 114 | candidate is **Floor Giants Swansea** — different business, same industrial unit |
| `Amtico Flooring Installations Limited` | POSTCODE_ONLY | 81 | 87 | candidate is **Balham Flooring Studio** — unrelated name, same postcode |
| `The Floor Studio` | POSTCODE_ONLY | 78 | 33 | candidate is **FloorCraft Cheshire Ltd** — unrelated name, same postcode |
| `Carpet Cuts` | NAME_ONLY | 77 | 101 | candidate is 15mi away in Coalville LE67; row is Swadlincote DE11 |
| `The Flooring and Carpet shop` | NAME_ONLY | 77 | 30 | candidate **The Carpet Company** normalises to empty — see defect 1 |
| `Flooring Storage UK` | POSTCODE_ONLY | 76 | 17 | candidate is **Flooring Supplies UK.com** — different business, same postcode |
| `Hughes Flooring` | NAME_ONLY | 59 | 16 | candidate is **Hughes Forrest Pontypridd**; passed only on substring, jaccard 0.33 |
| `Floortek Supplies` | POSTCODE_ONLY | 37 | 3 | candidate is **Grange Farm Industrial Est** — not a business, it is the estate |
| `Tees Valley Flooring` | NAME_ONLY | 33 | 6 | candidate is **Tees Valley Joinery Ltd** — a joinery; passed on jaccard 0.67 as *strong* |

Two of these are worth singling out. `Floor Store U.K` at 91 with 114 reviews is the highest-scoring
row in the whole suspect set and it is almost certainly scoring a different company's reviews.
`Tees Valley Flooring` passed the **jaccard ≥ 0.60 test**, not the substring fallback — meaning the
"strong name match" arm itself is not safe on this list, because stripping the trade words leaves
place-name tokens (`tees valley`) that many local firms share.

### Also: one row is a closed business

`Winnens 1929 ltd` (Cheltenham GL51 9FB, score 21) matches **Winnens Flooring & Interiors** — the
right business, but `businessStatus: CLOSED_PERMANENTLY`. It should probably leave the denominator
entirely rather than sit in it as a low score.

## Two scorer defects found

**1. An empty normalised candidate name matches everything.** `classifyMatch` at `publicAudit.ts:221`
guards `na` (`na.length > 0`) but never `nb`:

```
row       'The Flooring and Carpet shop' -> na = 'and shop'
candidate 'The Carpet Company'           -> nb = ''          <- every trade word stripped
na.includes(nb)  ==  'and shop'.includes('')  ==  true        -> nameStrong
```

`nameSimilarity` is guarded against this (`:193` returns 0 on an empty token set); the substring
clause is not. On a flooring list, any candidate named purely from the strip-list —
`The Carpet Company`, `Carpets Ltd`, `The Flooring Co` — normalises to empty and matches every row it
is offered against. 1 of the 41 rows hit this.

**2. The trade-word stripper deletes too much signal.** Already noted in `FOLLOWUPS.md`, now with a
concrete casualty: `Tees Valley Flooring` vs `Tees Valley Joinery Ltd` reaches jaccard 0.67 once
`flooring` and `ltd` are gone, and is classified `high`-strength on the name arm.

## Three source-postcode defects

| id | Row | In source | Correct | Evidence |
|---|---|---|---|---|
| `29891` | Elvet Flooring Solutions | *(blank)* | **DH1 5QU** | OSM forward + reverse at the row's own lat/lng + streetcheck all agree; valid, County Durham, Framwellgate & Newton Hall |
| `29658` | Home Carpets by Neil Mcbrearty | `CA1 25N` | **CA1 2SN** | `CA1 25N` is **not a valid postcode** (digit `5` typed for letter `S`); `CA1 2SN` is Carlisle/Botcherby and is exactly the candidate's address |
| `29705` | Northumbria Flooring & Furniture | `NE24 5 SU` | *(needs a decision)* | `NE24 5SU` is valid but sits in **Blyth, Northumberland** — it contradicts the row's own town of North Shields; the candidate is `NE29 7TY, North Shields` |

`29658` is a **false `review`**: the postcode arm failed only because the source postcode is invalid.
Correct it and the row becomes a genuine two-arm match. `29705` is the same story — name matches,
town matches, only the postcode disagrees, and the postcode is the thing that is wrong.

Elvet's postcode is **not** PAF/house-number verified — OSM has no house-number data for Winchester
Road. Three sources agree on the street, and it is a residential street consistent with a
home-based sole trader, but number 8 specifically is inferred. Tarkett's own store page for `29891`
carries no postcode either, so the gap originates upstream.

**These corrections are recorded here, not applied to `retailers-locations.csv`,** which is
documented as byte-identical to the source apart from the two scrubbed email cells. Apply them
deliberately if and when the baseline is recomputed.

## What this does to the headline number

| Treatment | Mean |
|---|---:|
| All 180, as imported | **73.5** |
| Excluding the 9 suspect rows | 73.8 |
| Excluding the 8 `NOT FOUND` zeros | 76.9 |
| Excluding both | **77.4** |

The spread is **73.5 – 77.4** depending on treatment. Note the 9 suspects barely move the mean on
their own (+0.3) because they sit near it; the damage they do is to **per-retailer credibility**, not
to the aggregate. If Tarkett looks up `Floor Store U.K` and sees another company's 114 reviews, the
number being roughly right does not help.

The 8 zeros are what actually move the aggregate, and at least one of them (Elvet) is a known
false negative.

## Round two — re-match of the 8 zeros and hand-check of the top 4 suspects

Same day. `findPlace` re-run (`places:searchText`, 5km `locationBias`, `maxResultCount` 5) for the
eight `NOT FOUND` rows with Elvet's postcode supplied, plus the full candidate list for the four
highest-scoring suspects. Raw evidence: `rematch-2026-07-30.json`.

**Important caveat on the re-scores below.** They are computed from Places data as at **2026-07-30**,
using a validated port of `scorePlace` (verified against Hopkins Flooring's recorded 71: 29.75 rating
+ 16 reviews + 25 completeness = 70.75 → 71). The baseline was generated **2026-06-21**, six weeks
earlier. Review counts have grown in between, so a re-score is *today's* number, **not** a restatement
of what the baseline should have said.

### The 8 zeros: 5 are real, 3 are false negatives

| Row | Best candidate found | Verdict |
|---|---|---|
| `Sams Carpet and Flooring Ltd` | **Sam's Carpets and Flooring**, 5 James Watt Pl, East Kilbride G74 5HG — 4.9★, 275 reviews | **FALSE ZERO.** Same street, same unit number. Re-scores **98 (Strong)**. See defect 1. |
| `Beccles Carpet Centre` | **Beccles Home & Flooring**, 1 Common Ln N, Beccles NR34 9BN — 4.7★, 126 reviews | **Probable false zero** — looks like a rename; same town, adjacent postcode. Re-scores 91. Needs one human confirmation that it is the same business. |
| `Multisave Carpets` | **Multi-Save Capets** *(Google's own typo)*, 12 S Walk, Yate, Bristol BS37 4AP | **Probable false zero** — same business, different site (BS30 → BS37, ~8mi). Re-scores 62. |
| `Elvet Flooring Solutions` | 5 candidates returned with `DH1 5QU` supplied — Floorcraftne, Hive Flooring, Frank's ×2, Minnikin. **None is Elvet.** | **Real zero. Resolved.** Elvet has no Google Business Profile. The missing postcode was not what caused the 0. |
| `JL Flooring` | **Zero candidates returned at all.** | **Real zero.** |
| `Elite Installations` | `Elite Glass And Windows` — different trade | **Real zero.** |
| `Signature Floors Pembroke` | `O'Brien Design Floors`, Saundersfoot | **Real zero.** |
| `Thompsons Floooring` | `Harston and Jones Flooring`, Whitfield | **Real zero.** Confirms the `Floooring` typo was never the cause. |

### The top 4 suspects: 3 confirmed wrong, 1 defensible

- **`Floor Store U.K` (91) — confirmed wrong.** `SA7 9AH` is Swansea Enterprise Park and holds at
  least two flooring firms: the matched `Floor Giants Swansea` (119 reviews) and
  `Budget Carpet & Flooring Centres ltd` (207 reviews). `Floor Store U.K` appears nowhere in the
  results. The match was a shared-postcode coincidence at **jaccard 0.17**.
- **`Amtico Flooring Installations Limited` (81) — confirmed wrong.** Nothing at `SW12 9AZ` in the
  results; the nearest same-name thing is `Amtico Flooring Studio` in SE1 with 0 reviews. The 81
  belongs to `Balham Flooring Studio`.
- **`The Floor Studio` (78) — confirmed wrong.** Exactly one candidate returned:
  `FloorCraft Cheshire Ltd`, a different business at the same address. `The Floor Studio` is not in
  Places for this query, so this row is arguably a real zero.
- **`Carpet Cuts` (77) — defensible, but the row's address is stale.** `Carpet Cuts` genuinely exists
  (Coalville LE67 3NB, 102 reviews, jaccard 1.00) — but the business now at the row's own address,
  *4 High St, Swadlincote DE11 8HY*, is **`Ayres flooring Ltd`**. Either Carpet Cuts moved and Ayres
  took the premises, or the Tarkett record is out of date. The score is the right business at the
  wrong address. A judgement call about whether the retailer relationship follows the business or the
  site.

### Revised numbers

De-duplicating the three `place_id` collisions, correcting the three false zeros and handling the
three wrong matches:

| Treatment | n | Mean |
|---|---:|---:|
| As imported | 180 | 73.5 |
| De-duplicated by `place_id` | 177 | 73.5 |
| + 3 false zeros corrected | 177 | 74.9 |
| + 3 wrong matches zeroed | 176 | 73.8 |
| + 3 wrong matches and 1 closed dropped | 173 | **75.1** |

**73.5 – 75.1**, tighter than round one's 73.5 – 77.4 — the false-zero corrections push up and the
wrong matches push down, and they largely cancel. The count is the bigger correction: **177 distinct
businesses, not 180**, one of them permanently closed.

## Round three — the two lookups, the remaining 5 suspects, and the final number

### `Beccles Carpet Centre` — confirmed false zero

Decisive: a Places query on the business's *original* trading name returns the new profile as the
only result.

```
"Beccles Carpet & Rug Centre, Beccles"  ->  Beccles Home & Flooring, 1 Common Ln N, NR34 9BN
                                            4.7*, 126 reviews, OPERATIONAL
```

Local press confirms the Gosford Road shop moved to Common Lane North (opposite Lidl) and amalgamated
with the neighbouring `Beccles Home Interiors`. The Tarkett row's `Gosford Road, NR34 9QP` is the
pre-move address. Same business, renamed and relocated. **0 → 91.**

### `Multisave Carpets` — the zero is CORRECT

This reverses the round-two call. Three separate queries at `BS30 7DA` return `Tapi Carpets & Floors`
and `The Carpet Barn` — nothing named Multisave. Independent web sources firmly place
`Multisave Carpets` at *Unit 9d, Aldermoor Way, Longwell Green, Bristol BS30 7DA*, trading since 1986
with a live website and published opening hours. The `Multi-Save Capets` listing found in round two is
in **Yate, BS37 4AP**, about 9 miles away, and is not that shop.

So the business is real and trading but **has no Google Business Profile at its own address** — which
is precisely what the score is measuring. Assigning it the Yate listing's 62 would have been wrong.
**Stays 0.**

### The remaining 5 suspects — 1 reversal, 4 confirmed wrong

`Flooring Storage UK` (76) — **reversed to a correct match.** Its matched candidate
`Flooring Supplies UK.com` is at *Unit 9 The, Summit Centre, Summit Rd, Potters Bar EN6 3QW* — the
row's address string, unit for unit — and is the only result returned. `Storage` vs `Supplies` looks
like a transcription slip in Tarkett's list. Same business. **Score stands.**

| Row | Score | Finding |
|---|---:|---|
| `The Flooring and Carpet shop` | 77 | Nothing at the row's `DT1 3SF`. Matched `The Carpet Company` at a different Poundbury address, via the empty-normalisation bug (jaccard 0.00). **Wrong.** |
| `Hughes Flooring` | 59 | An exact-name `Hughes Flooring` exists — in **Cheltenham GL51**, ~90mi from the row's Pontypridd. The Pontypridd match is `Hughes Forrest`, a different firm. **Wrong on both counts.** |
| `Floortek Supplies` | 37 | Nothing named Floortek at `OX25 3PD`. The 37 is the industrial estate's own listing. **Wrong.** |
| `Tees Valley Flooring` | 33 | `Tees Valley Refurbishments Ltd` *also* scores jaccard 0.67 — the normaliser gives 0.67 to any `Tees Valley X Ltd`. No flooring business at the row's address. **Wrong.** |

### Final tally on the 9 suspects

**2 keep, 7 unverifiable.** `Carpet Cuts` (right business, stale address — retained by decision, address
flagged) and `Flooring Storage UK` (correct match) stay. The other seven scored a different business
and their true score is unknown.

### The final defensible baseline

De-duplicated to distinct businesses; two confirmed false zeros corrected; seven unverifiable rows and
one closed business excluded.

| Treatment | n | Mean |
|---|---:|---:|
| A. Status quo, de-duplicated only | 177 | 73.5 |
| B. + 2 confirmed false zeros corrected | 177 | 74.6 |
| **C. + 7 unverifiable and 1 closed excluded** | **169** | **75.3** |
| D. As C but unverifiable zeroed instead (worst case) | 176 | 72.3 |

**Headline: mean 75.3 across 169 verified retailers, median 81.0.** Defensible band **72.3 – 75.3**,
i.e. the number is good to roughly **±1.5 points**.

Band mix under treatment C:

| Band | n | % |
|---|---:|---:|
| Strong | 88 | 52.1% |
| OK | 64 | 37.9% |
| Needs work | 10 | 5.9% |
| At risk | 1 | 0.6% |
| Invisible | 6 | 3.6% |

The 6 remaining `Invisible` rows — Elvet, `JL Flooring`, `Elite Installations`,
`Signature Floors Pembroke`, `Thompsons Floooring`, `Multisave Carpets` — are now **positively
verified** real absences from Google rather than assumed ones. That is the strongest part of the set.

### Four caveats that bound the confidence

1. **Two scores are from a different date.** 167 of the 169 come from the 2026-06-21 baseline; `Sams`
   (98) and `Beccles` (91) are 2026-07-30 values. Review counts grow, so those two are mildly
   inflated relative to the rest. Immaterial at 2/169, but say "as at" if either is quoted
   individually. Re-running all 169 today would remove the inconsistency.
2. **The 27 "same business" `review` rows are the softest part.** Each was confirmed from a single
   Places Details lookup by name/address judgement, not the deep candidate-list check the 9 suspects
   received. They are probably right; they have not been checked to the same standard.
3. **"177" is the honest count, not 180.** Three `place_id` duplicates; both rows stay in the
   database for traceability, but no external figure should say 180.
4. **This score is not the in-app score.** It is `publicAudit.scorePlace` — 3 public signals
   (rating, reviews, completeness) — and is not comparable to `lib/audit.scoreProfile`, the live
   14-signal OAuth audit, or to `refresh-scores.calculateChockaScore`. Never present this number
   alongside in-app scores as if they were the same metric. See `README.md`.

## Status — resolved

All the checks the rule required are done, and the decisions it was waiting on have been taken:

- ✅ 36 `review` rows re-verified, which arm matched now recorded
- ✅ 5 short-name `high` rows spot-checked — all clean
- ✅ 8 `NOT FOUND` rows re-matched — 2 false zeros corrected, 6 positively verified as real
- ✅ All 9 suspects hand-checked — 2 retained, 7 excluded as unverifiable
- ✅ `Carpet Cuts` decided: right business, stale address, retained with the address flagged
- ✅ De-duplication decided: 177 distinct businesses is the external count, both rows stay in the DB

**Quotable, with the four caveats above:** mean **75.3** across **169 verified** of **177 distinct**
Tarkett retailers, median 81.0, band **72.3 – 75.3**.

Still outstanding, neither blocking:

1. **Do not port the matcher as-is.** Four defects are recorded in `FOLLOWUPS.md` under
   *Deferred — the batch matcher*; the two that produce hard false zeros (apostrophe tokenisation,
   empty normalised candidate names) would keep producing them.
2. **Optionally re-run all 169 today** to remove the two-date inconsistency in caveat 1, and to
   check the 27 softer `review` rows to the same standard as the suspects.

## Related

- `FOLLOWUPS.md` — "the scored.csv baseline is not quotable yet"
- `README.md` — provenance of the artefacts in this directory
- `match-verification-2026-07-30.json` — raw per-row evidence
