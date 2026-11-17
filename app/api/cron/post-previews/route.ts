import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, generatePostActionHash } from '@/lib/cron';
import { sendEmail } from '@/lib/email';
import { shopContactEmail, postWaitingNotice } from '@/lib/shop-notices';
import { getTenantForRow } from '@/lib/tenant';
import { isPaused } from '@/lib/automation-mode';
import { automationHeld } from '@/lib/shop-status';
import { earlyPreviewEmailsEnabled, postsDueForPreview, approvalsRemaining, AWAITING_APPROVAL } from '@/lib/safe-automation';

/**
 * Hourly: email a shop 24 hours before each post that is awaiting its approval.
 *
 * OFF BY DEFAULT. Unless EARLY_POST_PREVIEW_EMAILS=on, this only counts what it
 * would send and sends nothing. While it is off, posts awaiting approval wait
 * and are never published, which is the safe outcome.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  try {
    const now = new Date();
    const { data: posts, error } = await supabaseAdmin
      .from('scheduled_posts')
      .select('id, content, scheduled_for, status, preview_sent_at, profile_id, profiles!inner(id, business_name, users:user_id(id, email, managed_by_user_id, automation_paused_at, tenants ( slug ), retailers ( connection_status, listing_confirmed_at )))')
      .eq('status', AWAITING_APPROVAL)
      .is('preview_sent_at', null)
      .gt('scheduled_for', now.toISOString());
    if (error) throw error;
    const due = postsDueForPreview(posts || [], now);

    if (!earlyPreviewEmailsEnabled()) {
      console.log(`[cron:post-previews] ${due.length} preview(s) due, NOT sent: EARLY_POST_PREVIEW_EMAILS is off`);
      return NextResponse.json({ success: true, enabled: false, due: due.length, sent: 0 });
    }

    let sent = 0;
    for (const post of due as any[]) {
      const profile = post.profiles;
      const user = profile?.users;
      // Plain text, to the shop's own address only: never a rep's or an operator's (lib/shop-notices.ts).
      const to = shopContactEmail(user);
      if (!to) continue;
      // Not while the shop has paused, or its listing is held: nothing could go up anyway.
      if (isPaused(user) || automationHeld(user.retailers)) continue;
      const t = getTenantForRow(user);
      const { count: published } = await supabaseAdmin
        .from('scheduled_posts').select('id', { count: 'exact', head: true })
        .eq('profile_id', profile.id).eq('status', 'published');
      const link = (action: 'approve' | 'skip') => `${t.appUrl}/api/posts/approve?id=${post.id}&action=${action}&hash=${generatePostActionHash(post.id, action)}`;
      const n = postWaitingNotice({
        businessName: profile.business_name, postContent: post.content, scheduledFor: post.scheduled_for,
        approveUrl: link('approve'), skipUrl: link('skip'), approvalsLeft: approvalsRemaining(published || 0), tenant: t,
      });
      const ok = await sendEmail({ to, subject: n.subject, text: n.text, tenant: t });
      if (ok) {
        await supabaseAdmin.from('scheduled_posts').update({ preview_sent_at: now.toISOString() }).eq('id', post.id);
        sent++;
      }
    }
    return NextResponse.json({ success: true, enabled: true, due: due.length, sent });
  } catch (err) {
    console.error('Post previews cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
