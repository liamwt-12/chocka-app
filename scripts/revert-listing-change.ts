/**
 * Undo changes the app made to a Google Business Profile, from change_log.
 *
 * The undoing itself lives in lib/revert.ts, which the Undo button in
 * /admin/pilot uses too. This script is for doing several at once, or when the
 * admin page is not to hand.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/revert-listing-change.ts --change-id <uuid>
 *   npx tsx --env-file=.env.local scripts/revert-listing-change.ts --location locations/123 --since 2026-11-01
 *   ...add --confirm to actually write to Google. Without it, nothing is written.
 *   ...add --even-if-changed-since to undo a field that has been changed again
 *      since (the later change is lost).
 *
 * With --location, changes are undone newest first, so the listing walks back
 * through its history in the right order.
 *
 * WARNING: with --confirm this writes to a real Google listing. Run it without
 * --confirm first and read the plan. The environment decides which database is
 * read, so check the "Database" line it prints.
 */
import { createClient } from '@supabase/supabase-js';
import { describeChange, undoChange } from '../lib/revert';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const changeId = arg('change-id');
  const location = arg('location');
  const since = arg('since');
  const confirm = process.argv.includes('--confirm');
  const allowLaterEdits = process.argv.includes('--even-if-changed-since');
  if (!changeId && !location) throw new Error('Give --change-id <uuid> or --location <locations/...> [--since <date>]');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  console.log(`Database: ${new URL(url).host}`);
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

  let q = db.from('change_log').select('*').is('reverted_at', null).neq('source', 'revert').order('created_at', { ascending: false });
  if (changeId) q = q.eq('id', changeId);
  if (location) q = q.eq('location_name', location);
  if (since) q = q.gte('created_at', new Date(since).toISOString());
  const { data: rows, error } = await q;
  if (error) throw error;
  if (!rows?.length) { console.log('Nothing to revert.'); return; }

  console.log(`\n${rows.length} change(s), newest first:`);
  for (const row of rows) {
    const v = describeChange(row as any);
    console.log(`  ${v.when}  ${v.what.padEnd(22)} ${v.canUndo ? `back to: ${v.before}` : `SKIP: ${v.whyNot}`}`);
  }
  if (!confirm) { console.log('\nDRY RUN: nothing written. Re-run with --confirm to write these to Google.'); return; }

  for (const row of rows) {
    const r = await undoChange(db as any, row.id, { confirm: true, allowLaterEdits });
    console.log(`  ${r.ok ? '✓' : '✗'} ${row.id}: ${r.message}${r.detail ? ` (${r.detail})` : ''}`);
  }
}

main().catch((e) => { console.error(`\n✗ ${e.message}\n`); process.exit(1); });
