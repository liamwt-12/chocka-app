import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getGoogleUpdated, getAttributes, getMedia, getReviews, getLocalPosts } from '@/lib/google';
import { scoreProfile, predictedScore } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) { console.error('Audit: no userId cookie'); return NextResponse.json({ error: 'Not authenticated' }, { status: 401 }); }

    const { data: userData } = await supaAdmin.from('users').select('id, google_refresh_token').eq('id', userId).single();
    if (!userData?.google_refresh_token) { console.error('Audit: no refresh token for user', userId); return NextResponse.json({ error: 'Google not connected' }, { status: 400 }); }

    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) { console.error('Audit: no profile for user', userId); return NextResponse.json({ error: 'No profile found' }, { status: 400 }); }

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

    const defaultHours = audit.fixes.some(f => f.key === 'hours') ? {
      periods: [
        { openDay: 'MONDAY', closeDay: 'MONDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'TUESDAY', closeDay: 'TUESDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'WEDNESDAY', closeDay: 'WEDNESDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'THURSDAY', closeDay: 'THURSDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'FRIDAY', closeDay: 'FRIDAY', openTime: '08:00', closeTime: '18:00' },
        { openDay: 'SATURDAY', closeDay: 'SATURDAY', openTime: '09:00', closeTime: '13:00' },
      ],
    } : null;

    // Save scores to profile
    const { error: updateErr } = await supaAdmin.from('profiles').update({ audit_score: audit.score, audit_score_after: pred }).eq('id', profile.id);
    if (updateErr) console.error('Failed to save audit scores:', updateErr);

    return NextResponse.json({
      audit, predicted: pred,
      locationData: { title: location.title, address: location.storefrontAddress, primaryCategory: primaryCat, city, mapsUri: location.metadata?.mapsUri || null, newReviewUri: location.metadata?.newReviewUri || null },
      defaultHours,
    });
  } catch (error: any) {
    console.error('Audit error:', error);
    return NextResponse.json({ error: error.message || 'Audit failed' }, { status: 500 });
  }
}
