/**
 * Import the Tarkett pre-launch scoring baseline into retailers + score_history.
 *
 * This is a ONE-OFF import of an UNRECOVERABLE artefact. `scored.csv` was
 * produced on 2026-06-21 by tarkett-scraper/score-retailers.ts against live
 * Google Places data. That exact state of the world cannot be reproduced — once
 * real scoring starts, this is the only record of where every retailer stood
 * before Stellar Local existed. Hence the care below about dates and idempotency.
 *
 * WHAT IT WRITES
 *   retailers      one row per CSV row, upserted on (source, source_ref)
 *   score_history  one 'batch' row per retailer, stamped with the CSV's real
 *                  generation date — NOT today's
 *
 * SAFETY
 *   - DRY RUN by default. It only writes with `--commit`.
 *   - Idempotent. Retailers upsert on (source, source_ref); history relies on the
 *     unique index on (retailer_id, score_source, scored_at), so a second run
 *     conflicts and does nothing rather than doubling every retailer's history.
 *   - Refuses to run if the target tenant has no row (see seed migration).
 *
 * WHY source_ref COMES FROM THE CHECKPOINT
 *   scored.csv has no id column, so on its own a row is only identifiable by
 *   name. `.score-checkpoint.json`, written beside it by the same run, is keyed
 *   by Tarkett's own store id and carries identical field values. Joining on
 *   (name, town) — verified collision-free and field-for-field identical across
 *   all 180 rows — recovers exact provenance. Without it, re-importing a
 *   corrected CSV later could not tell which row was which.
 *
 * A NOTE ON THE NUMBERS THIS PRODUCES
 *   Do not compute an aggregate from this data and quote it externally. 36 rows
 *   are 'review' confidence (one of two match tests passed, and which one is not
 *   recorded upstream), five three-letter names sit in the 'high' bucket, and
 *   three place_ids are each shared by two rows because Tarkett's list contains
 *   the same business twice. See FOLLOWUPS.md, "the scored.csv baseline is not
 *   quotable yet".
 *
 * USAGE (tsx does not read .env.local by itself):
 *   npx tsx --env-file=.env.local scripts/import-scored-csv.ts <path/to/scored.csv>
 *   npx tsx --env-file=.env.local scripts/import-scored-csv.ts <path> --commit
 *
 * ENV
 *   NEXT_PUBLIC_SUPABASE_URL    https://emilonrdyljbydtgrvof.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   service-role key (bypasses RLS)
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMIT = process.argv.includes('--commit');

const TENANT_SLUG = 'stellar';
const SOURCE = 'tarkett-scraper';

/**
 * The real generation time of scored.csv, from the scraper's summary.txt
 * ("Generated: 2026-06-21T12:04:47.808Z"), NOT the time of this import.
 *
 * This is the single most important constant in the file. Stamping the baseline
 * with today's date would place five weeks of unmeasured drift inside the first
 * history row, and no later correction could recover the true date.
 *
 * Override only if importing a different run: --scored-at=<ISO8601>
 */
const DEFAULT_SCORED_AT = '2026-06-21T12:04:47.808Z';

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** Minimal RFC-4180 parser: handles quoted fields and embedded commas. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/**
 * CSV writes 'NOT FOUND'; the column's CHECK constraint expects 'not_found'.
 * Anything unrecognised throws rather than silently becoming null — an unknown
 * confidence value is exactly the ambiguity this column exists to remove.
 */
function normaliseConfidence(v: string): 'high' | 'review' | 'not_found' {
  const k = v.trim().toLowerCase().replace(/\s+/g, '_');
  if (k === 'high' || k === 'review' || k === 'not_found') return k;
  throw new Error(`Unrecognised match_confidence: ${JSON.stringify(v)}`);
}

function num(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    fail('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (try --env-file=.env.local).');
  }

  const csvPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!csvPath) fail('Usage: import-scored-csv.ts <path/to/scored.csv> [--commit] [--scored-at=ISO]');
  if (!existsSync(csvPath)) fail(`No such file: ${csvPath}`);

  const scoredAtArg = process.argv.find((a) => a.startsWith('--scored-at='));
  const scoredAt = scoredAtArg ? scoredAtArg.split('=')[1] : DEFAULT_SCORED_AT;
  if (Number.isNaN(Date.parse(scoredAt))) fail(`--scored-at is not a valid date: ${scoredAt}`);

  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  if (!rows.length) fail('CSV parsed to zero rows.');

  // Recover Tarkett's own store ids from the checkpoint written beside the CSV.
  const checkpointPath = join(dirname(csvPath), '.score-checkpoint.json');
  const refByKey = new Map<string, string>();
  if (existsSync(checkpointPath)) {
    const chk = JSON.parse(readFileSync(checkpointPath, 'utf8')) as Record<string, any>;
    for (const [id, v] of Object.entries(chk)) {
      refByKey.set(`${String(v.name).trim()}|${String(v.town).trim()}`, id);
    }
  } else {
    console.warn(`! No .score-checkpoint.json beside the CSV — source_ref will be null,`);
    console.warn(`  which makes the import non-idempotent. Expected at: ${checkpointPath}`);
  }

  const tenants = await rest(`tenants?slug=eq.${TENANT_SLUG}&select=id,slug`);
  if (!tenants.length) fail(`No tenants row for slug "${TENANT_SLUG}" — run the seed migration first.`);
  const tenantId = tenants[0].id;

  const retailers = rows.map((r) => {
    const ref = refByKey.get(`${r.name}|${r.town}`) ?? null;
    return {
      tenant_id: tenantId,
      source: SOURCE,
      source_ref: ref,
      place_id: r.place_id || null,
      name: r.name,
      town: r.town || null,
      nation: r.nation || null,
      rating: num(r.rating),
      review_count: num(r.reviews),
      photo_count: num(r.photos),
      has_website: r.has_website ? r.has_website.toLowerCase() === 'yes' : null,
      match_confidence: normaliseConfidence(r.match_confidence),
      headline_gap: r.headline_gap || null,
      score: num(r.score),
      band: r.band || null,
      score_source: 'batch',
      scored_at: scoredAt,
    };
  });

  const missingRef = retailers.filter((r) => !r.source_ref).length;
  const byConfidence = retailers.reduce<Record<string, number>>((a, r) => {
    a[r.match_confidence] = (a[r.match_confidence] || 0) + 1;
    return a;
  }, {});

  console.log(`\nSource      : ${csvPath}`);
  console.log(`Tenant      : ${TENANT_SLUG} (${tenantId})`);
  console.log(`Rows        : ${retailers.length}`);
  console.log(`Confidence  : ${JSON.stringify(byConfidence)}`);
  console.log(`Without ref : ${missingRef}`);
  console.log(`\nscored_at   : ${scoredAt}`);
  console.log(`              ^ the CSV's real generation date, NOT today (${new Date().toISOString().slice(0, 10)}).`);
  console.log(`                Every score_history row is stamped with this.\n`);

  if (!COMMIT) {
    console.log('DRY RUN — nothing written. Re-run with --commit to apply.\n');
    for (const r of retailers.slice(0, 3)) {
      console.log(`  e.g. ${r.name} (${r.town}) score=${r.score} ${r.band} conf=${r.match_confidence} ref=${r.source_ref}`);
    }
    console.log();
    return;
  }

  // Upsert retailers. merge-duplicates on the (source, source_ref) unique index
  // makes a re-run update in place instead of inserting a second copy.
  const saved = await rest(`retailers?on_conflict=source,source_ref&select=id,source_ref,name,score,band`, {
    method: 'POST',
    body: JSON.stringify(retailers),
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  console.log(`✓ retailers upserted: ${saved.length}`);

  // One baseline history row each. ignore-duplicates + the unique index on
  // (retailer_id, score_source, scored_at) makes this safe to re-run.
  const history = saved
    .filter((s: any) => s.score !== null)
    .map((s: any) => ({
      retailer_id: s.id,
      score: s.score,
      band: s.band,
      score_source: 'batch',
      scored_at: scoredAt,
    }));

  const inserted = await rest(`score_history?on_conflict=retailer_id,score_source,scored_at&select=id`, {
    method: 'POST',
    body: JSON.stringify(history),
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
  });
  console.log(`✓ score_history rows written: ${inserted.length} (of ${history.length} offered)`);
  console.log(`  ${history.length - inserted.length} already existed — re-run was a no-op for those.\n`);
}

main().catch((e) => fail(e.message));
