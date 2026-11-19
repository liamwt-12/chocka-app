import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles, generateCancelHash } from '@/lib/cron';
import { generatePost } from '@/lib/ai';
import { sendEmail } from '@/lib/email';
import { shopContactEmail, postBookedNotice } from '@/lib/shop-notices';
import { getTenantForRow } from '@/lib/tenant';
import { nextMondaySlot } from '@/lib/post-schedule';
import { APPROVAL_REQUIRED_POSTS, AWAITING_APPROVAL, PUBLISHABLE } from '@/lib/safe-automation';
import { postNeedsApproval, isPaused, switchesInForce } from '@/lib/automation-mode';
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
    // WHO ALREADY HAS ONE: any post, in ANY state, scheduled on or after the
    // Monday this run is writing for. Two things about that, both from review:
    //
    //  - ANY state, cancelled included. A shop that cancels its post has been
    //    told "nothing will be published this week". With several runs a
    //    morning, counting only live posts meant the next run, five minutes
    //    later, wrote it a new one. A post awaiting approval counts too.
    //
    //  - The UPCOMING Monday, not "since last Sunday". The old test asked for a
    //    post scheduled since the Sunday before this Friday, and last week's
    //    post (scheduled for the Monday just gone) always matched. So every
    //    other Friday every shop was skipped: posts went out fortnightly, not
    //    weekly.
    const budget = startBudget();
    const slot = nextMondaySlot('', now);
    const targetWeekStart = new Date(Date.UTC(slot.getUTCFullYear(), slot.getUTCMonth(), slot.getUTCDate()));
    const thisWeek = await selectAll<{ profile_id: string }>((from, to) => supabaseAdmin
      .from('scheduled_posts')
      .select('profile_id')
      .gte('scheduled_for', targetWeekStart.toISOString())
      .order('id', { ascending: true })
      .range(from, to));
    const hasPost = new Set(thisWeek.map((p) => p.profile_id));
    // A shop with a post still waiting for its approval is not written another.
    // Until now a new post was added every Friday regardless, so a shop that
    // had not approved its first was left with a growing pile.
    const stillWaiting = await selectAll<{ profile_id: string }>((from, to) => supabaseAdmin
      .from('scheduled_posts')
      .select('profile_id')
      .eq('status', 'awaiting_approval')
      .order('id', { ascending: true })
      .range(from, to));
    for (const p of stillWaiting) hasPost.add(p.profile_id);
    // A shop that has pressed Pause is written nothing (lib/automation-mode.ts).
    // Rotated each run, so one shop whose post keeps failing its checks is not at the front every time.
    const todo = rotateForRun<any>(users.filter((u: any) => switchesInForce(u).posts && !isPaused(u) && u.profiles?.[0] && !hasPost.has(u.profiles[0].id)), runIndex(5), 3);
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
        // A shop that chose hands-off (lib/automation-mode.ts) has given its
        // permission in advance: its posts are booked straight away, and it is
        // sent each one first, with a link to stop it, like any booked post.
        const { count: publishedCount } = await supabaseAdmin
          .from('scheduled_posts')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .eq('status', 'published');
        const needsApproval = postNeedsApproval(user, publishedCount || 0, APPROVAL_REQUIRED_POSTS);

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

        // Hands-off (or a shop past its first three): the post is booked, and
        // the shop is sent it first with the one link to stop it. Plain text,
        // to the shop's own address only, never a rep's or an operator's
        // (lib/shop-notices.ts). With no such address the post is still booked
        // and can be stopped from the dashboard; the log says it was not sent.
        if (post && !needsApproval) {
          const to = shopContactEmail(user);
          if (!to) {
            console.log(`[cron:post-generator] post ${post.id} booked; preview NOT sent: NO ADDRESS OF THE SHOP'S OWN (user ${user.id})`);
          } else {
            const hash = generateCancelHash(post.id);
            const cancelUrl = `${t.appUrl}/api/posts/cancel?id=${post.id}&hash=${hash}`;
            const n = postBookedNotice({ businessName: profile.business_name, postContent, scheduledFor: monday.toISOString(), cancelUrl, tenant: t });
            await sendEmail({ to, subject: n.subject, text: n.text, tenant: t });
          }
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

