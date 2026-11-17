import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { refreshAccessToken, fetchDailyMetrics, getManageableListings, isDeadGrant, getReviews, parseStarRating } from '@/lib/google';
import { snapshotFrom, snapshotColumns } from '@/lib/review-snapshot';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess } from '@/lib/managed-access';
import { syncDailyMetrics, pickProfilesToSync, markSyncAttemptFailed } from '@/lib/metrics';
import { recheckConnection } from '@/lib/connection-check';
import { recordLiveToday } from '@/lib/billing';

// Hourly. For each shop that is due (about once a day):
//   1. fetch Google's daily figures (lib/metrics.ts)
//   2. note the listing's review totals: rating, count, how many answered
//      (lib/review-snapshot.ts)
//   3. look again at the connection: right listing, verified, still accessible
//      (lib/connection-check.ts)
// and, first, once a day: mark which shops are live for the monthly count.
// and if Google says our permission is gone for good, record that, so the shop
// and whoever is helping are told within a day rather than never.
//
// Stops well inside the time a function is allowed and carries on next hour.
const TIME_BUDGET_MS = 18_000;
/** Pages of reviews read for the daily note of review totals (50 a page). */
const REVIEW_NOTE_MAX_PAGES = 6;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  const started = Date.now();
  try {
    // Mark today's live shops for the monthly count (lib/billing.ts). A few
    // requests however many shops there are; only the first run of the day
    // writes anything; it never fails this job.
    const liveCount = await recordLiveToday(supabaseAdmin);

    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'metrics-sync', { includeHeld: true });
    const queue = pickProfilesToSync(users, new Date());

    // The shop record for each account in this run, for the connection check.
    const userIds = queue.map((q: any) => q.user.id);
    const { data: retailers } = userIds.length
      ? await supabaseAdmin.from('retailers').select('id, user_id, place_id, connection_status').in('user_id', userIds)
      : { data: [] as any[] };
    const retailerFor = new Map<string, any>((retailers || []).map((r: any) => [r.user_id, r]));

    let synced = 0, failed = 0, rechecked = 0, lost = 0, reviewNotes = 0;
    for (const { user, profile } of queue) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const access = resolveAccess(user);
      if (!access.ok) continue;

      let token: string;
      try {
        token = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)));
      } catch (e: any) {
        failed++;
        if (isDeadGrant(e)) {
          // Against the row the credential lives on (the operator, for a managed shop).
          lost++;
          const { error } = await supabaseAdmin.from('users').update({ token_status: 'invalid', token_invalid_at: new Date().toISOString() }).eq('id', access.aadUserId);
          if (error) console.error(`[cron:metrics-sync] could not record lost access for ${access.aadUserId}: ${error.message}`);
          console.error(`[cron:metrics-sync] Google access is gone for account ${access.aadUserId}${access.via === 'manager' ? ' (an operator account: every shop it manages is affected)' : ''}`);
        } else {
          console.error(`[cron:metrics-sync] profile ${profile.id}: Google was busy at sign-in; will try again: ${String(e?.message).slice(0, 200)}`);
        }
        await markSyncAttemptFailed(supabaseAdmin, profile.id);
        continue;
      }

      try {
        const r = await syncDailyMetrics(supabaseAdmin, profile, (from, to) => fetchDailyMetrics(token, profile.google_location_name, from, to));
        console.log(`[cron:metrics-sync] profile ${profile.id}: ${r.mode} ${r.from}..${r.to}, ${r.rows} rows`);
        synced++;
      } catch (e: any) {
        failed++;
        console.error(`[cron:metrics-sync] profile ${profile.id} failed: ${String(e?.message).slice(0, 300)}`);
        // So it takes its turn next time instead of going first for ever.
        await markSyncAttemptFailed(supabaseAdmin, profile.id);
      }

      // A note of the listing's review totals (lib/review-snapshot.ts): rating,
      // count, and how many have a reply. Totals only, no review text. A
      // failure here is logged and nothing else: the figures above are already
      // stored, and yesterday's note stays.
      // Only with time in hand, and never more than a few pages: a listing with thousands of
      // reviews must not make this run overstay. (Its rating and count are Google's own either way;
      // the share answered is then of the newest reviews.)
      if (Date.now() - started <= TIME_BUDGET_MS) try {
        const snapshot = snapshotFrom(await getReviews(token, profile.google_location_name, profile.google_account_id, REVIEW_NOTE_MAX_PAGES), parseStarRating);
        const { error } = await supabaseAdmin.from('profiles').update(snapshotColumns(snapshot, new Date())).eq('id', profile.id);
        if (error) console.error(`[cron:metrics-sync] profile ${profile.id}: review totals not stored: ${error.message}`);
        else reviewNotes++;
      } catch (e: any) {
        console.error(`[cron:metrics-sync] profile ${profile.id}: review totals not read: ${String(e?.message).slice(0, 200)}`);
      }

      // The daily connection check. Only for a shop we invited (it has a record),
      // and only for a sign-in the shop gave itself: an operator account's list
      // of listings says nothing about one shop's.
      const retailer = retailerFor.get(user.id);
      if (retailer && access.via === 'self') {
        const result = await recheckConnection(supabaseAdmin, retailer, profile.google_location_name, () => getManageableListings(token));
        if (result) rechecked++;
      }
    }
    return NextResponse.json({ success: true, queued: queue.length, synced, failed, rechecked, lostAccess: lost, reviewNotes, liveCount });
  } catch (err) {
    console.error('Metrics sync cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
