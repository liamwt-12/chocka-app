import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { refreshAccessToken, getPerformanceMetrics } from '@/lib/google';
import { sendSMS, logSMS } from '@/lib/twilio';
import { startBudget, selectAll, rotateForRun, runIndex } from '@/lib/cron-budget';
import { getTenantForRow } from '@/lib/tenant';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess } from '@/lib/managed-access';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'monday-stats');
    let sent = 0;

    const weekStart = getWeekStart();

    // This job now runs several times on a Monday morning (see
    // netlify/functions/cron-monday-stats.mts). Each run does as many shops as
    // fit in its time budget. A shop is done once its row for this week exists,
    // and that row is written just before its text is sent, so who is done is
    // read once here and nobody is texted twice.
    const budget = startBudget();
    const doneRows = await selectAll<{ profile_id: string }>((from, to) => supabaseAdmin
      .from('weekly_stats').select('profile_id').eq('week_start', weekStart).order('profile_id', { ascending: true }).range(from, to));
    const done = new Set(doneRows.map((r) => r.profile_id));
    // Rotated each run, so one shop that keeps failing is not at the front every time.
    const todo = rotateForRun<any>(users.filter((u: any) => u.profiles?.[0] && u.sms_enabled && u.phone_number && !done.has(u.profiles[0].id)), runIndex(5), 7);
    let remaining = todo.length;

    for (const user of todo) {
      if (budget.exhausted()) break;
      const profile = user.profiles?.[0];
      if (!profile || !user.sms_enabled || !user.phone_number) continue;

      // Per user, not per run: one cron pass serves every tenant, so hoisting
      // this out of the loop is what made all outbound mail Chocka-branded.
      const t = getTenantForRow(user);

      try {
        // Self token, or a manager's for a Route 1 retailer who never signed
        // in themselves. resolveAccess also decides WHICH id the AAD is built
        // from — the row the ciphertext lives on — which is not always this user.
        const access = resolveAccess(user);
        if (!access.ok) {
          console.warn(`[cron:monday-stats] skipping user ${user.id} — ${access.reason}`);
          continue;
        }
        const accessToken = await refreshAccessToken(
          decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)),
        );
        // getPerformanceMetrics now returns {views, calls, directions, websiteClicks} directly
        const metrics = await getPerformanceMetrics(accessToken, profile.google_location_name);
        // Google could not be read. Do not write this week's row and do not
        // text "0 views": leave the shop for the next run.
        if (!metrics) { console.warn(`[cron:monday-stats] no figures from Google for profile ${profile.id}; will try again on the next run`); continue; }

        const views = metrics?.views || 0;
        const calls = metrics?.calls || 0;
        const directions = metrics?.directions || 0;
        const websiteClicks = metrics?.websiteClicks || 0;

        // Upsert weekly stats
        // This row is also the record that the shop has had this week's text.
        // If it cannot be written, the text is NOT sent: otherwise every run
        // this morning, five minutes apart, would text the shop again.
        const { error: markError } = await supabaseAdmin
          .from('weekly_stats')
          .upsert({
            profile_id: profile.id,
            week_start: weekStart,
            views,
            calls,
            direction_requests: directions,
            website_clicks: websiteClicks,
          }, { onConflict: 'profile_id,week_start' });
        if (markError) { console.error(`[cron:monday-stats] could not record this week for profile ${profile.id}, so no text was sent: ${markError.message}`); continue; }

        // Get last week's stats for comparison
        // Each weekly_stats row holds a rolling 28-day total, so last week's row
        // overlaps this one by 21 days and the comparison barely moved. Compare
        // with the row from four weeks ago instead: the previous 28 days, with no
        // overlap. (Monthly figures no longer come from this table at all; see
        // lib/metrics.ts.)
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 28);
        const { data: lastWeek } = await supabaseAdmin
          .from('weekly_stats')
          .select('views, calls')
          .eq('profile_id', profile.id)
          .eq('week_start', lastWeekStart.toISOString().split('T')[0])
          .single();

        const lastViews = lastWeek?.views || 0;
        const lastCalls = lastWeek?.calls || 0;
        const viewChange = lastViews > 0 ? Math.round(((views - lastViews) / lastViews) * 100) : 0;
        const callChange = calls - lastCalls;

        const viewStr = viewChange >= 0 ? `↑${viewChange}%` : `↓${Math.abs(viewChange)}%`;
        const callStr = callChange >= 0 ? `+${callChange}` : `${callChange}`;

        const firstName = (user.name || '').split(' ')[0] || 'there';
        const streakStr = profile.streak_weeks > 1 ? ` 🔥 ${profile.streak_weeks} week streak!` : '';

        const smsBody = `Morning ${firstName}! Last 28 days: ${views} views (${viewStr} on the 28 days before), ${calls} calls (${callStr}), ${directions} directions.${streakStr} - ${t.brandName}`;
        const sid = await sendSMS({ to: user.phone_number, body: smsBody });
        await logSMS(supabaseAdmin, user.id, user.phone_number, 'monday_stats', smsBody, sid);

        // Increment streak
        await supabaseAdmin.from('profiles').update({ streak_weeks: (profile.streak_weeks || 0) + 1 }).eq('id', profile.id);

        sent++;
        remaining--;
      } catch (err) {
        console.error(`Monday stats failed for user ${user.id}:`, err);
      }
    }

    if (remaining > 0) console.log(`[cron:monday-stats] sent ${sent}, ${remaining} still to do: the next run carries on`);
    return NextResponse.json({ success: true, sent, remaining, partial: remaining > 0 });
  } catch (err) {
    console.error('Monday stats cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}
