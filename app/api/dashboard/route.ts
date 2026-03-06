import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getReviews, getLocalPosts, getMedia, getPerformanceMetrics, parseStarRating, getPlaceReviews, findPlaceId } from '@/lib/google';

export async function GET(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', userId).single();
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('user_id', userId).single();

    const [postsRes, reviewsRes, postCountRes, replyCountRes] = await Promise.all([
      supabaseAdmin.from('scheduled_posts').select('content, scheduled_for, status, published_at').eq('profile_id', profile?.id).order('scheduled_for', { ascending: false }).limit(5),
      supabaseAdmin.from('reviews').select('reviewer_name, rating, comment, reply_content, review_date').eq('profile_id', profile?.id).order('review_date', { ascending: false }).limit(8),
      supabaseAdmin.from('scheduled_posts').select('id', { count: 'exact', head: true }).eq('profile_id', profile?.id).eq('status', 'published'),
      supabaseAdmin.from('reviews').select('id', { count: 'exact', head: true }).eq('profile_id', profile?.id).not('reply_content', 'is', null),
    ]);

    let google: any = null;
    if (user.google_refresh_token && profile?.google_location_name) {
      try {
        const accessToken = await refreshAccessToken(user.google_refresh_token);
        const locName = profile.google_location_name;
        const acctId = profile.google_account_id;

        const [location, gReviews, gPosts, gMedia, gMetrics] = await Promise.all([
          getLocationFull(accessToken, locName).catch((e) => { console.error('[dashboard] Location failed:', e.message); return null; }),
          getReviews(accessToken, locName, acctId).catch((e) => { console.error('[dashboard] Reviews failed:', e.message); return { reviews: [] }; }),
          getLocalPosts(accessToken, locName, acctId).catch((e) => { console.error('[dashboard] Posts failed:', e.message); return { localPosts: [] }; }),
          getMedia(accessToken, locName, acctId).catch((e) => { console.error('[dashboard] Media failed:', e.message); return { mediaItems: [] }; }),
          getPerformanceMetrics(accessToken, locName).catch((e) => { console.error('[dashboard] Metrics failed:', e.message); return null; }),
        ]);

        console.log('[dashboard] Location:', location ? 'OK' : 'null');
        console.log('[dashboard] Reviews count:', (gReviews?.reviews || []).length);
        console.log('[dashboard] Posts count:', (gPosts?.localPosts || []).length);
        console.log('[dashboard] Media count:', (gMedia?.mediaItems || []).length);
        console.log('[dashboard] Metrics:', gMetrics ? JSON.stringify(gMetrics) : 'null');

        let revList = gReviews?.reviews || [];
        let reviewsFull: Array<{ name: string; rating: number; comment: string; date: string; hasReply: boolean; replyText: string | null }> = [];
        let totalReviews = 0;
        let avgRating = 0;
        let repliedCount = 0;
        let unrepliedCount = 0;
        let userRatingCount = 0;
        let overallRating = 0;

        // If v4 reviews failed (empty), try Places API as fallback
        if (revList.length === 0) {
          try {
            // Try to find Place ID from location metadata or search
            let placeId = profile.google_place_id;
            if (!placeId && location?.metadata?.mapsUri) {
              // Extract from maps URI if available
              const match = location.metadata.mapsUri.match(/place_id[=:]([^&]+)/);
              if (match) placeId = match[1];
            }
            if (!placeId) {
              placeId = await findPlaceId(profile.business_name, location?.storefrontAddress?.addressLines?.[0]);
            }
            if (placeId) {
              console.log('[dashboard] Using Places API fallback, placeId:', placeId);
              // Save placeId for future use
              if (!profile.google_place_id) {
                await supabaseAdmin.from('profiles').update({ google_place_id: placeId }).eq('id', profile.id);
              }
              const placeData = await getPlaceReviews(placeId);
              userRatingCount = placeData.userRatingCount || 0;
              overallRating = placeData.rating || 0;
              const placeReviews = placeData.reviews || [];
              reviewsFull = placeReviews.map((r: any) => ({
                name: r.authorAttribution?.displayName || 'Customer',
                rating: r.rating || 0,
                comment: r.text?.text || r.originalText?.text || '',
                date: r.publishTime || '',
                hasReply: false,
                replyText: null,
              }));
              totalReviews = userRatingCount;
              avgRating = overallRating;
              console.log('[dashboard] Places API reviews:', reviewsFull.length, 'total rating count:', userRatingCount);
            }
          } catch (e: any) {
            console.error('[dashboard] Places API fallback failed:', e.message);
          }
        } else {
          // v4 reviews worked
          totalReviews = revList.length;
          avgRating = totalReviews > 0 ? revList.reduce((s: number, r: any) => s + parseStarRating(r.starRating), 0) / totalReviews : 0;
          repliedCount = revList.filter((r: any) => r.reviewReply).length;
          unrepliedCount = totalReviews - repliedCount;
          reviewsFull = revList.slice(0, 8).map((r: any) => ({
            name: r.reviewer?.displayName || 'Customer',
            rating: parseStarRating(r.starRating),
            comment: r.comment || '',
            date: r.createTime,
            hasReply: !!r.reviewReply,
            replyText: r.reviewReply?.comment || null,
          }));
        }

        const postList = gPosts?.localPosts || [];
        const photoCount = gMedia?.mediaItems?.length || 0;
        const photoTypes = (gMedia?.mediaItems || []).reduce((acc: any, m: any) => {
          const cat = m.locationAssociation?.category || 'OTHER';
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {});

        const desc = location?.profile?.description || '';
        const hours = location?.regularHours?.periods || [];
        const svcs = location?.serviceItems || [];
        const cats = location?.categories?.additionalCategories || [];
        const primaryCat = location?.categories?.primaryCategory?.displayName || profile?.category || '';
        const phone = location?.phoneNumbers?.primaryPhone || null;
        const website = location?.websiteUri || null;
        const mapsUri = location?.metadata?.mapsUri || null;

        // Services list for display
        const serviceNames = svcs.map((s: any) => s.freeFormServiceItem?.label?.displayName || s.structuredServiceItem?.description || '').filter(Boolean);

        // Parse metrics — now returned as {views, calls, directions, websiteClicks} directly
        const views = gMetrics?.views || 0;
        const calls = gMetrics?.calls || 0;
        const directions = gMetrics?.directions || 0;
        const websiteClicks = gMetrics?.websiteClicks || 0;

        // Google posts for display
        const googlePosts = postList.slice(0, 3).map((p: any) => ({
          content: p.summary || '',
          date: p.createTime,
          type: p.topicType || 'STANDARD',
        }));

        google = {
          reviews: { total: totalReviews, avgRating: Math.round(avgRating * 10) / 10, replied: repliedCount, unreplied: unrepliedCount, list: reviewsFull },
          posts: { total: postList.length, lastPostDate: postList[0]?.createTime || null, list: googlePosts },
          photos: { total: photoCount, byType: photoTypes },
          profile: {
            description: desc.slice(0, 200) + (desc.length > 200 ? '...' : ''),
            descriptionLength: desc.length,
            hoursSet: hours.length > 0,
            servicesCount: svcs.length,
            serviceNames: serviceNames.slice(0, 8),
            categoriesCount: cats.length + 1,
            primaryCategory: primaryCat,
            additionalCategories: cats.map((c: any) => c.displayName),
            hasPhone: !!phone,
            hasWebsite: !!website,
            mapsUri,
          },
          metrics: { views, calls, directions, websiteClicks, totalActions: calls + directions + websiteClicks },
        };
      } catch (e: any) {
        console.error('Google fetch failed (non-blocking):', e.message);
      }
    }

    // Activity log
    const activity: Array<{ action: string; date: string; type: string }> = [];
    for (const p of (postsRes.data || [])) {
      if (p.status === 'published' && p.published_at) activity.push({ action: 'Published a Google post', date: p.published_at, type: 'post' });
      else if (p.status === 'pending_approval' || p.status === 'pending') activity.push({ action: 'Post scheduled', date: p.scheduled_for, type: 'scheduled' });
    }
    for (const r of (reviewsRes.data || [])) {
      if (r.reply_content) activity.push({ action: `Replied to ${r.reviewer_name}'s review`, date: r.review_date, type: 'reply' });
    }
    activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // This week plan
    const now = new Date();
    const dayOfWeek = now.getDay();
    const plan = [
      { day: 'Monday', action: 'Weekly stats sent via SMS', status: dayOfWeek > 1 ? 'done' : dayOfWeek === 1 ? 'today' : 'upcoming', type: 'stats' },
      { day: 'Wednesday', action: 'New post drafted for review', status: dayOfWeek > 3 ? 'done' : dayOfWeek === 3 ? 'today' : 'upcoming', type: 'post' },
      { day: 'Friday', action: 'Post published to Google', status: dayOfWeek > 5 ? 'done' : dayOfWeek === 5 ? 'today' : 'upcoming', type: 'publish' },
      { day: 'Daily', action: 'New reviews monitored', status: 'ongoing', type: 'reviews' },
    ];

    return NextResponse.json({
      user: { name: user.name, email: user.email, referral_code: user.referral_code, subscription_status: user.subscription_status },
      profile: profile ? { business_name: profile.business_name, category: profile.category, city: profile.city, streak_weeks: profile.streak_weeks || 0, total_posts: postCountRes.count || 0, total_replies: replyCountRes.count || 0, audit_score: profile.audit_score || null, audit_score_after: profile.audit_score_after || null } : null,
      google,
      recentPosts: postsRes.data || [],
      recentReviews: reviewsRes.data || [],
      activity: activity.slice(0, 10),
      plan,
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
