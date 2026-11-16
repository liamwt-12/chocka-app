import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getReviews, getLocalPosts, getMedia, getPerformanceMetrics, parseStarRating, getPlaceReviews, findPlaceId } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';
import { SHOP_MESSAGES } from '@/lib/ownership';
import { generateReviewHash } from '@/lib/cron';
import { pendingRepliesForDashboard, type PendingReplyRow } from '@/lib/onboarding-reviews';

export async function GET(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: user } = await supabaseAdmin.from('users').select(`*, ${MANAGER_EMBED}`).eq('id', userId).single();
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('user_id', userId).single();

    const [postsRes, reviewsRes, postCountRes, replyCountRes] = await Promise.all([
      supabaseAdmin.from('scheduled_posts').select('content, scheduled_for, status, published_at').eq('profile_id', profile?.id).order('scheduled_for', { ascending: false }).limit(5),
      supabaseAdmin.from('reviews').select('reviewer_name, rating, comment, reply_content, review_date').eq('profile_id', profile?.id).order('review_date', { ascending: false }).limit(8),
      supabaseAdmin.from('scheduled_posts').select('id', { count: 'exact', head: true }).eq('profile_id', profile?.id).eq('status', 'published'),
      supabaseAdmin.from('reviews').select('id', { count: 'exact', head: true }).eq('profile_id', profile?.id).not('reply_content', 'is', null),
    ]);

    let google: any = null;

    // Access, not "is there a token on this row" — a managed retailer's
    // credential lives on the operator account, so the old truthiness check
    // would render every Route 1 dashboard as if Google were disconnected.
    const access = resolveAccess(user);
    if (access.ok && profile?.google_location_name) {
      try {
        const accessToken = await refreshAccessToken(
          decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)),
        );
        const locName = profile.google_location_name;
        const acctId = profile.google_account_id;

        const [location, gReviews, gPosts, gMedia, gMetrics] = await Promise.all([
          getLocationFull(accessToken, locName).catch((e) => { console.error('[dashboard] Location failed:', e.message); return null; }),
          getReviews(accessToken, locName, acctId).catch((e) => { console.error('[dashboard] Reviews failed:', e.message); return { reviews: [] }; }),
          getLocalPosts(accessToken, locName, acctId).catch((e) => { console.error('[dashboard] Posts failed:', e.message); return { localPosts: [] }; }),
          getMedia(accessToken, locName, acctId).catch((e) => { console.error('[dashboard] Media failed:', e.message); return { mediaItems: [] }; }),
          getPerformanceMetrics(accessToken, locName).catch((e) => { console.error('[dashboard] Metrics failed:', e.message); return null; }),
        ]);

        let revList = gReviews?.reviews || [];
        let reviewsFull: Array<any> = [];
        let totalReviews = 0, avgRating = 0, repliedCount = 0, unrepliedCount = 0, userRatingCount = 0;

        if (revList.length === 0) {
          try {
            let placeId = profile.google_place_id;
            if (!placeId && location?.metadata?.mapsUri) {
              const match = location.metadata.mapsUri.match(/place_id[=:]([^&]+)/);
              if (match) placeId = match[1];
            }
            if (!placeId) placeId = await findPlaceId(profile.business_name, location?.storefrontAddress?.addressLines?.[0]);
            if (placeId) {
              if (!profile.google_place_id) await supabaseAdmin.from('profiles').update({ google_place_id: placeId }).eq('id', profile.id);
              const placeData = await getPlaceReviews(placeId);
              userRatingCount = placeData.userRatingCount || 0;
              avgRating = placeData.rating || 0;
              reviewsFull = (placeData.reviews || []).map((r: any) => ({
                name: r.authorAttribution?.displayName || 'Customer', rating: r.rating || 0,
                comment: r.text?.text || r.originalText?.text || '', date: r.publishTime || '',
                hasReply: false, replyText: null,
              }));
              totalReviews = userRatingCount;
            }
          } catch (e: any) { console.error('[dashboard] Places fallback failed:', e.message); }
        } else {
          // getReviews now returns every page. Google's own totals are preferred
          // when present, since they stay exact even if the page cap was hit.
          const fetched = revList.length;
          const totals = gReviews as { totalReviewCount?: number; averageRating?: number };
          totalReviews = totals?.totalReviewCount || fetched;
          avgRating = totals?.averageRating || (fetched > 0 ? revList.reduce((s: number, r: any) => s + parseStarRating(r.starRating), 0) / fetched : 0);
          repliedCount = revList.filter((r: any) => r.reviewReply).length;
          unrepliedCount = fetched - repliedCount;
          reviewsFull = revList.slice(0, 8).map((r: any) => ({
            name: r.reviewer?.displayName || 'Customer', rating: parseStarRating(r.starRating),
            comment: r.comment || '', date: r.createTime, hasReply: !!r.reviewReply, replyText: r.reviewReply?.comment || null,
          }));
        }

        const postList = gPosts?.localPosts || [];
        const photoCount = gMedia?.mediaItems?.length || 0;

        const desc = location?.profile?.description || '';
        const hours = location?.regularHours?.periods || [];
        const svcs = location?.serviceItems || [];
        const cats = location?.categories?.additionalCategories || [];
        const primaryCat = location?.categories?.primaryCategory?.displayName || profile?.category || '';
        const phone = location?.phoneNumbers?.primaryPhone || null;
        const website = location?.websiteUri || null;
        const mapsUri = location?.metadata?.mapsUri || null;
        const serviceNames = svcs.map((s: any) => s.freeFormServiceItem?.label?.displayName || s.structuredServiceItem?.description || '').filter(Boolean);

        const views = gMetrics?.views || 0;
        const calls = gMetrics?.calls || 0;
        const directions = gMetrics?.directions || 0;
        const websiteClicks = gMetrics?.websiteClicks || 0;

        google = {
          reviews: { total: totalReviews, avgRating: Math.round(avgRating * 10) / 10, replied: repliedCount, unreplied: unrepliedCount, list: reviewsFull },
          posts: { total: postList.length, lastPostDate: postList[0]?.createTime || null },
          photos: { total: photoCount },
          profile: {
            description: desc.slice(0, 200) + (desc.length > 200 ? '...' : ''), descriptionLength: desc.length,
            hoursSet: hours.length > 0, servicesCount: svcs.length, serviceNames: serviceNames.slice(0, 8),
            categoriesCount: cats.length + 1, primaryCategory: primaryCat,
            additionalCategories: cats.map((c: any) => c.displayName),
            hasPhone: !!phone, hasWebsite: !!website, mapsUri,
          },
          metrics: { views, calls, directions, websiteClicks, totalActions: calls + directions + websiteClicks },
        };
      } catch (e: any) { console.error('Google fetch failed:', e.message); }
    }

    // Activity log
    const activity: Array<{ action: string; date: string; type: string; detail?: string }> = [];
    for (const post of (postsRes.data || [])) {
      if (post.status === 'published' && post.published_at) activity.push({ action: 'Post published to Google', date: post.published_at, type: 'post', detail: `"${(post.content || '').slice(0, 50)}..."` });
      else if (post.status === 'pending_approval' || post.status === 'pending') activity.push({ action: 'Post scheduled', date: post.scheduled_for, type: 'scheduled' });
      else if (post.status === 'awaiting_approval') activity.push({ action: 'Post waiting for your approval', date: post.scheduled_for, type: 'scheduled' });
    }
    for (const r of (reviewsRes.data || [])) {
      if (r.reply_content) activity.push({ action: `${r.rating}★ review replied to`, date: r.review_date, type: 'reply', detail: `${r.reviewer_name} — "${(r.comment || '').slice(0, 40)}..."` });
    }
    activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // This week plan
    const now = new Date();
    const dow = now.getDay();
    const plan = [
      { day: 'Mon', action: 'Weekly stats sent via SMS', status: dow > 1 ? 'done' : dow === 1 ? 'today' : 'upcoming' },
      { day: 'Tue', action: 'Reviews monitored & replied', status: dow > 2 ? 'done' : dow === 2 ? 'today' : 'upcoming' },
      { day: 'Wed', action: 'New post drafted & approved', status: dow > 3 ? 'done' : dow === 3 ? 'today' : 'upcoming' },
      { day: 'Fri', action: 'Post published to Google', status: dow > 5 ? 'done' : dow === 5 ? 'today' : 'upcoming' },
      { day: 'Daily', action: 'Reviews monitored', status: 'ongoing' },
      { day: 'Daily', action: 'Q&A section checked', status: 'ongoing' },
    ];

    // Referral count
    const { count: referralCount } = await supabaseAdmin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', userId)
      .eq('status', 'completed');

    // The pre-launch baseline for this retailer, if they came in through an
    // invite. Read through retailers.user_id, which linkInviteToUser is the only
    // thing that sets — so a self-serve signup simply has none and the dashboard
    // shows nothing extra.
    //
    // Returned RAW, not resolved. resolveRetailerScore is the single place that
    // decides which score wins and whether it can be trusted, and it needs the
    // live score alongside; doing half of that here would put the precedence
    // rule in two places.
    const { data: retailer } = await supabaseAdmin
      .from('retailers')
      .select('name, score, band, scored_at, match_confidence, connection_status, listing_confirmed_at')
      .eq('user_id', userId)
      .maybeSingle();

    // Review replies waiting for the shop's approval: holding replies for low-star
    // reviews, from onboarding or from the daily check. Shown on the dashboard so
    // approving never depends on an email arriving. A failure here just means
    // the card is not shown.
    let pendingReplies: ReturnType<typeof pendingRepliesForDashboard> = [];
    if (profile?.id) {
      const { data: pendingRows, error: pendingErr } = await supabaseAdmin
        .from('review_replies')
        .select('id, reply_content, reviews!inner ( id, profile_id, reviewer_name, rating, comment, review_date )')
        .eq('status', 'pending')
        .eq('reviews.profile_id', profile.id)
        .limit(10);
      if (pendingErr) console.error('[dashboard] pending replies failed:', pendingErr.message);
      else pendingReplies = pendingRepliesForDashboard((pendingRows || []) as unknown as PendingReplyRow[], generateReviewHash);
    }

    // Posts the shop can act on from here: ones waiting for its approval, and
    // ones booked that it can still cancel (app/api/posts/manage).
    let postsToManage: Array<{ id: string; content: string; scheduled_for: string; waiting: boolean }> = [];
    if (profile?.id) {
      const { data: rows, error: postsErr } = await supabaseAdmin.from('scheduled_posts')
        .select('id, content, scheduled_for, status')
        .eq('profile_id', profile.id).in('status', ['awaiting_approval', 'pending_approval'])
        .order('scheduled_for', { ascending: true }).limit(6);
      if (postsErr) console.error('[dashboard] posts to manage failed:', postsErr.message);
      else postsToManage = (rows || []).map((p: any) => ({ id: p.id, content: p.content, scheduled_for: p.scheduled_for, waiting: p.status === 'awaiting_approval' }));
    }

    // Lost Google access, said to the shop. Until now the dashboard carried on
    // showing a green "Connected" whatever had happened, and a shop with
    // posting off was never told. `access` was worked out above for the Google
    // reads; this only turns it into words.
    const accessLost = !access.ok && !!profile?.google_location_name;
    const lostAccess = accessLost ? {
      since: user.token_invalid_at ?? null,
      title: 'We have lost the connection to your Google account',
      message: 'Nothing is wrong with your listing. Google has stopped letting us in, which usually happens after a password change or if we were removed in Google. Until you reconnect, we cannot post, reply or show you up-to-date figures.',
      nextStep: 'Press Reconnect and sign in with the same Google account as before. It takes a minute.',
    } : null;

    return NextResponse.json({
      lostAccess,
      postsToManage,
      pendingReplies,
      retailer: retailer ?? null,
      // Plain-English status for invited shops that are not fully connected yet.
      // A "check listing" a person has since confirmed is no longer a question for the shop.
      connection: retailer?.connection_status && ['check_listing', 'waiting_google'].includes(retailer.connection_status) && !(retailer.connection_status === 'check_listing' && retailer.listing_confirmed_at)
        ? { status: retailer.connection_status, ...SHOP_MESSAGES[retailer.connection_status as 'check_listing' | 'waiting_google'] }
        : null,
      user: { name: user.name, email: user.email, phone: user.phone_number, referral_code: user.referral_code, subscription_status: user.subscription_status, auto_post_enabled: user.auto_post_enabled, auto_reply_enabled: user.auto_reply_enabled, sms_enabled: user.sms_enabled },
      profile: profile ? { business_name: profile.business_name, category: profile.category, city: profile.city, streak_weeks: profile.streak_weeks || 0, total_posts: postCountRes.count || 0, total_replies: replyCountRes.count || 0, audit_score: profile.audit_score || null, audit_score_after: profile.audit_score_after || null, latitude: profile.latitude, longitude: profile.longitude } : null,
      google, recentPosts: postsRes.data || [], recentReviews: reviewsRes.data || [],
      activity: activity.slice(0, 10), plan, referralCount: referralCount || 0,
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
