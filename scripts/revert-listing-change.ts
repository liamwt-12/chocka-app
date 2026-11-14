/**
 * Undo changes the app made to a Google Business Profile, from change_log.
 *
 * This is the mechanism behind "every change we make is logged and reversed on
 * request". It reads the logged before-value and writes it back.
 *
 *   update_location → the masked fields are restored to their before-values
 *                     (a field that was empty before is cleared again)
 *   create_post     → the post is deleted
 *   reply_review    → the previous reply is restored, or the reply deleted if
 *                     there was none. If the previous reply was not known, the
 *                     change is skipped and reported for a manual check.
 *
 * A customer's review itself is never touched. Nobody can remove a review.
 *
 * Each revert is logged as its own change_log row (source 'revert', with its own
 * before-value, so a revert can itself be reverted) and the original row is
 * stamped reverted_at / reverted_by_change_id.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/revert-listing-change.ts --change-id <uuid>
 *   npx tsx --env-file=.env.local scripts/revert-listing-change.ts --location locations/123 --since 2026-11-01
 *   ...add --confirm to actually write to Google. Without it, nothing is written.
 *
 * With --location, changes are undone newest first, so the listing walks back
 * through its history in the right order.
 *
 * WARNING: with --confirm this writes to a real Google listing. Run it without
 * --confirm first and read the plan. The environment decides which database is
 * read, so check the "Database" line it prints.
 */
import { createClient } from '@supabase/supabase-js';
import { refreshAccessToken, deleteLocalPost, deleteReviewReply } from '../lib/google';
import { decryptSecret, userTokenAad } from '../lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '../lib/managed-access';
import { planRevert, loggedUpdateLocation, loggedReplyToReview, type ChangeRow, type RevertStep } from '../lib/change-log';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function describe(step: RevertStep): string {
  switch (step.kind) {
    case 'restore_fields': return `restore ${step.updateMask} on ${step.locationName} to ${JSON.stringify(step.body).slice(0, 300)}`;
    case 'delete_post': return `delete post ${step.postName}`;
    case 'restore_reply': return `restore previous reply on ${step.reviewName}: "${step.comment.slice(0, 120)}"`;
    case 'delete_reply': return `delete our reply on ${step.reviewName} (there was none before)`;
    case 'skip': return `SKIP: ${step.reason}`;
  }
}

async function main() {
  const changeId = arg('change-id');
  const location = arg('location');
  const since = arg('since');
  const confirm = process.argv.includes('--confirm');
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

  const plan = (rows as ChangeRow[]).map((r) => ({ row: r as ChangeRow & { profile_id: string | null; created_at: string }, step: planRevert(r) }));
  console.log(`\n${plan.length} change(s), newest first:`);
  for (const { row, step } of plan) console.log(`  ${row.created_at}  ${row.action.padEnd(15)} ${describe(step)}`);

  if (!confirm) { console.log('\nDRY RUN: nothing written. Re-run with --confirm to write these to Google.'); return; }

  for (const { row, step } of plan) {
    if (step.kind === 'skip') continue;
    if (!row.profile_id) { console.log(`  ${row.id}: no profile recorded, skipped`); continue; }

    const { data: profile } = await db.from('profiles').select('id, user_id').eq('id', row.profile_id).single();
    const { data: user } = await db.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', profile?.user_id).single();
    const access = resolveAccess(user as any);
    if (!access.ok) { console.log(`  ${row.id}: no Google access (${access.reason}), skipped`); continue; }
    const token = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)));
    const ctx = { db, source: 'revert' as const, userId: user!.id, profileId: row.profile_id };

    try {
      if (step.kind === 'restore_fields') await loggedUpdateLocation(ctx, token, step.locationName, step.updateMask, step.body);
      else if (step.kind === 'restore_reply') await loggedReplyToReview(ctx, token, step.reviewName, step.comment);
      else if (step.kind === 'delete_post') await deleteLocalPost(token, step.postName);
      else if (step.kind === 'delete_reply') await deleteReviewReply(token, step.reviewName);

      // Deletions are recorded here; restores were recorded by the logged* call.
      let revertId: string | null = null;
      if (step.kind === 'delete_post' || step.kind === 'delete_reply') {
        const { data } = await db.from('change_log').insert({
          user_id: user!.id, profile_id: row.profile_id, location_name: row.location_name, source: 'revert',
          action: row.action, target: step.kind === 'delete_post' ? step.postName : step.reviewName,
          before_value: row.after_value, after_value: null, status: 'applied',
        }).select('id').single();
        revertId = data?.id ?? null;
      } else {
        const { data } = await db.from('change_log').select('id').eq('source', 'revert').eq('location_name', row.location_name).order('created_at', { ascending: false }).limit(1).single();
        revertId = data?.id ?? null;
      }
      await db.from('change_log').update({ reverted_at: new Date().toISOString(), reverted_by_change_id: revertId }).eq('id', row.id);
      console.log(`  ✓ ${row.id}: ${describe(step)}`);
    } catch (e: any) {
      console.log(`  ✗ ${row.id}: ${String(e?.message).slice(0, 300)}`);
    }
  }
}

main().catch((e) => { console.error(`\n✗ ${e.message}\n`); process.exit(1); });
