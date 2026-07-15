import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getGoogleUpdated, getAttributes, getMedia, getReviews, getLocalPosts } from '@/lib/google';
import { scoreProfile, predictedScore } from '@/lib/audit';

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) { console.error('Audit: no userId cookie'); return NextResponse.json({ error: 'Not authenticated', code: 'not_authenticated' }, { status: 401 }); }

    const { data: userData } = await supaAdmin.from('users').select('id, google_refresh_token').eq('id', userId).single();
    if (!userData?.google_refresh_token) { console.error('Audit: no refresh token for user', userId); return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 }); }

    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) { console.error('Audit: no profile for user', userId); return NextResponse.json({ error: 'No profile found', code: 'no_profile' }, { status: 400 }); }

    const accessToken = await refreshAccessToken(userData.google_refresh_token);
    const locName = profile.google_location_name;
    const acctId = profile.google_account_id;

    // The full-location read is the one call that must succeed — a manager
    // without rights on this listing gets a 403 here. Map it to an honest code
    // (the picker offers "choose a different listing") instead of a 500 crash.
    let location: any;
    try {
      location = await getLocationFull(accessToken, locName);
    } catch (e: any) {
      if (e?.status === 403 || e?.googleStatus === 'PERMISSION_DENIED') {
        console.error('Audit: no permission on listing', locName);
        return NextResponse.json({ error: 'You don’t have permission to manage this listing on Google.', code: 'listing_access_denied' }, { status: 403 });
      }
      if (e?.status === 404 || e?.googleStatus === 'NOT_FOUND') {
        console.error('Audit: listing not found', locName);
        return NextResponse.json({ error: 'This listing no longer exists on Google.', code: 'listing_not_found' }, { status: 404 });
      }
      throw e;
    }

    // The rest are best-effort — a failure just lowers the score, never crashes.
    const [googleUpdated, attributes, media, reviews, posts] = await Promise.all([
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
    const code = String(error?.message).includes('invalid_grant') ? 'google_disconnected' : 'unknown';
    return NextResponse.json({ error: error.message || 'Audit failed', code }, { status: 500 });
  }
}
