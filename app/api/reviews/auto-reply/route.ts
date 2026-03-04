import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, replyToReview } from '@/lib/google';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const reviewId = searchParams.get('review_id');

  if (!action || !reviewId || !['approve', 'reject'].includes(action)) {
    return new NextResponse(resultPage('Invalid link', 'This link is missing some information.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Get review + reply + profile + user
  const { data: review } = await supabaseAdmin
    .from('reviews')
    .select(`
      *,
      review_replies (*),
      profiles!inner (
        *,
        users:user_id (*)
      )
    `)
    .eq('id', reviewId)
    .single();

  if (!review) {
    return new NextResponse(resultPage('Review not found', 'This review may have been deleted.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const pendingReply = review.review_replies?.find((r: any) => r.status === 'pending');
  if (!pendingReply) {
    return new NextResponse(resultPage('Already handled', 'This review reply has already been processed.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (action === 'reject') {
    await supabaseAdmin
      .from('review_replies')
      .update({ status: 'rejected' })
      .eq('id', pendingReply.id);

    return new NextResponse(resultPage('Got it', 'We won\'t post that reply. Handle it however you see fit.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Approve — publish the reply to Google
  try {
    const user = review.profiles.users;
    const profile = review.profiles;
    const accessToken = await refreshAccessToken(user.google_refresh_token);

    const reviewName = `${profile.google_location_name}/reviews/${review.google_review_id}`;
    await replyToReview(accessToken, reviewName, pendingReply.reply_content);

    await supabaseAdmin
      .from('review_replies')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', pendingReply.id);

    await supabaseAdmin
      .from('profiles')
      .update({ total_auto_replies: (profile.total_auto_replies || 0) + 1 })
      .eq('id', profile.id);

    return new NextResponse(resultPage('Reply published', 'Your reply is now live on Google. Nice one.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err) {
    console.error('Failed to publish review reply:', err);
    return new NextResponse(resultPage('Something went wrong', 'We couldn\'t publish the reply. Try again or handle it on Google directly.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

function resultPage(title: string, message: string): string {
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
