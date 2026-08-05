/**
 * Mark which retailers are still on Tarkett's store locator, and which are not.
 *
 * This is the REFRESH half of the retention policy. The DELETE half is
 * `app/api/cron/retailer-retention`, which acts on what this writes.
 *
 * ── Why this takes a file rather than scraping ──────────────────────────────
 * The scraper that produced the original 180 lives outside this repo
 * (`~/Downloads/chocka-app/tarkett-scraper/`). Putting a live fetch of a third
 * party's website inside a job that DELETES records would make the deletion
 * clock depend on their markup not changing — a site redesign would delist
 * everyone at once and start 180 deletion timers.
 *
 * So the seam is a file: re-run the scrape however you like, hand the resulting
 * list of source_refs to this script, and it updates the two columns. The
 * external dependency stays where it already is, and the destructive path stays
 * driven by data a human has looked at.
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *   present in the list  → last_seen_at = now, delisted_at = NULL
 *                          (clearing delisted_at is deliberate: a retailer who
 *                          reappears has their deletion clock cancelled, so one
 *                          bad scrape is fully recoverable by a good one)
 *   absent from the list → delisted_at = now, but ONLY if it is currently NULL
 *                          (never restarts a clock that is already running)
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   tsx scripts/refresh-retailer-listing.ts <refs-file> [--commit] [--force]
 *
 * <refs-file> is one source_ref per line, or a CSV with an `id` column — the
 * same ids the scraper emits. Without --commit it reports and writes nothing.
 */
import { readFileSync, existsSync } from 'node:fs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOURCE = 'tarkett-scraper';

/**
 * Refuse a refresh that would delist more than this share of the list.
 *
 * THE GUARD THAT MATTERS. A scrape that half-fails — a changed selector, a
 * rate limit, a redirect to a cookie wall — returns a short list, and a short
 * list read literally means "almost everyone has left Tarkett's network". That
 * would start the deletion clock on the entire baseline in one run, and the
 * damage would only become visible six months later when the retention job
 * fired.
 *
 * A real network does not lose a third of its stockists between refreshes. If
 * it genuinely has, --force says so out loud.
 */
const MAX_DELIST_SHARE = 0.33;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
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

function parseRefs(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // CSV with a header containing `id`, or a bare list — accept both so this
  // works against the scraper's own output without a conversion step.
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idCol = header.indexOf('id');
  if (idCol !== -1 && lines[0].includes(',')) {
    return lines.slice(1).map((l) => (l.split(',')[idCol] || '').trim()).filter(Boolean);
  }
  return lines.map((l) => l.split(',')[0].trim()).filter(Boolean);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    fail('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (try --env-file=.env.local).');
  }

  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const commit = args.includes('--commit');
  const force = args.includes('--force');
  if (!path) fail('Usage: refresh-retailer-listing.ts <refs-file> [--commit] [--force]');
  if (!existsSync(path)) fail(`No such file: ${path}`);

  const seen = new Set(parseRefs(readFileSync(path, 'utf8')));
  if (seen.size === 0) fail('The refs file yielded no ids. Refusing to treat that as "nobody is listed".');

  const rows: Array<{ id: string; source_ref: string | null; name: string; user_id: string | null; delisted_at: string | null }> =
    await rest(`retailers?source=eq.${SOURCE}&select=id,source_ref,name,user_id,delisted_at`);

  const present = rows.filter((r) => r.source_ref && seen.has(r.source_ref));
  const absent = rows.filter((r) => !r.source_ref || !seen.has(r.source_ref));
  const newlyDelisted = absent.filter((r) => !r.delisted_at);
  // Array.from, not spread: this repo targets es5, where spreading a Set needs
  // downlevelIteration. Same reason as the token arrays in the OAuth callback.
  const unknownRefs = Array.from(seen).filter((ref) => !rows.some((r) => r.source_ref === ref));

  console.log(`\nRefresh against ${path}`);
  console.log(`  ids in file ................ ${seen.size}`);
  console.log(`  retailers in db ............ ${rows.length}`);
  console.log(`  still listed ............... ${present.length}`);
  console.log(`  absent from the list ....... ${absent.length}  (${newlyDelisted.length} newly delisted)`);
  if (unknownRefs.length) {
    console.log(`  in file but NOT in db ...... ${unknownRefs.length}  (new stockists — import them separately)`);
  }

  const share = rows.length ? newlyDelisted.length / rows.length : 0;
  if (share > MAX_DELIST_SHARE && !force) {
    fail(
      `This refresh would newly delist ${newlyDelisted.length} of ${rows.length} retailers ` +
        `(${Math.round(share * 100)}%), above the ${Math.round(MAX_DELIST_SHARE * 100)}% ceiling.\n` +
        `  That is far more likely to be a broken scrape than a collapsed network, and it would\n` +
        `  start the deletion clock on all of them. Check the input, then re-run with --force if\n` +
        `  it really is correct.`,
    );
  }

  // Claimed records are reported but never delisted — the retention job would
  // refuse to delete them anyway, and leaving delisted_at null keeps the signal
  // honest rather than parking a clock that can never fire.
  const claimedAbsent = newlyDelisted.filter((r) => r.user_id);
  if (claimedAbsent.length) {
    console.log(`  of those, claimed by a user . ${claimedAbsent.length}  (left alone)`);
  }

  if (!commit) {
    console.log('\n(dry run — pass --commit to write)\n');
    return;
  }

  const now = new Date().toISOString();

  if (present.length) {
    await rest(`retailers?id=in.(${present.map((r) => r.id).join(',')})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_seen_at: now, delisted_at: null }),
    });
  }

  const toDelist = newlyDelisted.filter((r) => !r.user_id);
  if (toDelist.length) {
    await rest(`retailers?id=in.(${toDelist.map((r) => r.id).join(',')})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ delisted_at: now }),
    });
    for (const r of toDelist) console.log(`  delisted: ${r.source_ref} ${r.name}`);
  }

  console.log(`\n✓ ${present.length} refreshed, ${toDelist.length} newly delisted\n`);
}

main().catch((e) => fail(e.message));
