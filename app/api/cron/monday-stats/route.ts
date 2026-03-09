import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { refreshAccessToken, getPerformanceMetrics } from '@/lib/google';
import { sendSMS, logSMS } from '@/lib/twilio';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin);
    let sent = 0;

    const weekStart = getWeekStart();

    for (const user of users) {
      const profile = user.profiles?.[0];
      if (!profile || !user.sms_enabled || !user.phone_number) continue;

      try {
        const accessToken = await refreshAccessToken(user.google_refresh_token);
        // getPerformanceMetrics now returns {views, calls, directions, websiteClicks} directly
        const metrics = await getPerformanceMetrics(accessToken, profile.google_location_name);

        const views = metrics?.views || 0;
        const calls = metrics?.calls || 0;
        const directions = metrics?.directions || 0;
        const websiteClicks = metrics?.websiteClicks || 0;

        // Upsert weekly stats
        await supabaseAdmin
          .from('weekly_stats')
          .upsert({
            profile_id: profile.id,
            week_start: weekStart,
            views,
            calls,
            direction_requests: directions,
            website_clicks: websiteClicks,
          }, { onConflict: 'profile_id,week_start' });

        // Get last week's stats for comparison
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
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

        const smsBody = `Morning ${firstName}! Last 28 days: ${views} views (${viewStr}), ${calls} calls (${callStr}), ${directions} directions.${streakStr} - Chocka`;
        const sid = await sendSMS({ to: user.phone_number, body: smsBody });
        await logSMS(supabaseAdmin, user.id, user.phone_number, 'monday_stats', smsBody, sid);

        // Increment streak
        await supabaseAdmin.from('profiles').update({ streak_weeks: (profile.streak_weeks || 0) + 1 }).eq('id', profile.id);

        sent++;
      } catch (err) {
        console.error(`Monday stats failed for user ${user.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, sent });
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
