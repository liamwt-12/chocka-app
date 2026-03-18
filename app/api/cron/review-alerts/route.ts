import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles, generateReviewHash } from '@/lib/cron';
import { refreshAccessToken, getReviews, replyToReview, parseStarRating } from '@/lib/google';
import { generateReviewReply } from '@/lib/ai';
import { sendSMS, logSMS } from '@/lib/twilio';
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
        const reviewsData = await getReviews(accessToken, profile.google_location_name, profile.google_account_id);

        for (const review of reviewsData.reviews || []) {
          const googleReviewId = review.reviewId || review.name;

          // Check if already processed
          const { data: existing } = await supabaseAdmin
            .from('reviews')
            .select('id')
            .eq('google_review_id', googleReviewId)
            .single();

          if (existing) continue;

          const rating = parseStarRating(review.starRating);
          const reviewerName = review.reviewer?.displayName || 'A customer';
          const comment = review.comment || '';

          // Store review
          const { data: newReview } = await supabaseAdmin
            .from('reviews')
            .insert({
              profile_id: profile.id,
              google_review_id: googleReviewId,
              reviewer_name: reviewerName,
              rating,
              comment,
              review_date: review.createTime || new Date().toISOString(),
            })
            .select()
            .single();

          if (!newReview) continue;

          // Generate reply
          const replyContent = await generateReviewReply({
            businessName: profile.business_name,
            category: profile.category || 'tradesperson',
            reviewerName,
            rating,
            comment,
          });

          if (rating >= 4) {
            // Auto-publish for 4-5 star reviews
            try {
              await replyToReview(accessToken, review.name + '/reply' ? review.name : `${profile.google_location_name}/reviews/${googleReviewId}`, replyContent);

              await supabaseAdmin.from('review_replies').insert({
                review_id: newReview.id,
                reply_content: replyContent,
                status: 'published',
                published_at: new Date().toISOString(),
              });

              // Increment counter
              await supabaseAdmin
                .from('profiles')
                .update({ total_auto_replies: (profile.total_auto_replies || 0) + 1 })
                .eq('id', profile.id);

              // SMS notification
              if (user.sms_enabled && user.phone_number) {
                const firstName = reviewerName.split(' ')[0];
                const smsBody = `New ${rating}-star review from ${firstName}! We've replied thanking them. Nice one ⭐ - Chocka`;
                const sid = await sendSMS({ to: user.phone_number, body: smsBody });
                await logSMS(supabaseAdmin, user.id, user.phone_number, 'review_positive', smsBody, sid);
              }
            } catch (replyErr) {
              console.error('Failed to publish review reply:', replyErr);
              // Store as pending if publish fails
              await supabaseAdmin.from('review_replies').insert({
                review_id: newReview.id,
                reply_content: replyContent,
                status: 'pending',
              });
            }
          } else {
            // Store as pending for 1-3 star reviews — needs manual approval
            await supabaseAdmin.from('review_replies').insert({
              review_id: newReview.id,
              reply_content: replyContent,
              status: 'pending',
            });

            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
            const hash = generateReviewHash(newReview.id);
            const approveUrl = `${appUrl}/api/reviews/auto-reply?action=approve&review_id=${newReview.id}&hash=${hash}`;
            const rejectUrl = `${appUrl}/api/reviews/auto-reply?action=reject&review_id=${newReview.id}&hash=${hash}`;

            // SMS alert
            if (user.sms_enabled && user.phone_number) {
              const firstName = reviewerName.split(' ')[0];
              const smsBody = `New ${rating}-star review from ${firstName}. We've drafted a reply — check your email to approve or handle it yourself. - Chocka`;
              const sid = await sendSMS({ to: user.phone_number, body: smsBody });
              await logSMS(supabaseAdmin, user.id, user.phone_number, 'review_negative', smsBody, sid);
            }

            // Email with approve/reject buttons
            if (user.email) {
              await sendEmail({
                to: user.email,
                subject: `${rating}-star review for ${profile.business_name} — needs your input`,
                html: reviewAlertEmail({
                  businessName: profile.business_name,
                  reviewerName,
                  rating,
                  comment,
                  suggestedReply: replyContent,
                  approveUrl,
                  rejectUrl,
                }),
              });
            }
          }

          processed++;
        }
      } catch (err) {
        console.error(`Review alerts failed for user ${user.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, processed });
  } catch (err) {
    console.error('Review alerts cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
