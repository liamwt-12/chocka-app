import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getReviews, getLocalPosts, getMedia, getPerformanceMetrics, parseStarRating } from '@/lib/google';

export async function GET(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', userId).single();
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('user_id', userId).single();

    // Supabase data
    const [postsRes, reviewsRes, postCountRes, replyCountRes] = await Promise.all([
      supabaseAdmin.from('scheduled_posts').select('content, scheduled_for, status, published_at').eq('profile_id', profile?.id).order('scheduled_for', { ascending: false }).limit(5),
      supabaseAdmin.from('reviews').select('reviewer_name, rating, comment, reply_content, review_date').eq('profile_id', profile?.id).order('review_date', { ascending: false }).limit(8),
      supabaseAdmin.from('scheduled_posts').select('id', { count: 'exact', head: true }).eq('profile_id', profile?.id).eq('status', 'published'),
      supabaseAdmin.from('reviews').select('id', { count: 'exact', head: true }).eq('profile_id', profile?.id).not('reply_content', 'is', null),
    ]);

    // Live Google data (best effort - don't block dashboard if it fails)
    let google: any = null;
    if (user.google_refresh_token && profile?.google_location_name) {
      try {
        const accessToken = await refreshAccessToken(user.google_refresh_token);
        const locName = profile.google_location_name;

        const [location, gReviews, gPosts, gMedia, gMetrics] = await Promise.all([
          getLocationFull(accessToken, locName).catch(() => null),
          getReviews(accessToken, locName).catch(() => ({ reviews: [] })),
          getLocalPosts(accessToken, locName).catch(() => ({ localPosts: [] })),
          getMedia(accessToken, locName).catch(() => ({ mediaItems: [] })),
          getPerformanceMetrics(accessToken, locName).catch(() => null),
        ]);

        const revList = gReviews?.reviews || [];
        const totalReviews = revList.length;
        const avgRating = totalReviews > 0 ? revList.reduce((s: number, r: any) => s + parseStarRating(r.starRating), 0) / totalReviews : 0;
        const repliedCount = revList.filter((r: any) => r.reviewReply).length;
        const unrepliedCount = totalReviews - repliedCount;

        const postList = gPosts?.localPosts || [];
        const photoCount = gMedia?.mediaItems?.length || 0;

        const desc = location?.profile?.description || '';
        const hours = location?.regularHours?.periods || [];
        const svcs = location?.serviceItems || [];
        const cats = location?.categories?.additionalCategories || [];
        const phone = location?.phoneNumbers?.primaryPhone || null;
        const website = location?.websiteUri || null;

        // Parse metrics
        let views = 0, searches = 0, calls = 0, directions = 0, websiteClicks = 0;
        if (gMetrics?.locationMetrics?.[0]?.metricValues) {
          for (const mv of gMetrics.locationMetrics[0].metricValues) {
            const total = mv.dimensionalValues?.reduce((s: number, d: any) => s + (parseInt(d.value) || 0), 0) || 0;
            if (mv.metric === 'QUERIES_DIRECT') views += total;
            if (mv.metric === 'QUERIES_INDIRECT') searches += total;
            if (mv.metric === 'ACTIONS_PHONE') calls += total;
            if (mv.metric === 'ACTIONS_DRIVING_DIRECTIONS') directions += total;
            if (mv.metric === 'ACTIONS_WEBSITE') websiteClicks += total;
          }
        }

        google = {
          reviews: { total: totalReviews, avgRating: Math.round(avgRating * 10) / 10, replied: repliedCount, unreplied: unrepliedCount },
          posts: { total: postList.length, lastPostDate: postList[0]?.createTime || null },
          photos: photoCount,
          profile: { descriptionLength: desc.length, hoursSet: hours.length > 0, servicesCount: svcs.length, categoriesCount: cats.length + 1, hasPhone: !!phone, hasWebsite: !!website },
          metrics: { views, searches, calls, directions, websiteClicks, totalActions: calls + directions + websiteClicks },
        };
      } catch (e: any) {
        console.error('Google fetch failed (non-blocking):', e.message);
      }
    }

    // Build activity log from our data
    const activity: Array<{ action: string; date: string; type: string }> = [];
    for (const p of (postsRes.data || [])) {
      if (p.status === 'published' && p.published_at) {
        activity.push({ action: 'Published a Google post', date: p.published_at, type: 'post' });
      } else if (p.status === 'pending_approval' || p.status === 'pending') {
        activity.push({ action: 'Post scheduled', date: p.scheduled_for, type: 'scheduled' });
      }
    }
    for (const r of (reviewsRes.data || [])) {
      if (r.reply_content) {
        activity.push({ action: `Replied to ${r.reviewer_name}'s review`, date: r.review_date, type: 'reply' });
      }
    }
    activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({
      user: { name: user.name, email: user.email, referral_code: user.referral_code, subscription_status: user.subscription_status, onboarding_step: user.onboarding_step },
      profile: profile ? { business_name: profile.business_name, category: profile.category, city: profile.city, streak_weeks: profile.streak_weeks || 0, total_posts: postCountRes.count || 0, total_replies: replyCountRes.count || 0, audit_score: profile.audit_score || null, audit_score_after: profile.audit_score_after || null } : null,
      google,
      recentPosts: postsRes.data || [],
      recentReviews: reviewsRes.data || [],
      activity: activity.slice(0, 10),
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
