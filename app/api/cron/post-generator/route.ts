import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles, generateCancelHash } from '@/lib/cron';
import { generatePost } from '@/lib/ai';
import { sendEmail, postPreviewEmail } from '@/lib/email';
import { getTenantForRow } from '@/lib/tenant';
import { nextMondaySlot } from '@/lib/post-schedule';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'post-generator');
    const now = new Date();
    const month = now.toLocaleString('en-GB', { month: 'long' });
    const season = getSeason(now.getMonth());
    let generated = 0;

    for (const user of users) {
      if (!user.auto_post_enabled) continue;
      const profile = user.profiles?.[0];
      if (!profile) continue;

      // Per user, not per run — one pass serves every tenant.
      const t = getTenantForRow(user);

      try {
        // Check if a post already exists for this profile this week
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const { data: existingThisWeek } = await supabaseAdmin
          .from('scheduled_posts')
          .select('id')
          .eq('profile_id', profile.id)
          .gte('scheduled_for', weekStart.toISOString())
          .in('status', ['pending_approval', 'published'])
          .limit(1);
        if (existingThisWeek?.length) continue;

        // Get last 4 posts to avoid repeating themes
        const { data: recentPosts } = await supabaseAdmin
          .from('scheduled_posts')
          .select('content')
          .eq('profile_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(4);

        const postContent = await generatePost({
          businessName: profile.business_name,
          category: profile.category || 'tradesperson',
          city: profile.address?.split(',').pop()?.trim() || 'your area',
          month,
          season,
          recentPosts: (recentPosts || []).map((p: any) => p.content),
        });

        // Monday morning, but on this profile's own minute inside the window
        // rather than 10:00 sharp for everyone — see lib/post-schedule.ts. At
        // six profiles the difference is invisible; at 180 it is the difference
        // between twelve small publisher runs and one that breaches the API
        // quota and then times out half-finished.
        const monday = nextMondaySlot(profile.id, now);

        const { data: post } = await supabaseAdmin
          .from('scheduled_posts')
          .insert({
            profile_id: profile.id,
            content: postContent,
            scheduled_for: monday.toISOString(),
            status: 'pending_approval',
          })
          .select()
          .single();

        if (post && user.email) {
          const hash = generateCancelHash(post.id);
          const cancelUrl = `${t.appUrl}/api/posts/cancel?id=${post.id}&hash=${hash}`;

          await sendEmail({
            to: user.email,
            subject: `Your Google post for this week — ${profile.business_name}`,
            html: postPreviewEmail(profile.business_name, postContent, cancelUrl, t),
            tenant: t,
          });
        }

        generated++;
      } catch (err) {
        console.error(`Post generation failed for user ${user.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, generated });
  } catch (err) {
    console.error('Post generator cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}

function getSeason(month: number): string {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

