import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, generatePostActionHash } from '@/lib/cron';
import { sendEmail, postApprovalEmail } from '@/lib/email';
import { getTenantForRow } from '@/lib/tenant';
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
      .select('id, content, scheduled_for, status, preview_sent_at, profile_id, profiles!inner(id, business_name, users:user_id(id, email, tenants ( slug )))')
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
      if (!user?.email) continue;
      const t = getTenantForRow(user);
      const { count: published } = await supabaseAdmin
        .from('scheduled_posts').select('id', { count: 'exact', head: true })
        .eq('profile_id', profile.id).eq('status', 'published');
      const link = (action: 'approve' | 'skip') => `${t.appUrl}/api/posts/approve?id=${post.id}&action=${action}&hash=${generatePostActionHash(post.id, action)}`;
      const ok = await sendEmail({
        to: user.email,
        subject: `Approve your Google post: ${profile.business_name}`,
        html: postApprovalEmail({
          businessName: profile.business_name, postContent: post.content, scheduledFor: post.scheduled_for,
          approveUrl: link('approve'), skipUrl: link('skip'), approvalsLeft: approvalsRemaining(published || 0), tenant: t,
        }),
        tenant: t,
      });
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
