import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, replyToReview } from '@/lib/google';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const replyId = searchParams.get('id');
  const action = searchParams.get('action');
  const html = (body: string) => new NextResponse('<html><body style="font-family:system-ui;text-align:center;padding:60px">' + body + '</body></html>', { headers: { 'Content-Type': 'text/html' } });
  if (!replyId || !action) return html('<h1>Invalid link</h1>');
  const { data: reply } = await supabaseAdmin.from('review_replies').select('*, reviews(*, profiles(*, users:user_id(*)))').eq('id', replyId).single();
  if (!reply) return html('<h1>Reply not found</h1>');
  if (action === 'approve') {
    try {
      const user = (reply as any).reviews.profiles.users;
      const accessToken = await refreshAccessToken(user.google_refresh_token);
      await replyToReview(accessToken, (reply as any).reviews.google_review_id, reply.reply_content);
      await supabaseAdmin.from('review_replies').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', replyId);
      return html('<h1>Reply published</h1>');
    } catch (err) {
      console.error('Approve error:', err);
      return html('<h1>Something went wrong</h1>');
    }
  } else if (action === 'reject') {
    await supabaseAdmin.from('review_replies').update({ status: 'rejected' }).eq('id', replyId);
    return html('<h1>Reply rejected</h1>');
  }
  return html('<h1>Invalid action</h1>');
}
