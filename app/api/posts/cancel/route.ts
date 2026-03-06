import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateCancelHash } from '@/lib/cron';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const postId = searchParams.get('id');
  const hash = searchParams.get('hash');
  const html = (body: string) => new NextResponse('<html><body style="font-family:system-ui;text-align:center;padding:60px">' + body + '</body></html>', { headers: { 'Content-Type': 'text/html' } });
  if (!postId || !hash) return html('<h1>Invalid link</h1>');
  const expectedHash = generateCancelHash(postId);
  if (hash !== expectedHash) return html('<h1>Invalid or expired link</h1>');
  const { data: post } = await supabaseAdmin.from('scheduled_posts').select('status').eq('id', postId).single();
  if (!post) return html('<h1>Post not found</h1>');
  if (post.status !== 'pending_approval') return html('<h1>Already processed</h1>');
  await supabaseAdmin.from('scheduled_posts').update({ status: 'cancelled' }).eq('id', postId);
  return html('<h1>Post cancelled</h1><p>We will not publish this post.</p>');
}
