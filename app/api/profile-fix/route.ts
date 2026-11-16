import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, getReviews, parseStarRating } from '@/lib/google';
import { loggedUpdateLocation, loggedReplyToReview, type WriteContext } from '@/lib/change-log';
import { generateReviewReply } from '@/lib/ai';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';
import { ONBOARDING_REPLY_CAP } from '@/lib/review-intake';
import { ukTomorrowAt } from '@/lib/post-schedule';
import { AWAITING_APPROVAL, aiReplyAllowed } from '@/lib/safe-automation';
import { loadVoiceForUser } from '@/lib/voice';
import { queueOnboardingHoldingReplies } from '@/lib/onboarding-reviews';

export async function POST(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await request.json();
    const { description, services, categories, hours, replyToReviews, firstPost } = body;
    // Queue holding replies for recent low-star reviews (lib/onboarding-reviews.ts).
    // Strictly true only: a missing or odd value means no.
    const queueLowStar = body.queueLowStar === true;

    const { data: userData } = await supaAdmin.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', userId).single();
    // A managed retailer (Route 1) legitimately has no token of their own — the
    // credential belongs to the operator account managing their listing — so the
    // question is "is there access", not "is there a token on this row".
    const access = resolveAccess(userData);
    if (!access.ok) {
      console.warn('[profile-fix] no Google access for user', userData?.id, '—', access.reason);
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }

    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 400 });

    const accessToken = await refreshAccessToken(
      decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)),
    );
    const locName = profile.google_location_name;
    const acctId = profile.google_account_id;
    console.log('[profile-fix] Token refreshed OK, location:', locName, 'account:', acctId);
    console.log('[profile-fix] Fix request body:', JSON.stringify(body).slice(0, 300));
    const results: Array<{ step: string; success: boolean; detail?: string }> = [];
    // Every listing write below is recorded in change_log with its before-value.
    const log: WriteContext = { db: supaAdmin, source: 'onboarding', userId, profileId: profile.id };

    // 1. Description
    if (description) {
      try {
        await loggedUpdateLocation(log, accessToken, locName, 'profile', { profile: { description } });
        results.push({ step: 'description', success: true });
      } catch (e: any) { results.push({ step: 'description', success: false, detail: e.message }); }
    }

    // 2. Services
    if (services?.length) {
      try {
        const serviceItems = services.map((name: string) => ({
          freeFormServiceItem: { category: profile.category || '', label: { displayName: name, languageCode: 'en' } },
        }));
        await loggedUpdateLocation(log, accessToken, locName, 'serviceItems', { serviceItems });
        results.push({ step: 'services', success: true });
      } catch (e: any) { results.push({ step: 'services', success: false, detail: e.message }); }
    }

    // 3. Categories
    if (categories?.length) {
      try {
        await loggedUpdateLocation(log, accessToken, locName, 'categories', {
          categories: { primaryCategory: { displayName: profile.category || '' }, additionalCategories: categories.map((n: string) => ({ displayName: n })) },
        });
        results.push({ step: 'categories', success: true });
      } catch (e: any) { results.push({ step: 'categories', success: false, detail: e.message }); }
    }

    // 4. Hours
    if (hours) {
      try {
        await loggedUpdateLocation(log, accessToken, locName, 'regularHours', { regularHours: hours });
        results.push({ step: 'hours', success: true });
      } catch (e: any) { results.push({ step: 'hours', success: false, detail: e.message }); }
    }

    // 5. Review replies. The reviews are read once, for both halves below.
    let revData: any = null;
    if (replyToReviews || queueLowStar) {
      try { revData = await getReviews(accessToken, locName, acctId); }
      catch (e: any) { results.push({ step: 'reviews', success: false, detail: e.message }); }
    }
    if (replyToReviews && revData) {
      try {
        // 4 and 5 stars only get an AI reply. Before this, onboarding wrote and
        // published an AI reply to every unreplied review, including 1 to 3
        // stars, which the low-star rule (lib/safe-automation.ts) forbids
        // everywhere else. Low-star reviews are handled separately below.
        const allUnrep = (revData.reviews || []).filter((r: any) => !r.reviewReply && aiReplyAllowed(parseStarRating(r.starRating)));
        const unrep = allUnrep.slice(0, ONBOARDING_REPLY_CAP);
        const voice = await loadVoiceForUser(supaAdmin, userId);
        let count = 0;
        for (const rev of unrep) {
          try {
            const rating = parseStarRating(rev.starRating);
            const rName = rev.reviewer?.displayName || 'Customer';
            const reply = await generateReviewReply({ businessName: profile.business_name, category: profile.category || '', reviewerName: rName, rating, comment: rev.comment || '', voice });
            await loggedReplyToReview(log, accessToken, rev.name, reply, rev.reviewReply?.comment ?? null);
            await supaAdmin.from('reviews').upsert({ profile_id: profile.id, google_review_id: rev.reviewId || rev.name, reviewer_name: rName, rating, comment: rev.comment || '', review_date: rev.createTime }, { onConflict: 'google_review_id' });
            count++;
          } catch { /* continue */ }
        }
        results.push({ step: 'reviews', success: true, detail: `${count}/${unrep.length} replied${allUnrep.length > unrep.length ? ` (${allUnrep.length} unreplied in total; capped at ${ONBOARDING_REPLY_CAP})` : ''}` });
      } catch (e: any) { results.push({ step: 'reviews', success: false, detail: e.message }); }
    }

    // 5b. 1 to 3 stars: queue the fixed holding reply for the shop to approve
    // (lib/onboarding-reviews.ts). Nothing is published and nothing is sent;
    // recent reviews only; capped. Separate from the step above, so a shop with
    // only low-star reviews is still covered and neither half can undo the other.
    if (queueLowStar && revData) {
      try {
        const q = await queueOnboardingHoldingReplies(supaAdmin, profile.id, revData.reviews || [], (r: any) => parseStarRating(r.starRating));
        results.push({ step: 'lowStarHolding', success: q.failed === 0, detail: `${q.queued} holding repl${q.queued === 1 ? 'y' : 'ies'} waiting for approval; ${q.tooOld} older than the 14-day rule left alone; ${q.overCap} over the cap; ${q.alreadyHandled} already handled${q.failed ? `; ${q.failed} failed` : ''}` });
      } catch (e: any) { results.push({ step: 'lowStarHolding', success: false, detail: e.message }); }
    }

    // 6. First post
    if (firstPost) {
      try {
        // 10:00 UK time tomorrow, not 10:00 on the server's clock (UTC).
        const tomorrow = ukTomorrowAt(10);
        // The first post waits for the shop's approval, like the next two
        // (lib/safe-automation.ts). It does not publish on its own.
        await supaAdmin.from('scheduled_posts').insert({ profile_id: profile.id, content: firstPost, scheduled_for: tomorrow.toISOString(), status: AWAITING_APPROVAL });
        results.push({ step: 'firstPost', success: true });
      } catch (e: any) { results.push({ step: 'firstPost', success: false, detail: e.message }); }
    }

    await supaAdmin.from('users').update({ onboarding_step: 'complete' }).eq('id', userId);
    console.log('[profile-fix] Results:', JSON.stringify(results));
    return NextResponse.json({ results, totalFixes: results.length, successfulFixes: results.filter(r => r.success).length });
  } catch (error: any) {
    console.error('Fix error:', error);
    return NextResponse.json({ error: error.message || 'Fix failed' }, { status: 500 });
  }
}
