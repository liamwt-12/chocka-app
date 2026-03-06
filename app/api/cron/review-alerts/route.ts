import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { refreshAccessToken, getReviews, replyToReview, parseStarRating } from '@/lib/google';
import { generateReviewReply } from '@/lib/ai';
import { sendSMS } from '@/lib/twilio';
import { sendEmail, reviewAlertEmail } from '@/lib/email';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin);
    let processed = 0;
    for (const user of users) {
      if (!user.auto_reply_enabled) continue;
      const profile = user.profiles?.[0];
      if (!profile) continue;
      try {
        const accessToken = await refreshAccessToken(user.google_refresh_token);
        const reviewsData = await getReviews(accessToken, profile.google_location_name);
        for (const review of reviewsData.reviews || []) {
          const { data: existing } = await supabaseAdmin.from('reviews').select('id').eq('google_review_id', review.name).single();
          if (existing) continue;
          const rating = parseStarRating(review.starRating);
          const { data: nr } = await supabaseAdmin.from('reviews').insert({ profile_id: profile.id, google_review_id: review.name, reviewer_name: review.reviewer?.displayName || 'Someone', rating, comment: review.comment || '', review_date: review.createTime }).select().single();
          if (!nr) continue;
          const replyContent = await generateReviewReply({ businessName: profile.business_name, reviewerName: nr.reviewer_name, rating, comment: nr.comment });
          if (rating >= 4) {
            await replyToReview(accessToken, review.name, replyContent);
            await supabaseAdmin.from('review_replies').insert({ review_id: nr.id, reply_content: replyContent, status: 'published', published_at: new Date().toISOString() });
            await supabaseAdmin.from('profiles').update({ total_auto_replies: (profile.total_auto_replies || 0) + 1 }).eq('id', profile.id);
            if (user.sms_enabled && user.phone_number) await sendSMS({ to: user.phone_number, body: `New ${rating}-star review! We replied automatically.` });
          } else {
            const { data: pr } = await supabaseAdmin.from('review_replies').insert({ review_id: nr.id, reply_content: replyContent, status: 'pending' }).select().single();
            if (user.sms_enabled && user.phone_number) await sendSMS({ to: user.phone_number, body: `New ${rating}-star review needs your attention. Check email.` });
            if (user.email && pr) {
              const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
              await sendEmail({ to: user.email, subject: `${rating}-star review needs attention`, html: reviewAlertEmail(profile.business_name, nr.reviewer_name, rating, nr.comment, replyContent, `${appUrl}/api/reviews/auto-reply?id=${pr.id}&action=approve`, `${appUrl}/api/reviews/auto-reply?id=${pr.id}&action=reject`) });
            }
          }
          processed++;
        }
      } catch (err) { console.error('Review alerts failed:', err); }
    }
    return NextResponse.json({ success: true, processed });
  } catch (err) {
    console.error('Review alerts cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
