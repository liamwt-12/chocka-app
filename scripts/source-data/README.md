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
| `retailers-locations.csv` | The scraper's source list, **contact details removed**. Postcodes and lat/lng for the match-verification task. See below. |

## This repository is public

`github.com/liamwt-12/chocka-app` is public. Committing a file here publishes it
to the open internet, permanently and forkably. Everything in this directory has been
checked against that standard, not against a private-repo standard. Apply the same test
before adding anything else.

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

## `retailers-locations.csv` — what was removed, and why

The scraper's source list, `retailers.csv`, holds postcodes, lat/lng and Tarkett store URLs —
**and 176 retailer email addresses plus 180 phone numbers**. Roughly 103 of the emails have
non-generic local parts (given names), so for sole traders and small partnerships they are personal
data under UK GDPR, not merely business contact data. Tarkett does publish the same details on each
store's public locator page, but republishing them here as a single bulk list is a different act
from 180 separate pages a human has to visit — and this repo is public.

**Decision, 2026-07-30:** commit a stripped derivative; keep the original out.

`retailers-locations.csv` is `retailers.csv` with:

- the `phone` and `email` columns dropped wholesale, and
- any remaining cell matching an email pattern blanked — which caught **ids `29463` (Bespoke
  Flooring) and `29690` (Lewis Carpets)**, both of which had an email misfiled into the `website`
  column while their `email` column was empty. A column-name-based drop alone would have leaked
  them, one being a named individual. Filter on the value shape, not the column heading.

All 180 rows, all 15 remaining columns byte-identical to the source, `id` still joining
`.score-checkpoint.json` 180/180. Regenerate with:

```
python3 -c "
import csv, re
SRC='~/Downloads/chocka-app/tarkett-scraper/retailers.csv'
DST='scripts/source-data/retailers-locations.csv'
EMAIL=re.compile(r'[^\s,@]+@[^\s,@]+\.[^\s,@]+')
rows=list(csv.DictReader(open(SRC, encoding='utf-8')))
cols=[c for c in rows[0] if c not in ('phone','email')]
w=csv.DictWriter(open(DST,'w',newline='',encoding='utf-8'), fieldnames=cols); w.writeheader()
for r in rows: w.writerow({c: ('' if EMAIL.search(r[c]) else r[c]) for c in cols})
"
```

The untouched original, contact details included, is in an encrypted backup outside the repo. It is
**not** needed for the match-verification task, which needs postcode and lat/lng only.

### It is not the source for Elvet's postcode

`retailers.csv` has 179 postcodes, not 180. The blank one is **`29891` Elvet Flooring Solutions,
8 Winchester Road, Durham** — the very row the verification task needs to fix. That postcode has to
come from somewhere else (Places lookup on `54.801440, -1.562990`, Royal Mail, or Tarkett's own
store page). Committing the contacts would not have helped.

## Related

- `FOLLOWUPS.md` — "the scored.csv baseline is not quotable yet", and the deferred verification task
- `supabase/migrations/20260729140000_create_retailers_and_score_history.sql` — where this data landed
