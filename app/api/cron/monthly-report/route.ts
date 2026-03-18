import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { sendEmail, monthlyReportEmail } from '@/lib/email';
import { sendSMS, logSMS } from '@/lib/twilio';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin);
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const monthName = lastMonth.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    let sent = 0;

    for (const user of users) {
      const profile = user.profiles?.[0];
      if (!profile || !user.email) continue;

      try {
        // Count posts published last month
        const { count: postsPublished } = await supabaseAdmin
          .from('scheduled_posts')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .eq('status', 'published')
          .gte('published_at', lastMonth.toISOString())
          .lte('published_at', lastMonthEnd.toISOString());

        // Count reviews replied last month
        const { count: reviewsReplied } = await supabaseAdmin
          .from('review_replies')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .eq('status', 'published')
          .gte('published_at', lastMonth.toISOString())
          .lte('published_at', lastMonthEnd.toISOString());

        // Sum views and calls from weekly_stats last month
        const { data: weeklyStats } = await supabaseAdmin
          .from('weekly_stats')
          .select('views, calls')
          .eq('profile_id', profile.id)
          .gte('week_start', lastMonth.toISOString().split('T')[0])
          .lte('week_start', lastMonthEnd.toISOString().split('T')[0]);

        const totalViews = (weeklyStats || []).reduce((sum: number, w: any) => sum + (w.views || 0), 0);
        const totalCalls = (weeklyStats || []).reduce((sum: number, w: any) => sum + (w.calls || 0), 0);

        await sendEmail({
          to: user.email,
          subject: `Your ${monthName} report — ${profile.business_name}`,
          html: monthlyReportEmail({
            businessName: profile.business_name,
            month: monthName,
            postsPublished: postsPublished || 0,
            reviewsReplied: reviewsReplied || 0,
            totalViews,
            totalCalls,
          }),
        });

        // After 4+ weeks, send one-time referral nudge
        const weeksSinceSignup = Math.floor(
          (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24 * 7)
        );

        if (weeksSinceSignup >= 4 && user.sms_enabled && user.phone_number) {
          // Check if referral nudge already sent
          const { data: nudgeSent } = await supabaseAdmin
            .from('sms_log')
            .select('id')
            .eq('user_id', user.id)
            .eq('message_type', 'referral_nudge')
            .limit(1);

          if (!nudgeSent || nudgeSent.length === 0) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
            const smsBody = `Know a tradesperson who'd benefit from Chocka? Share your link and you both get a free month: ${appUrl}/ref/${user.referral_code} - Chocka`;
            const sid = await sendSMS({ to: user.phone_number, body: smsBody });
            await logSMS(supabaseAdmin, user.id, user.phone_number, 'referral_nudge', smsBody, sid);
          }
        }

        sent++;
      } catch (err) {
        console.error(`Monthly report failed for user ${user.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, sent });
  } catch (err) {
    console.error('Monthly report cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
