import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, replyToReview } from '@/lib/google';
import { generateReviewHash } from '@/lib/cron';
import { getTenant } from '@/lib/tenant';
import { decryptSecret, userTokenAad } from '@/lib/secrets';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const reviewId = searchParams.get('review_id');
  const hash = searchParams.get('hash');

  if (!action || !reviewId || !['approve', 'reject'].includes(action)) {
    return new NextResponse(resultPage('Invalid link', 'This link is missing some information.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Verify HMAC hash
  const expectedHash = generateReviewHash(reviewId);
  if (!hash || hash !== expectedHash) {
    return new NextResponse(resultPage('Invalid link', 'This link has expired or is invalid.'), {
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
  const user = review.profiles?.users;
  const profile = review.profiles;

  // The join can come back without a user — an offboarded account, or a profile
  // whose owner was deleted. Checked explicitly because the old code read these
  // fields inside the catch-all try, where a TypeError became "Something went
  // wrong"; without the try there is nothing left to turn it into a page at all.
  if (!user || !user.google_refresh_token) {
    console.error(
      `[auto-reply] no usable credential behind review ${reviewId} (reply ${pendingReply.id}): ` +
        `user=${user ? user.id : 'absent'} token=${user?.google_refresh_token ? 'present' : 'absent'}`,
    );
    return new NextResponse(
      resultPage(
        'This account isn\'t connected',
        'We no longer hold a Google connection for this business, so we can\'t post the reply. ' +
          'Reconnect from your dashboard, or reply on Google directly.',
      ),
      { headers: { 'Content-Type': 'text/html' } },
    );
  }

  // Refreshing the stored credential is its own failure, and a different one
  // from Google refusing the reply. A dead grant is not retryable — clicking
  // "Approve" again will fail identically forever — so it must not be dressed up
  // as "try again". Same treatment as /api/audit, which records the dead token so
  // the dashboard can prompt a reconnect.
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(
      decryptSecret(user.google_refresh_token, userTokenAad(user.id)),
    );
  } catch (err: any) {
    console.error(
      `[auto-reply] token refresh failed for user ${user.id}, reply ${pendingReply.id}:`,
      String(err?.message).slice(0, 200),
    );
    const { error: tokErr } = await supabaseAdmin
      .from('users')
      .update({ token_status: 'invalid', token_invalid_at: new Date().toISOString() })
      .eq('id', user.id);
    if (tokErr) console.error('[auto-reply] failed to record token_status=invalid:', tokErr);

    return new NextResponse(
      resultPage(
        'Reconnect your Google account',
        'We\'ve lost our connection to your Google Business Profile, so we couldn\'t post the reply. ' +
          'Sign in again from your dashboard and we\'ll pick this up. Your reply is saved.',
      ),
      { headers: { 'Content-Type': 'text/html' } },
    );
  }

  const reviewName = `${profile.google_location_name}/reviews/${review.google_review_id}`;
  try {
    await replyToReview(accessToken, reviewName, pendingReply.reply_content);
  } catch (err: any) {
    const status = err?.status;
    const googleStatus = err?.googleStatus;
    console.error(
      `[auto-reply] Google refused the reply for review ${reviewId} (reply ${pendingReply.id}, ` +
        `user ${user.id}): status=${status} googleStatus=${googleStatus} ${String(err?.message).slice(0, 200)}`,
    );

    // Three failures that need three different things from the retailer. The old
    // single "Something went wrong" told them to "try again or handle it on
    // Google directly" in all three — advice that is wrong for two of them, and
    // actively wasteful for the review that no longer exists.
    if (status === 403 || googleStatus === 'PERMISSION_DENIED') {
      return new NextResponse(
        resultPage(
          'No permission to reply',
          'Google won\'t let this account reply to reviews on that listing. If your access changed recently, ' +
            'ask the listing owner to restore it — then approve this again. We\'ve kept the reply.',
        ),
        { headers: { 'Content-Type': 'text/html' } },
      );
    }

    if (status === 404 || googleStatus === 'NOT_FOUND') {
      // Nothing to retry and nothing to do on Google either — the thing being
      // replied to is gone. Marked rejected so it stops being offered.
      await supabaseAdmin.from('review_replies').update({ status: 'rejected' }).eq('id', pendingReply.id);
      return new NextResponse(
        resultPage(
          'That review is gone',
          'The reviewer deleted it, or Google removed it, so there\'s nothing left to reply to. ' +
            'Nothing for you to do — we\'ve cleared it.',
        ),
        { headers: { 'Content-Type': 'text/html' } },
      );
    }

    // Everything else — 429, 5xx, a network failure, an unexpected 400 — is
    // treated as transient and genuinely retryable, which is the one case the
    // original copy was right about.
    return new NextResponse(
      resultPage(
        'Google didn\'t take the reply',
        'This is usually temporary. Try the approve link again in a few minutes — the reply is still saved. ' +
          'If it keeps failing you can post it on Google directly.',
      ),
      { headers: { 'Content-Type': 'text/html' } },
    );
  }

  // Published. From here the reply IS LIVE on Google, so nothing below may tell
  // the retailer it failed — but a bookkeeping failure must not pass silently
  // either. supabase-js returns errors rather than throwing, so these two writes
  // were previously unchecked: a failed status update leaves the reply 'pending',
  // which means it can be offered for approval and published a SECOND time.
  const { error: replyErr } = await supabaseAdmin
    .from('review_replies')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', pendingReply.id);
  if (replyErr) {
    console.error(
      `[auto-reply] PUBLISHED TO GOOGLE BUT NOT RECORDED — reply ${pendingReply.id} is live on review ` +
        `${reviewId} and still marked pending, so it can be approved and posted again. Fix by hand: ${replyErr.message}`,
    );
  }

  const { error: countErr } = await supabaseAdmin
    .from('profiles')
    .update({ total_auto_replies: (profile.total_auto_replies || 0) + 1 })
    .eq('id', profile.id);
  if (countErr) {
    // Cosmetic by comparison — a stat is undercounted, nothing is duplicated.
    console.error(`[auto-reply] could not increment total_auto_replies for profile ${profile.id}:`, countErr.message);
  }

  return new NextResponse(resultPage('Reply published', 'Your reply is now live on Google. Nice one.'), {
    headers: { 'Content-Type': 'text/html' },
  });
}

function resultPage(title: string, message: string): string {
  const t = getTenant();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${t.brandName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { text-align: center; max-width: 360px; padding: 40px; }
    h1 { color: ${t.palette.routeAccent}; font-size: 24px; font-weight: 800; margin-bottom: 8px; }
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
