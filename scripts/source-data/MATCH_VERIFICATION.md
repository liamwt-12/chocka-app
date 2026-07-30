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

## What remains before the number is quotable

1. **Decide the treatment** of the 9 suspects, the 8 zeros and the 1 closed business — exclude,
   re-match, or hand-check. This is a judgement call, not a verification gap.
2. **Re-match Elvet** with `DH1 5QU` supplied, to find out whether its 0 is real. Same for `JL
   Flooring` and the other six `NOT FOUND`.
3. **Fix the two scorer defects** if the scorer is ever re-run — guard `nb` for empty, and reconsider
   stripping trade words on a list where they carry the signal.

## Related

- `FOLLOWUPS.md` — "the scored.csv baseline is not quotable yet"
- `README.md` — provenance of the artefacts in this directory
- `match-verification-2026-07-30.json` — raw per-row evidence
