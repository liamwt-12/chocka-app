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
        const metrics = await getPerformanceMetrics(accessToken, profile.google_location_name);

        // Parse metrics
        const views = extractMetricValue(metrics, 'QUERIES_DIRECT') + extractMetricValue(metrics, 'QUERIES_INDIRECT');
        const calls = extractMetricValue(metrics, 'ACTIONS_PHONE');
        const directions = extractMetricValue(metrics, 'ACTIONS_DRIVING_DIRECTIONS');
        const websiteClicks = extractMetricValue(metrics, 'ACTIONS_WEBSITE');

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

        // Get last week's views for comparison
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const { data: lastWeek } = await supabaseAdmin
          .from('weekly_stats')
          .select('views')
          .eq('profile_id', profile.id)
          .eq('week_start', lastWeekStart.toISOString().split('T')[0])
          .single();

        const lastViews = lastWeek?.views || 0;
        const changePercent = lastViews > 0
          ? Math.round(((views - lastViews) / lastViews) * 100)
          : 0;
        const changeStr = changePercent >= 0 ? `+${changePercent}%` : `${changePercent}%`;

        const firstName = user.name.split(' ')[0] || 'there';
        const streakStr = profile.streak_weeks > 1
          ? ` 🔥 ${profile.streak_weeks} week streak!`
          : '';

        const smsBody = `Morning ${firstName}! Last week: ${views} views (${changeStr}), ${calls} calls.${streakStr} - Chocka`;
        const sid = await sendSMS({ to: user.phone_number, body: smsBody });
        await logSMS(supabaseAdmin, user.id, user.phone_number, 'monday_stats', smsBody, sid);

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

function extractMetricValue(metrics: any, metricName: string): number {
  try {
    const locationMetrics = metrics.locationMetrics?.[0]?.metricValues || [];
    const metric = locationMetrics.find((m: any) => m.metric === metricName);
    if (!metric?.dimensionalValues) return 0;
    return metric.dimensionalValues.reduce((sum: number, dv: any) => sum + (dv.value || 0), 0);
  } catch {
    return 0;
  }
}
