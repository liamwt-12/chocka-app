import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { sendEmail, monthlyReportEmail } from '@/lib/email';
import { sendSMS, logSMS } from '@/lib/twilio';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin);
    let sent = 0;
    const lm = new Date(); lm.setMonth(lm.getMonth() - 1);
    const ms = new Date(lm.getFullYear(), lm.getMonth(), 1).toISOString();
    const me = new Date(lm.getFullYear(), lm.getMonth() + 1, 0).toISOString();
    for (const user of users) {
      const profile = user.profiles?.[0];
      if (!profile || !user.email) continue;
      try {
        const { count: pc } = await supabaseAdmin.from('scheduled_posts').select('*', { count: 'exact', head: true }).eq('profile_id', profile.id).eq('status', 'published').gte('published_at', ms).lte('published_at', me);
        const { count: rc } = await supabaseAdmin.from('reviews').select('*', { count: 'exact', head: true }).eq('profile_id', profile.id).gte('review_date', ms).lte('review_date', me);
        const { data: stats } = await supabaseAdmin.from('weekly_stats').select('views, calls, direction_requests, website_clicks').eq('profile_id', profile.id).gte('week_start', ms.split('T')[0]).lte('week_start', me.split('T')[0]);
        const t = (stats || []).reduce((a: any, s: any) => ({ views: a.views + (s.views||0), calls: a.calls + (s.calls||0), directions: a.directions + (s.direction_requests||0), clicks: a.clicks + (s.website_clicks||0) }), { views:0, calls:0, directions:0, clicks:0 });
        await sendEmail({ to: user.email, subject: `Monthly Chocka report for ${profile.business_name}`, html: monthlyReportEmail(profile.business_name, pc||0, rc||0, t) });
        if (profile.streak_weeks >= 4) {
          const { data: already } = await supabaseAdmin.from('sms_log').select('id').eq('user_id', user.id).eq('message_type', 'referral_nudge').single();
          if (!already && user.sms_enabled && user.phone_number) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
            const sid = await sendSMS({ to: user.phone_number, body: `Know another tradesperson? Share: ${appUrl}/ref/${user.referral_code}` });
            await logSMS(supabaseAdmin, user.id, user.phone_number, 'referral_nudge', 'Referral nudge', sid);
          }
        }
        sent++;
      } catch (err) { console.error('Monthly report failed:', err); }
    }
    return NextResponse.json({ success: true, sent });
  } catch (err) {
    console.error('Monthly report cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
