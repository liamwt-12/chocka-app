import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse } from '@/lib/cron';
import { refreshAccessToken, createLocalPost } from '@/lib/google';
import { sendSMS } from '@/lib/twilio';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  try {
    const now = new Date().toISOString();
    const { data: posts } = await supabaseAdmin.from('scheduled_posts').select('*, profiles(*, users:user_id(*))').eq('status', 'pending_approval').lte('scheduled_for', now);
    let published = 0;
    for (const post of posts || []) {
      const profile = post.profiles;
      const user = profile?.users;
      if (!user || !profile) continue;
      try {
        const accessToken = await refreshAccessToken(user.google_refresh_token);
        await createLocalPost(accessToken, profile.google_location_name, post.content);
        await supabaseAdmin.from('scheduled_posts').update({ status: 'published', published_at: now }).eq('id', post.id);
        await supabaseAdmin.from('profiles').update({ total_auto_posts: (profile.total_auto_posts || 0) + 1, streak_weeks: (profile.streak_weeks || 0) + 1, last_auto_post_at: now }).eq('id', profile.id);
        if (user.sms_enabled && user.phone_number) await sendSMS({ to: user.phone_number, body: 'Your weekly Google post just went live!' });
        published++;
      } catch (err: any) {
        console.error('Publish failed:', err);
        if (err.message?.includes('401')) {
          await supabaseAdmin.from('users').update({ token_status: 'invalid', token_invalid_at: now }).eq('id', user.id);
        }
      }
    }
    return NextResponse.json({ success: true, published });
  } catch (err) {
    console.error('Post publisher cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
