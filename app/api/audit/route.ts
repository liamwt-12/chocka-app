import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getGoogleUpdated, getAttributes, getMedia, getReviews, getLocalPosts, parseStarRating } from '@/lib/google';
import { generateDescription, generateServices, generatePost, generateReviewReply, suggestCategories } from '@/lib/ai';
import { scoreProfile, predictedScore } from '@/lib/audit';

function getSeason(): string {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userData } = await supaAdmin.from('users').select('id, google_refresh_token').eq('id', userId).single();
    if (!userData?.google_refresh_token) return NextResponse.json({ error: 'Google not connected' }, { status: 400 });

    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) return NextResponse.json({ error: 'No profile found' }, { status: 400 });

    const accessToken = await refreshAccessToken(userData.google_refresh_token);
    const locName = profile.google_location_name;
    const acctId = profile.google_account_id;

    // Fetch all GBP data in parallel
    const [location, googleUpdated, attributes, media, reviews, posts] = await Promise.all([
      getLocationFull(accessToken, locName),
      getGoogleUpdated(accessToken, locName).catch(() => null),
      getAttributes(accessToken, locName).catch(() => ({ attributes: [] })),
      getMedia(accessToken, locName, acctId).catch(() => ({ mediaItems: [] })),
      getReviews(accessToken, locName, acctId).catch(() => ({ reviews: [] })),
      getLocalPosts(accessToken, locName, acctId).catch(() => ({ localPosts: [] })),
    ]);

    const audit = scoreProfile({ location, attributes, media, reviews, posts, googleUpdated });
    const pred = predictedScore(audit);

    const city = location.storefrontAddress?.locality || '';
    const primaryCat = location.categories?.primaryCategory?.displayName || profile.category || '';
    const existDesc = location.profile?.description || '';
    const existSvcs = (location.serviceItems || []).map((s: any) => s.freeFormServiceItem?.label?.displayName || s.structuredServiceItem?.description || '').filter(Boolean);

    // Generate previews in parallel
    const [description, servicesList, firstPost, catSuggestions] = await Promise.all([
      audit.fixes.some(f => f.key === 'description')
        ? generateDescription({ businessName: profile.business_name, category: primaryCat, city, existingDescription: existDesc })
        : null,
      audit.fixes.some(f => f.key === 'services')
        ? generateServices({ businessName: profile.business_name, category: primaryCat, existingServices: existSvcs })
        : null,
      audit.fixes.some(f => f.key === 'firstPost')
        ? generatePost({ businessName: profile.business_name, category: primaryCat, city, month: new Date().toLocaleString('en-GB', { month: 'long' }), season: getSeason(), recentPosts: [] })
        : null,
      audit.fixes.some(f => f.key === 'categories')
        ? suggestCategories({ primaryCategory: primaryCat, businessName: profile.business_name })
        : null,
    ]);

    // Sample review reply preview
    let reviewPreview = null;
    const unreplied = (reviews.reviews || []).filter((r: any) => !r.reviewReply);
    if (unreplied.length > 0) {
      const sample = unreplied[0];
      const rating = parseStarRating(sample.starRating);
      const name = sample.reviewer?.displayName || 'Customer';
      const reply = await generateReviewReply({ businessName: profile.business_name, category: primaryCat, reviewerName: name, rating, comment: sample.comment || '' });
      reviewPreview = { reviewerName: name, rating, comment: sample.comment || '(no comment)', suggestedReply: reply, totalUnreplied: unreplied.length };
    }

    const defaultHours = {
      periods: [
        { openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'TUESDAY', closeDay: 'TUESDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'WEDNESDAY', closeDay: 'WEDNESDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'THURSDAY', closeDay: 'THURSDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'FRIDAY', closeDay: 'FRIDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'SATURDAY', closeDay: 'SATURDAY', openTime: '09:00', closeTime: '13:00' },
      ],
    };

    // Save scores to profile
    await supaAdmin.from('profiles').update({ audit_score: audit.score, audit_score_after: pred }).eq('id', profile.id);

    return NextResponse.json({
      audit, predicted: pred,
      previews: { description, services: servicesList, firstPost, categories: catSuggestions, reviewPreview, defaultHours: audit.fixes.some(f => f.key === 'hours') ? defaultHours : null },
      locationData: { title: location.title, address: location.storefrontAddress, primaryCategory: primaryCat, city, mapsUri: location.metadata?.mapsUri || null, newReviewUri: location.metadata?.newReviewUri || null },
    });
  } catch (error: any) {
    console.error('Audit error:', error);
    return NextResponse.json({ error: error.message || 'Audit failed' }, { status: 500 });
  }
}
