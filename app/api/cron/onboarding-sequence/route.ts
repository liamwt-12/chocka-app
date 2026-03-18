import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse } from '@/lib/cron';
import { sendSMS, logSMS } from '@/lib/twilio';
import { sendEmail } from '@/lib/email';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    // Get users in onboarding (steps 0-7)
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('*, profiles(*)')
      .eq('subscription_status', 'active')
      .gte('onboarding_step', 0)
      .lte('onboarding_step', 7);

    let sent = 0;

    for (const user of users || []) {
      if (!user.phone_number || !user.sms_enabled) continue;
      const profile = user.profiles?.[0];

      const daysSinceSignup = Math.floor(
        (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check if we already sent today (deduplication)
      const today = new Date().toISOString().split('T')[0];
      const { data: sentToday } = await supabaseAdmin
        .from('sms_log')
        .select('id')
        .eq('user_id', user.id)
        .eq('message_type', `onboarding_day${daysSinceSignup}`)
        .gte('created_at', `${today}T00:00:00Z`)
        .limit(1);

      if (sentToday && sentToday.length > 0) continue;

      const firstName = (user.name || '').split(' ')[0] || 'there';
      let smsBody = '';

      switch (daysSinceSignup) {
        case 0:
          smsBody = `Welcome to Chocka, ${firstName}! We're managing your Google profile now. Your first post goes out this week. - Chocka`;

          // Also send welcome email
          if (user.email) {
            await sendEmail({
              to: user.email,
              subject: 'Welcome to Chocka!',
              html: `
                <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
                  <h2 style="color: #FF6B35;">Welcome to Chocka, ${firstName}!</h2>
                  <p style="color: #374151; line-height: 1.6;">We're now managing your Google Business Profile. Here's what happens next:</p>
                  <ul style="color: #374151; line-height: 2;">
                    <li>This week, we'll write and publish your first Google post</li>
                    <li>When reviews come in, we'll handle them</li>
                    <li>Every Monday at 7am, you'll get a stats text</li>
                  </ul>
                  <p style="color: #374151;">That's it. We do the work, you get the calls.</p>
                  <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">— The Chocka team</p>
                </div>
              `,
            });
          }
          break;

        case 1:
          if (!profile) continue;
          // Only send if they have a post
          const { data: posts } = await supabaseAdmin
            .from('scheduled_posts')
            .select('id')
            .eq('profile_id', profile.id)
            .eq('status', 'published')
            .limit(1);

          if (posts && posts.length > 0) {
            smsBody = `Your first Google post is live, ${firstName}! Your profile is already more active than most. - Chocka`;
          }
          break;

        case 3:
          smsBody = `Quick check-in, ${firstName}. Everything's running smoothly on your Google profile. Any questions? Just reply to this text. - Chocka`;
          break;

        case 7:
          smsBody = `One week with Chocka, ${firstName}! Your first stats summary is coming tomorrow morning. - Chocka`;
          break;

        default:
          continue;
      }

      if (!smsBody) continue;

      const sid = await sendSMS({ to: user.phone_number, body: smsBody });
      await logSMS(supabaseAdmin, user.id, user.phone_number, `onboarding_day${daysSinceSignup}`, smsBody, sid);

      // Update onboarding step
      await supabaseAdmin
        .from('users')
        .update({ onboarding_step: daysSinceSignup })
        .eq('id', user.id);

      sent++;
    }

    return NextResponse.json({ success: true, sent });
  } catch (err) {
    console.error('Onboarding cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
