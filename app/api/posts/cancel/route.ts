import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateCancelHash } from '@/lib/cron';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const postId = searchParams.get('id');
  const hash = searchParams.get('hash');

  if (!postId || !hash) {
    return new NextResponse(cancelPage('Invalid link', 'This cancel link is missing some information.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Verify hash
  const expectedHash = generateCancelHash(postId);
  if (hash !== expectedHash) {
    return new NextResponse(cancelPage('Invalid link', 'This cancel link has expired or is invalid.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Check post exists and is cancellable
  const { data: post } = await supabaseAdmin
    .from('scheduled_posts')
    .select('*, profiles!inner(user_id, users:user_id(phone_number, sms_enabled))')
    .eq('id', postId)
    .single();

  if (!post) {
    return new NextResponse(cancelPage('Post not found', 'This post may have already been published or cancelled.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (post.status !== 'pending_approval') {
    return new NextResponse(cancelPage('Already handled', `This post has already been ${post.status}.`), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Cancel the post
  await supabaseAdmin
    .from('scheduled_posts')
    .update({ status: 'cancelled' })
    .eq('id', postId);

  // SMS confirmation
  const user = post.profiles?.users;
  if (user?.sms_enabled && user?.phone_number) {
    const { sendSMS, logSMS } = await import('@/lib/twilio');
    const smsBody = `Post cancelled — nothing will be published this week. We'll try again next Sunday. - Chocka`;
    const sid = await sendSMS({ to: user.phone_number, body: smsBody });
    await logSMS(supabaseAdmin, post.profiles.user_id, user.phone_number, 'post_cancelled', smsBody, sid);
  }

  return new NextResponse(cancelPage('Post cancelled', 'Nothing will be published this week. We\'ll write a new one next Sunday.'), {
    headers: { 'Content-Type': 'text/html' },
  });
}

function cancelPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Chocka</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { text-align: center; max-width: 360px; padding: 40px; }
    h1 { color: #FF6B35; font-size: 24px; font-weight: 800; margin-bottom: 8px; }
    p { color: #6b7280; font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
