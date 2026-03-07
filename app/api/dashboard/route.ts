import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getReviews, getLocalPosts, getMedia, getPerformanceMetrics, parseStarRating, getPlaceReviews, findPlaceId } from '@/lib/google';

async function searchCompetitors(category: string, lat: number, lng: number) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !lat || !lng) return [];
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress', 'Content-Type': 'application/json' },
      body: JSON.stringify({ textQuery: `${category} near me`, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 5000 } }, maxResultCount: 6, languageCode: 'en' }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.places || []).map((p: any) => ({
      name: p.displayName?.text || 'Unknown',
      rating: p.rating || 0,
      reviewCount: p.userRatingCount || 0,
      address: p.formattedAddress || '',
      placeId: p.id,
    }));
  } catch { return []; }
}

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
    let competitors: any[] = [];

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
          totalReviews = revList.length;
          avgRating = totalReviews > 0 ? revList.reduce((s: number, r: any) => s + parseStarRating(r.starRating), 0) / totalReviews : 0;
          repliedCount = revList.filter((r: any) => r.reviewReply).length;
          unrepliedCount = totalReviews - repliedCount;
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
        const lat = location?.latlng?.latitude || profile?.latitude || 0;
        const lng = location?.latlng?.longitude || profile?.longitude || 0;
        const serviceNames = svcs.map((s: any) => s.freeFormServiceItem?.label?.displayName || s.structuredServiceItem?.description || '').filter(Boolean);

        const views = gMetrics?.views || 0;
        const calls = gMetrics?.calls || 0;
        const directions = gMetrics?.directions || 0;
        const websiteClicks = gMetrics?.websiteClicks || 0;

        // Competitor search
        if (primaryCat && lat && lng) {
          const rawComps = await searchCompetitors(primaryCat, lat, lng);
          // Filter out self and score them
          competitors = rawComps.filter((c: any) => c.name !== profile.business_name).slice(0, 4).map((c: any) => {
            const score = Math.min(100, Math.round((c.rating / 5) * 50 + Math.min(c.reviewCount, 50)));
            return { ...c, score };
          });
        }

        // Calculate own competitor score
        const ownScore = p?.audit_score_after || p?.audit_score || Math.min(100, Math.round((avgRating / 5) * 50 + Math.min(totalReviews, 50)));

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
          competitors: { own: { name: profile.business_name, score: ownScore }, list: competitors },
        };
      } catch (e: any) { console.error('Google fetch failed:', e.message); }
    }

    // Activity log
    const activity: Array<{ action: string; date: string; type: string; detail?: string }> = [];
    for (const post of (postsRes.data || [])) {
      if (post.status === 'published' && post.published_at) activity.push({ action: 'Post published to Google', date: post.published_at, type: 'post', detail: `"${(post.content || '').slice(0, 50)}..."` });
      else if (post.status === 'pending_approval' || post.status === 'pending') activity.push({ action: 'Post scheduled', date: post.scheduled_for, type: 'scheduled' });
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

    return NextResponse.json({
      user: { name: user.name, email: user.email, phone: user.phone_number, referral_code: user.referral_code, subscription_status: user.subscription_status, auto_post_enabled: user.auto_post_enabled, auto_reply_enabled: user.auto_reply_enabled, sms_enabled: user.sms_enabled },
      profile: profile ? { business_name: profile.business_name, category: profile.category, city: profile.city, streak_weeks: profile.streak_weeks || 0, total_posts: postCountRes.count || 0, total_replies: replyCountRes.count || 0, audit_score: profile.audit_score || null, audit_score_after: profile.audit_score_after || null, latitude: profile.latitude, longitude: profile.longitude } : null,
      google, recentPosts: postsRes.data || [], recentReviews: reviewsRes.data || [],
      activity: activity.slice(0, 10), plan,
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
