import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse } from '@/lib/cron';
import { sendSMS, logSMS } from '@/lib/twilio';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  try {
    const { data: users } = await supabaseAdmin.from('users').select('*').eq('subscription_status', 'active');
    let sent = 0;
    for (const user of users || []) {
      if (!user.sms_enabled || !user.phone_number) continue;
      const days = Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000);
      const mt = `onboarding_day_${days}`;
      const { data: done } = await supabaseAdmin.from('sms_log').select('id').eq('user_id', user.id).eq('message_type', mt).single();
      if (done) continue;
      let msg = '';
      if (days === 0) msg = 'Welcome to Chocka! Your first post goes out this week.';
      else if (days === 1) msg = 'Your first Chocka post is being prepared.';
      else if (days === 3) msg = 'Quick check-in from Chocka. Everything running smoothly.';
      else if (days === 7) msg = 'One week in! Monday stats report arrives next Monday.';
      else continue;
      const sid = await sendSMS({ to: user.phone_number, body: msg });
      await logSMS(supabaseAdmin, user.id, user.phone_number, mt, msg, sid);
      sent++;
    }
    return NextResponse.json({ success: true, sent });
  } catch (err) {
    console.error('Onboarding cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
