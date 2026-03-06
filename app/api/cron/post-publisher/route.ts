import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse } from '@/lib/cron';
import { refreshAccessToken, createLocalPost } from '@/lib/google';
import { sendSMS, logSMS } from '@/lib/twilio';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    // Get all pending posts that are due
    const { data: pendingPosts } = await supabaseAdmin
      .from('scheduled_posts')
      .select(`
        *,
        profiles!inner (
          *,
          users:user_id (*)
        )
      `)
      .eq('status', 'pending_approval')
      .lte('scheduled_for', new Date().toISOString());

    let published = 0;

    for (const post of pendingPosts || []) {
      const profile = post.profiles;
      const user = profile?.users;
      if (!user || !profile) continue;

      try {
        // Refresh Google access token
        const accessToken = await refreshAccessToken(user.google_refresh_token);

        // Publish to GBP
        const result = await createLocalPost(accessToken, profile.google_location_name, post.content, profile.google_account_id);

        // Update post status
        await supabaseAdmin
          .from('scheduled_posts')
          .update({
            status: 'published',
            google_post_id: result.name || null,
            published_at: new Date().toISOString(),
          })
          .eq('id', post.id);

        // Increment counters
        await supabaseAdmin
          .from('profiles')
          .update({
            total_auto_posts: (profile.total_auto_posts || 0) + 1,
            last_auto_post_at: new Date().toISOString(),
            streak_weeks: (profile.streak_weeks || 0) + 1,
          })
          .eq('id', profile.id);

        // SMS notification
        if (user.sms_enabled && user.phone_number) {
          const excerpt = post.content.substring(0, 60) + (post.content.length > 60 ? '...' : '');
          const smsBody = `Posted for you: "${excerpt}" Your Google profile stays active 👍 - Chocka`;
          const sid = await sendSMS({ to: user.phone_number, body: smsBody });
          await logSMS(supabaseAdmin, user.id, user.phone_number, 'post_published', smsBody, sid);
        }

        published++;
      } catch (err: any) {
        console.error(`Post publish failed for post ${post.id}:`, err);

        // Check if it's a token error
        if (err.message?.includes('Token refresh failed') || err.message?.includes('401')) {
          await supabaseAdmin
            .from('users')
            .update({
              token_status: 'invalid',
              token_invalid_at: new Date().toISOString(),
            })
            .eq('id', user.id);

          if (user.sms_enabled && user.phone_number) {
            const smsBody = `Your Google connection has expired. Please reconnect at app.chocka.co.uk/settings so we can keep posting for you. - Chocka`;
            const sid = await sendSMS({ to: user.phone_number, body: smsBody });
            await logSMS(supabaseAdmin, user.id, user.phone_number, 'token_broken', smsBody, sid);
          }
        }
      }
    }

    return NextResponse.json({ success: true, published });
  } catch (err) {
    console.error('Post publisher cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
