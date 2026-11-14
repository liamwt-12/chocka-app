import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles, generateReviewHash } from '@/lib/cron';
import { refreshAccessToken, getReviews, replyToReview, parseStarRating } from '@/lib/google';
import { generateReviewReply } from '@/lib/ai';
import { sendSMS, logSMS } from '@/lib/twilio';
import { sendEmail, reviewAlertEmail } from '@/lib/email';
import { getTenantForRow } from '@/lib/tenant';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess } from '@/lib/managed-access';
import { splitNewReviews, reviewKey, BACKLOG_DAYS } from '@/lib/review-intake';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'review-alerts');
    let processed = 0;

    for (const user of users) {
      if (!user.auto_reply_enabled) continue;
      const profile = user.profiles?.[0];
      if (!profile) continue;

      // Per user, not per run. t.appUrl below builds the approve/reject links,
      // so this also keeps a Stellar retailer's action links on their own host.
      const t = getTenantForRow(user);

      try {
        // Self token, or a manager's for a Route 1 retailer who never signed
        // in themselves. resolveAccess also decides WHICH id the AAD is built
        // from — the row the ciphertext lives on — which is not always this user.
        const access = resolveAccess(user);
        if (!access.ok) {
          console.warn(`[cron:review-alerts] skipping user ${user.id} — ${access.reason}`);
          continue;
        }
        const accessToken = await refreshAccessToken(
          decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)),
        );
        // Every page of reviews, not just the first (see getReviews).
        const reviewsData = await getReviews(accessToken, profile.google_location_name, profile.google_account_id);

        // One query for everything already seen on this listing, instead of one
        // per review, now that a listing can return hundreds.
        const { data: seenRows } = await supabaseAdmin
          .from('reviews')
          .select('google_review_id')
          .eq('profile_id', profile.id);
        const seen = new Set<string>((seenRows || []).map((r: any) => r.google_review_id));

        // Recent reviews are handled (capped per run); old ones are recorded
        // without a reply or alert. See lib/review-intake.ts for why.
        const { toHandle, backlog, deferred } = splitNewReviews(reviewsData.reviews || [], seen);
        if (backlog.length) {
          const { error: backlogErr } = await supabaseAdmin.from('reviews').upsert(
            backlog.map((r: any) => ({
              profile_id: profile.id,
              google_review_id: reviewKey(r),
              reviewer_name: r.reviewer?.displayName || 'A customer',
              rating: parseStarRating(r.starRating),
              comment: r.comment || '',
              review_date: r.createTime || new Date().toISOString(),
            })),
            { onConflict: 'google_review_id', ignoreDuplicates: true },
          );
          if (backlogErr) console.error(`[cron:review-alerts] backlog record failed for profile ${profile.id}:`, backlogErr.message);
        }
        if (backlog.length || deferred.length) {
          console.log(`[cron:review-alerts] profile ${profile.id}: ${toHandle.length} handled, ${backlog.length} older than ${BACKLOG_DAYS} days recorded without reply, ${deferred.length} deferred to next run`);
        }

        for (const review of toHandle as any[]) {
          const googleReviewId = reviewKey(review);

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
              await replyToReview(accessToken, review.name, replyContent);

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
                const smsBody = `New ${rating}-star review from ${firstName}! We've replied thanking them. Nice one ⭐ - ${t.brandName}`;
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

            const appUrl = t.appUrl;
            const hash = generateReviewHash(newReview.id);
            const approveUrl = `${appUrl}/api/reviews/auto-reply?action=approve&review_id=${newReview.id}&hash=${hash}`;
            const rejectUrl = `${appUrl}/api/reviews/auto-reply?action=reject&review_id=${newReview.id}&hash=${hash}`;

            // SMS alert
            if (user.sms_enabled && user.phone_number) {
              const firstName = reviewerName.split(' ')[0];
              const smsBody = `New ${rating}-star review from ${firstName}. We've drafted a reply — check your email to approve or handle it yourself. - ${t.brandName}`;
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
                  tenant: t,
                }),
                tenant: t,
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
