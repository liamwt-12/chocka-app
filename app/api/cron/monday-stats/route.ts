import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { refreshAccessToken, getPerformanceMetrics } from '@/lib/google';
import { sendSMS } from '@/lib/twilio';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin);
    let processed = 0;
    for (const user of users) {
      const profile = user.profiles?.[0];
      if (!profile) continue;
      try {
        const accessToken = await refreshAccessToken(user.google_refresh_token);
        const metrics = await getPerformanceMetrics(accessToken, profile.google_location_name);
        const ws = new Date(); ws.setDate(ws.getDate() - ws.getDay() + 1);
        await supabaseAdmin.from('weekly_stats').upsert({ profile_id: profile.id, week_start: ws.toISOString().split('T')[0], views: metrics?.views || 0, calls: metrics?.calls || 0, direction_requests: metrics?.directions || 0, website_clicks: metrics?.websiteClicks || 0 }, { onConflict: 'profile_id,week_start' });
        if (user.sms_enabled && user.phone_number) await sendSMS({ to: user.phone_number, body: `Monday stats: ${metrics?.views || 0} views, ${metrics?.calls || 0} calls.` });
        processed++;
      } catch (err) { console.error('Stats failed:', err); }
    }
    return NextResponse.json({ success: true, processed });
  } catch (err) {
    console.error('Monday stats cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
