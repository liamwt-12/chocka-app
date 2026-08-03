/**
 * STEP 2 OF 2 — apply the verification verdicts to `retailers.match_confidence`.
 *
 * Step 1 (`scripts/source-data/verify-all.py`) produced the verdicts and wrote
 * nothing but a JSON file. This is the deliberate act that changes the database,
 * kept separate on purpose: a run that both judged and rewrote confidence in one
 * pass is exactly how the original baseline came to be hard to trust.
 *
 * WHAT IT WRITES
 *   retailers.match_confidence   and nothing else.
 *
 * WHAT IT DELIBERATELY DOES NOT WRITE
 *   score, band, place_id, scored_at. The verification says *whether we matched
 *   the right business*, not *what that business scores*. Re-scoring is a
 *   separate question with its own hard rule (FOLLOWUPS: the baseline is
 *   date-stamped 2026-06-21, and a mixed-date aggregate needs saying so). The
 *   verdicts carry `suggested_place_id` for rows where a better match exists —
 *   most importantly `Sams Carpet and Flooring Ltd`, carried at a hard 0 while
 *   its real profile has 4.9 stars and 275 reviews — but acting on those means
 *   re-scoring, and that is not this script.
 *
 * THE MAPPING, AND WHY IT IS BINARY
 *   CONFIRMED  -> 'high'     the recorded profile is the right business
 *   everything else -> 'review'
 *
 *   'review' is not a description of doubt here, it is a SWITCH. In
 *   `lib/retailer-score.ts`, `needsVerification` is `match_confidence === 'review'`
 *   — an equality test, not `!== 'high'` — and `send-invites.ts` withholds the
 *   score on exactly that flag. So 'review' is the only value that stops a number
 *   being quoted at a retailer.
 *
 *   That is why the 8 `not_found` rows move to 'review' too, and it fixes a live
 *   defect: they hold **score 0, band "Invisible"**, and because 'not_found' is
 *   not 'review' they resolve to needsVerification=false. `send-invites.ts` would
 *   therefore have emailed 8 real businesses to tell them they scored **0 out of
 *   100**, badged "Audited", with no qualification — while at least one of them
 *   genuinely scores 98. The guard that exists to prevent exactly this did not
 *   cover the case.
 *
 * SAFETY
 *   - DRY RUN by default. It only writes with `--commit`.
 *   - Scoped to `source = 'tarkett-scraper'`. A walkthrough fixture or any future
 *     import cannot be touched.
 *   - Idempotent. A second run is a no-op, and says so.
 *   - Refuses if the verdict file does not cover every row it is about to judge,
 *     so a partial `--limit` run can never be applied as if it were complete.
 *   - Prints every change before making it, grouped by direction.
 *
 * USAGE
 *   npx tsx --env-file=.env.local scripts/apply-verification.ts
 *   npx tsx --env-file=.env.local scripts/apply-verification.ts --commit
 */
import { readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const VERDICTS = 'scripts/source-data/verification-2026-08-03.json';
const SOURCE = 'tarkett-scraper';
const COMMIT = process.argv.includes('--commit');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Only 'high' means "quote this number at the retailer". */
function confidenceFor(verdict: string): 'high' | 'review' {
  return verdict === 'CONFIRMED' ? 'high' : 'review';
}

interface Verdict {
  id: string;
  name: string;
  verdict: string;
  orig_confidence: string | null;
  suggested_place_id?: string | null;
}

async function main() {
  console.log(`\n  Mode: ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no changes)'}`);

  const file = JSON.parse(readFileSync(VERDICTS, 'utf8'));
  const verdicts: Verdict[] = file.results;
  console.log(`  Verdicts: ${verdicts.length} rows from ${VERDICTS}`);
  console.log(`  Standard: ${file.standard}\n`);

  const { data: rows, error } = await db
    .from('retailers')
    .select('id, source_ref, name, match_confidence, score, band')
    .eq('source', SOURCE);
  if (error) throw new Error(`could not read retailers: ${error.message}`);
  console.log(`  Retailers in scope (source='${SOURCE}'): ${rows!.length}`);

  // A partial verdict file must never be applied as though it were complete.
  const byRef = new Map(verdicts.map((v) => [v.id, v]));
  const missing = rows!.filter((r) => !byRef.has(r.source_ref!));
  if (missing.length) {
    console.error(`\n  FAIL  ${missing.length} retailer(s) have no verdict — the file does not cover this table.`);
    console.error(`        First few: ${missing.slice(0, 5).map((m) => `${m.source_ref} ${m.name}`).join(', ')}`);
    console.error(`        Re-run verify-all.py WITHOUT --limit before applying.\n`);
    process.exit(1);
  }

  const changes: { row: any; v: Verdict; from: string | null; to: string }[] = [];
  const unchanged: typeof changes = [];
  for (const row of rows!) {
    const v = byRef.get(row.source_ref!)!;
    const to = confidenceFor(v.verdict);
    (row.match_confidence === to ? unchanged : changes).push({ row, v, from: row.match_confidence, to });
  }

  if (!changes.length) {
    console.log('\n  Nothing to do — every row already holds the verified value.\n');
    return;
  }

  const up = changes.filter((c) => c.to === 'high');
  const down = changes.filter((c) => c.to === 'review');

  console.log(`\n  ${'─'.repeat(70)}`);
  console.log(`  UNLOCKED — score becomes quotable (${up.length})`);
  console.log(`  ${'─'.repeat(70)}`);
  for (const c of up) {
    console.log(`    ${c.from ?? 'null'} -> high   ${c.row.name.slice(0, 44).padEnd(44)} score=${c.row.score}`);
  }

  console.log(`\n  ${'─'.repeat(70)}`);
  console.log(`  WITHHELD — score no longer quotable (${down.length})`);
  console.log(`  ${'─'.repeat(70)}`);
  for (const c of down) {
    const note = c.v.suggested_place_id ? '  [a better match exists — see the verdict file]' : '';
    console.log(`    ${(c.from ?? 'null').padEnd(9)} -> review  ${c.row.name.slice(0, 40).padEnd(40)} ${c.v.verdict}${note}`);
  }

  console.log(`\n  ${unchanged.length} row(s) already correct.`);
  console.log(`  Net: ${up.length} unlocked, ${down.length} withheld.`);

  if (!COMMIT) {
    console.log('\n  Re-run with --commit to apply. Nothing has been written.\n');
    return;
  }

  // Snapshot the prior values BEFORE touching anything. The verdict file says
  // what we decided; this says what we overwrote, which is the half you need if
  // the decision turns out to be wrong.
  const snapshotPath = `scripts/source-data/match-confidence-before-2026-08-03.json`;
  writeFileSync(snapshotPath, JSON.stringify({
    taken_before: 'scripts/apply-verification.ts --commit',
    source: SOURCE,
    rows: rows!.map((r) => ({ id: r.id, source_ref: r.source_ref, name: r.name, match_confidence: r.match_confidence })),
  }, null, 2));
  console.log(`\n  Wrote rollback snapshot: ${snapshotPath} (${rows!.length} rows)`);

  console.log('\n  Writing...');
  let ok = 0;
  for (const c of changes) {
    // Conditional on the value we read, so a concurrent change is not silently
    // overwritten by a decision made against stale data.
    const { data, error: e } = await db
      .from('retailers')
      .update({ match_confidence: c.to, updated_at: new Date().toISOString() })
      .eq('id', c.row.id)
      .eq('source', SOURCE)
      .select('id');
    if (e) { console.error(`    FAILED ${c.row.name}: ${e.message}`); continue; }
    if (!data || data.length !== 1) { console.error(`    SKIPPED ${c.row.name}: row changed under us`); continue; }
    ok++;
  }
  console.log(`  Wrote ${ok} of ${changes.length}.`);

  const { count: high } = await db.from('retailers').select('*', { count: 'exact', head: true })
    .eq('source', SOURCE).eq('match_confidence', 'high');
  const { count: review } = await db.from('retailers').select('*', { count: 'exact', head: true })
    .eq('source', SOURCE).eq('match_confidence', 'review');
  const { count: nf } = await db.from('retailers').select('*', { count: 'exact', head: true })
    .eq('source', SOURCE).eq('match_confidence', 'not_found');
  console.log(`\n  Now: high=${high}  review=${review}  not_found=${nf}`);
  console.log(`  ${high} retailers can be sent their score; ${(review ?? 0) + (nf ?? 0)} cannot.\n`);
}

main().catch((e) => { console.error(`\n  FAIL  ${e.message}\n`); process.exit(1); });
