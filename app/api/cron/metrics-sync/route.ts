import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { refreshAccessToken, fetchDailyMetrics } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess } from '@/lib/managed-access';
import { syncDailyMetrics, pickProfilesToSync } from '@/lib/metrics';

/**
 * Hourly: keep daily_metrics current, and pull the ~18-month history for any
 * listing that has not had it yet (normally already done at onboarding by
 * /api/audit; this is the fallback).
 *
 * Works inside a time budget, never-synced listings first, then the
 * longest-since-synced, so 180 shops rotate through over a few hourly runs
 * rather than one run timing out. A listing synced in the last 20 hours is
 * skipped. Reads from Google and writes to our database only.
 */
const TIME_BUDGET_MS = 18_000;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  const started = Date.now();
  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'metrics-sync');
    const queue = pickProfilesToSync(users, new Date());
    let synced = 0, failed = 0;
    for (const { user, profile } of queue) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const access = resolveAccess(user);
      if (!access.ok) continue;
      try {
        const token = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)));
        const r = await syncDailyMetrics(supabaseAdmin, profile, (from, to) => fetchDailyMetrics(token, profile.google_location_name, from, to));
        console.log(`[cron:metrics-sync] profile ${profile.id}: ${r.mode} ${r.from}..${r.to}, ${r.rows} rows`);
        synced++;
      } catch (e: any) {
        failed++;
        console.error(`[cron:metrics-sync] profile ${profile.id} failed: ${String(e?.message).slice(0, 300)}`);
      }
    }
    return NextResponse.json({ success: true, queued: queue.length, synced, failed });
  } catch (err) {
    console.error('Metrics sync cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
