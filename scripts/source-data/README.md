# Tarkett scoring baseline — source artefacts

These are committed **as a backup**, not as inputs the app reads at runtime. Until 2026-07-29 the
only copies lived in `~/Downloads/chocka-app/`, which is not backed up anywhere. Losing them would
have made the deferred match-verification task impossible and the imported baseline unexplainable.

Nothing in the running app imports from this directory.

## Contents

| File | What it is |
|---|---|
| `scored.csv` | 180 scored Tarkett retailers. **Generated 2026-06-21T12:04:47.808Z** — the baseline date. |
| `.score-checkpoint.json` | The same 180 rows keyed by Tarkett's own store id. |
| `publicAudit.ts` | The scorer that produced the CSV (`scorePlace`, `classifyMatch`). |

The dotfile name on the checkpoint is deliberate: `scripts/import-scored-csv.ts` looks for
`.score-checkpoint.json` **beside the CSV it is given**, so keeping both here means the import can
be re-run against this directory with no arguments beyond the path.

## Why the checkpoint matters

`scored.csv` has no id column. The checkpoint is the only way to recover `source_ref`, which is what
makes rows traceable to Tarkett's source records and what makes the import idempotent. The join is
on `(name, town)` — verified collision-free and field-for-field identical across all 180 rows before
the import relied on it.

## `publicAudit.ts` is the scorer to port, not `refresh-scores.ts`

Three different scoring scales exist and **none are comparable**:

| Scorer | Signals | Where |
|---|---|---|
| `publicAudit.scorePlace` | rating + reviews + completeness, from public Places data | **produced `scored.csv`** |
| `refresh-scores.calculateChockaScore` | 10, incl. response rate and last-post age | `chocka-landing`, *chocka index* DB |
| `lib/audit.scoreProfile` | 14, OAuth-only | this app, live audits |

If the batch scorer is ever productised as a re-running job, port **`publicAudit.ts`**. Porting
`refresh-scores.ts` would produce a third number matching neither the baseline nor the live audit.

This file reads `GOOGLE_PLACES_API_KEY` from the environment; it contains no credentials.

## Not copied here

`retailers.csv` (the source list, in the same Downloads folder) holds postcodes, lat/lng and Tarkett
store URLs — **and retailer email addresses and phone numbers**. It is the only source of the
postcodes the match-verification task needs, but committing 180 businesses' contact details to a git
repo is a privacy decision that has not been taken. It remains at risk in `~/Downloads/`. Decide
deliberately before that task starts.

## Related

- `FOLLOWUPS.md` — "the scored.csv baseline is not quotable yet", and the deferred verification task
- `supabase/migrations/20260729140000_create_retailers_and_score_history.sql` — where this data landed
