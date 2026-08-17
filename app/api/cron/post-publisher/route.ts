import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse } from '@/lib/cron';
import { refreshAccessToken, createLocalPost } from '@/lib/google';
import { sendSMS, logSMS } from '@/lib/twilio';
import { getTenantForRow } from '@/lib/tenant';
import { decryptSecret, userTokenAad } from '@/lib/secrets';

/**
 * Most posts this route will publish in a single invocation.
 *
 * 40 posts ≈ 80 Google requests, which sits inside both the 300/min project
 * quota and a serverless function's timeout with room to spare, while still
 * being several times any batch the jittered schedule should actually produce.
 */
const MAX_POSTS_PER_RUN = 40;

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
          users:user_id ( *, tenants ( slug ) )
        )
      `)
      .eq('status', 'pending_approval')
      .lte('scheduled_for', new Date().toISOString())
      // A ceiling on how much work one invocation can take on.
      //
      // The loop below is sequential and each iteration costs two Google
      // round-trips, so an unbounded run is bounded by the function timeout
      // instead — which fails in the worst way available: part of the batch
      // published, the rest still `pending_approval`, and no error belonging to
      // any particular post to explain why.
      //
      // Nothing should ever reach this cap in normal operation. The jittered
      // schedule (lib/post-schedule.ts) spreads 180 retailers across three
      // hours and this route runs every 15 minutes, so a typical run sees
      // single figures. It is here for the abnormal case — a backlog after an
      // outage, or a schedule change that bunches posts — where the right
      // behaviour is to publish what fits and pick the rest up on the next run
      // fifteen minutes later, not to die halfway.
      .order('scheduled_for', { ascending: true })
      .limit(MAX_POSTS_PER_RUN);

    let published = 0;

    for (const post of pendingPosts || []) {
      const profile = post.profiles;
      const user = profile?.users;
      if (!user || !profile) continue;

      // Per post, not per run — one pass serves every tenant.
      const t = getTenantForRow(user);

      try {
        // Refresh Google access token
        const accessToken = await refreshAccessToken(
          decryptSecret(user.google_refresh_token, userTokenAad(user.id)),
        );

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
          })
          .eq('id', profile.id);

        // SMS notification
        if (user.sms_enabled && user.phone_number) {
          const excerpt = post.content.substring(0, 60) + (post.content.length > 60 ? '...' : '');
          const smsBody = `Posted for you: "${excerpt}" Your Google profile stays active 👍 - ${t.brandName}`;
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
            const smsBody = `Your Google connection has expired. Please reconnect at ${t.appHost}/settings so we can keep posting for you. - ${t.brandName}`;
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
