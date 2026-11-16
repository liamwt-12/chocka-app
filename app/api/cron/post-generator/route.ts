import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles, generateCancelHash } from '@/lib/cron';
import { generatePost } from '@/lib/ai';
import { sendEmail, postPreviewEmail } from '@/lib/email';
import { getTenantForRow } from '@/lib/tenant';
import { nextMondaySlot } from '@/lib/post-schedule';
import { requiresPostApproval, AWAITING_APPROVAL, PUBLISHABLE } from '@/lib/safe-automation';
import { loadVoiceForUser } from '@/lib/voice';
import { reservePhotoForUser } from '@/lib/shop-photos';
import { startBudget, selectAll, rotateForRun, runIndex } from '@/lib/cron-budget';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'post-generator');
    const now = new Date();
    const month = now.toLocaleString('en-GB', { month: 'long' });
    const season = getSeason(now.getMonth());
    let generated = 0;

    // This job now runs several times on a Friday morning (see
    // netlify/functions/cron-post-generator.mts): each run writes as many posts
    // as fit in its time budget, and the next run carries on. What makes that
    // safe is knowing who already has this week's post, so that is read ONCE
    // here, for everyone, instead of once per shop.
    //
    // A post awaiting approval counts as "has one". It did not before, which
    // was harmless with one run a week and would have written a new shop a
    // fresh post on every run.
    const budget = startBudget();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const thisWeek = await selectAll<{ profile_id: string }>((from, to) => supabaseAdmin
      .from('scheduled_posts')
      .select('profile_id')
      .gte('scheduled_for', weekStart.toISOString())
      .in('status', [PUBLISHABLE, 'published', AWAITING_APPROVAL])
      .range(from, to));
    const hasPost = new Set(thisWeek.map((p) => p.profile_id));
    // Rotated each run, so one shop whose post keeps failing its checks is not at the front every time.
    const todo = rotateForRun<any>(users.filter((u: any) => u.auto_post_enabled && u.profiles?.[0] && !hasPost.has(u.profiles[0].id)), runIndex(5), 3);
    let remaining = todo.length;

    for (const user of todo) {
      if (budget.exhausted()) break;
      const profile = user.profiles?.[0];
      if (!profile) continue;

      // Per user, not per run — one pass serves every tenant.
      const t = getTenantForRow(user);

      try {
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
          // The shop's own voice, if it has given one (lib/voice.ts). Null means
          // the default wording. It changes how a post sounds and nothing else:
          // the validator and the first-three-posts approval below are untouched.
          voice: await loadVoiceForUser(supabaseAdmin, user.id),
        });

        // Monday morning, but on this profile's own minute inside the window
        // rather than 10:00 sharp for everyone — see lib/post-schedule.ts. At
        // six profiles the difference is invisible; at 180 it is the difference
        // between twelve small publisher runs and one that breaches the API
        // quota and then times out half-finished.
        const monday = nextMondaySlot(profile.id, now);

        // A new shop approves its first three posts (lib/safe-automation.ts).
        // Until then the post waits as awaiting_approval, which the publisher
        // never picks up, and no "publishes unless you cancel" email is sent.
        const { count: publishedCount } = await supabaseAdmin
          .from('scheduled_posts')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .eq('status', 'published');
        const needsApproval = requiresPostApproval(publishedCount || 0);

        // An approved photo of the shop's work, if SHOP_PHOTOS is on and there
        // is one to use (lib/shop-photos.ts). Null otherwise, and then the row
        // is inserted exactly as before, without the column.
        const photoId = await reservePhotoForUser(supabaseAdmin, user.id, now);

        const { data: post } = await supabaseAdmin
          .from('scheduled_posts')
          .insert({
            profile_id: profile.id,
            content: postContent,
            scheduled_for: monday.toISOString(),
            status: needsApproval ? AWAITING_APPROVAL : PUBLISHABLE,
            ...(photoId ? { photo_id: photoId } : {}),
          })
          .select()
          .single();

        if (post && user.email && !needsApproval) {
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
        remaining--;
      } catch (err) {
        console.error(`Post generation failed for user ${user.id}:`, err);
      }
    }

    if (remaining > 0) console.log(`[cron:post-generator] wrote ${generated}, ${remaining} still to do: the next run carries on`);
    return NextResponse.json({ success: true, generated, remaining, partial: remaining > 0 });
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

