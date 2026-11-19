import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles, generateReviewHash } from '@/lib/cron';
import { refreshAccessToken, getReviews, parseStarRating } from '@/lib/google';
import { loggedReplyToReview } from '@/lib/change-log';
import { generateReviewReply } from '@/lib/ai';
import { loadVoiceForUser } from '@/lib/voice';
import { sendSMS, logSMS } from '@/lib/twilio';
import { sendEmail, reviewAlertEmail } from '@/lib/email';
import { getTenantForRow } from '@/lib/tenant';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess } from '@/lib/managed-access';
import { splitNewReviews, reviewKey, BACKLOG_DAYS, REVIEWS_CONFLICT_TARGET } from '@/lib/review-intake';
import { holdingReply } from '@/lib/safe-automation';
import { startBudget, rotateForRun, runIndex, selectAll } from '@/lib/cron-budget';

/**
 * How far the starting point moves each run. Coverage depends on every run
 * getting at least this far down its list. Answering a new review takes nearly
 * five seconds, so a run that meets three of them reaches only a handful of
 * shops; 6 is a distance even a busy run covers. (It was 12, every half hour,
 * and review found that the shops just behind a busy stretch could be missed
 * for the day.)
 */
const STRIDE = 6;
/** Minutes between runs: must match the schedule in netlify/functions/cron-review-alerts.mts. */
const EVERY_MINUTES = 15;
/**
 * Lower than the other jobs' 20 seconds. Answering one review takes over four
 * seconds (the model, then Google), and the last one started must still finish
 * before the scheduler stops waiting at 25.
 */
const BUDGET_MS = 18_000;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'review-alerts');
    let processed = 0;

    // Each shop costs about a second even when it has no new reviews (one
    // Google sign-in, one read of its reviews), so one run cannot reach
    // everyone once there are more than a few dozen shops. This job now runs
    // every 15 minutes through the working day (netlify/functions/cron-review-alerts.mts)
    // and each run starts a little further down the list, so the whole list is
    // covered across the day instead of the same shops being checked and the
    // rest never. Checking a shop twice is harmless: a review already seen is
    // skipped.
    const budget = startBudget(BUDGET_MS);
    const eligible = rotateForRun<any>(users.filter((u: any) => u.auto_reply_enabled && u.profiles?.[0]), runIndex(EVERY_MINUTES), STRIDE);
    let checked = 0;

    for (const user of eligible) {
      if (budget.exhausted()) break;
      checked++;
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
        // Read in pages. A single request stops at 1,000 rows without saying
        // so, and a listing with more reviews than that would have had some of
        // its already-answered reviews look new.
        const seenRows = await selectAll<{ google_review_id: string }>((from, to) => supabaseAdmin
          .from('reviews')
          .select('google_review_id')
          .eq('profile_id', profile.id)
          .order('id', { ascending: true })
          .range(from, to));
        const seen = new Set<string>(seenRows.map((r) => r.google_review_id));

        // Recent reviews are handled (capped per run); old ones are recorded
        // without a reply or alert. See lib/review-intake.ts for why.
        const { toHandle, backlog, deferred, answered } = splitNewReviews(reviewsData.reviews || [], seen);
        // Old reviews, and reviews somebody has already answered, are recorded
        // so they are never looked at again, and that is all.
        const recordOnly = [...backlog, ...answered];
        if (recordOnly.length) {
          const { error: backlogErr } = await supabaseAdmin.from('reviews').upsert(
            recordOnly.map((r: any) => ({
              profile_id: profile.id,
              google_review_id: reviewKey(r),
              reviewer_name: r.reviewer?.displayName || 'A customer',
              rating: parseStarRating(r.starRating),
              comment: r.comment || '',
              review_date: r.createTime || new Date().toISOString(),
            })),
            { onConflict: REVIEWS_CONFLICT_TARGET, ignoreDuplicates: true },
          );
          if (backlogErr) console.error(`[cron:review-alerts] backlog record failed for profile ${profile.id}:`, backlogErr.message);
        }
        if (backlog.length || deferred.length || answered.length) {
          console.log(`[cron:review-alerts] profile ${profile.id}: ${toHandle.length} handled, ${backlog.length} older than ${BACKLOG_DAYS} days recorded without reply, ${answered.length} already answered and left alone, ${deferred.length} deferred to next run`);
        }

        for (const review of toHandle as any[]) {
          // Out of time partway through one shop's reviews: stop. The ones not
          // reached have not been recorded, so the next run sees them as new.
          if (budget.exhausted()) break;
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

          // 4 and 5 stars: an AI reply, checked by the validator (lib/ai.ts),
          // published automatically. 1 to 3 stars: never AI. The fixed holding
          // reply (lib/safe-automation.ts) is stored for the shop to approve,
          // and is published only when they do.
          const replyContent = rating >= 4
            ? await generateReviewReply({
                businessName: profile.business_name,
                category: profile.category || 'tradesperson',
                reviewerName,
                rating,
                comment,
                // Voice applies to 4 and 5 star replies only. The holding reply
                // below is fixed wording for every shop, on purpose.
                voice: await loadVoiceForUser(supabaseAdmin, user.id),
              })
            : holdingReply(reviewerName);

          if (rating >= 4) {
            // Auto-publish for 4-5 star reviews
            try {
              await loggedReplyToReview(
                { db: supabaseAdmin, source: 'review-alerts', userId: user.id, profileId: profile.id },
                accessToken, review.name, replyContent, review.reviewReply?.comment ?? null,
              );

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

    const remaining = eligible.length - checked;
    if (remaining > 0) console.log(`[cron:review-alerts] checked ${checked} of ${eligible.length} shops this run; later runs today start further down the list`);
    return NextResponse.json({ success: true, processed, checked, remaining, partial: remaining > 0 });
  } catch (err) {
    console.error('Review alerts cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
