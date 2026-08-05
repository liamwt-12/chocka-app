import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse } from '@/lib/cron';
import { partitionForRetention, RETENTION_GRACE_DAYS } from '@/lib/retailer-retention';

/**
 * Delete retailer records that have been delisted for longer than the grace
 * period. Runs on a schedule; annual is enough, but it is safe to run daily.
 *
 * This is the only cron in the repo that DELETES anything, so it is built
 * differently from the others:
 *
 *   - `?dry=1` reports exactly what it would delete and deletes nothing. Use it
 *     before trusting a run.
 *   - The safety rule (never delete a claimed record) is enforced TWICE: in the
 *     pure predicate, and again as `.is('user_id', null)` on the delete itself.
 *     Belt and braces is proportionate when the failure mode is destroying a
 *     live user's baseline and score history.
 *   - It reports counts on every run, per the same reasoning as admitEntitled:
 *     a destructive job that says nothing is indistinguishable from one that
 *     never ran.
 *
 * The clock runs from `delisted_at`, never `last_seen_at`. If refreshes stop
 * happening, nothing gets delisted, so nothing ages towards deletion — a gap in
 * the schedule cannot quietly consume the dataset.
 *
 * `score_history` follows automatically: its FK to `retailers` is
 * `on delete cascade`.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry') === '1';

  try {
    // Only delisted rows are candidates at all — the partial index covers this,
    // and it keeps the job proportional to the delisted set rather than to the
    // whole table.
    const { data: candidates, error } = await supabaseAdmin
      .from('retailers')
      .select('id, name, user_id, delisted_at')
      .not('delisted_at', 'is', null);

    if (error) throw error;

    const now = new Date();
    const { deletable, kept } = partitionForRetention(candidates || [], now);

    const summary = {
      candidates: (candidates || []).length,
      deletable: deletable.length,
      kept,
      graceDays: RETENTION_GRACE_DAYS,
      dryRun,
    };

    if (deletable.length === 0) {
      console.log(
        `[cron:retailer-retention] nothing to delete — ${summary.candidates} delisted candidate(s), ` +
          `all inside the ${RETENTION_GRACE_DAYS}d grace period or claimed`,
      );
      return NextResponse.json({ ok: true, deleted: 0, ...summary });
    }

    // Name every record before touching it. If this job ever deletes something
    // it should not have, this log is the only record of what was lost — the
    // rows themselves will be gone, and so will their score history.
    for (const r of deletable) {
      console.log(
        `[cron:retailer-retention] ${dryRun ? 'WOULD DELETE' : 'DELETING'} retailer ${r.id} ` +
          `"${r.name ?? '(no name)'}" — ${r.decision.reason}`,
      );
    }

    if (dryRun) {
      console.log(`[cron:retailer-retention] DRY RUN — nothing deleted (${deletable.length} would go)`);
      return NextResponse.json({ ok: true, deleted: 0, ...summary });
    }

    // The second guard. `.is('user_id', null)` makes it impossible for this
    // statement to remove a claimed record even if the predicate above were
    // wrong, and costs nothing.
    const { error: delError, count } = await supabaseAdmin
      .from('retailers')
      .delete({ count: 'exact' })
      .in('id', deletable.map((r) => r.id))
      .is('user_id', null);

    if (delError) throw delError;

    // A mismatch means the belt caught something the braces missed — worth
    // shouting about, because it means the predicate and the query disagree.
    if (count !== deletable.length) {
      console.error(
        `[cron:retailer-retention] expected to delete ${deletable.length} but deleted ${count} — ` +
          `the user_id guard rejected ${deletable.length - (count ?? 0)} row(s). Investigate: the ` +
          `predicate and the delete guard should never disagree.`,
      );
    }

    console.log(`[cron:retailer-retention] deleted ${count} retailer record(s), kept ${kept}`);
    return NextResponse.json({ ok: true, deleted: count ?? 0, ...summary });
  } catch (err: any) {
    console.error('[cron:retailer-retention] failed:', err?.message || err);
    return NextResponse.json({ error: 'Retention run failed' }, { status: 500 });
  }
}
