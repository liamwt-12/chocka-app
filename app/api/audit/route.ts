import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getGoogleUpdated, getAttributes, getMedia, getReviews, getLocalPosts, GbpError } from '@/lib/google';
import { scoreProfile, predictedScore } from '@/lib/audit';
import { decryptSecretAllowingPlaintext, userTokenAad } from '@/lib/secrets';

export async function POST(request: NextRequest) {
  const userId = request.cookies.get('chocka_user_id')?.value;
  try {
    if (!userId) { console.error('Audit: no userId cookie'); return NextResponse.json({ error: 'Not authenticated', code: 'not_authenticated' }, { status: 401 }); }

    const { data: userData } = await supaAdmin.from('users').select('id, google_refresh_token').eq('id', userId).single();
    if (!userData?.google_refresh_token) { console.error('Audit: no refresh token for user', userId); return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 }); }

    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) { console.error('Audit: no profile for user', userId); return NextResponse.json({ error: 'No profile found', code: 'no_profile' }, { status: 400 }); }

    // The refresh is the first place a user diverges from the founder: an account
    // that connected months ago can have a revoked/expired grant. ANY failure
    // here means the stored Google authorisation is dead — record it so the
    // dashboard can prompt a reconnect, and return the honest, actionable code
    // instead of letting it fall through to a bare 500 ("Something went wrong").
    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(
        decryptSecretAllowingPlaintext(userData.google_refresh_token, userTokenAad(userData.id)),
      );
    } catch (e: any) {
      console.error('Audit: token refresh failed for user', userId, String(e?.message).slice(0, 200));
      const { error: tokErr } = await supaAdmin.from('users').update({ token_status: 'invalid', token_invalid_at: new Date().toISOString() }).eq('id', userId);
      if (tokErr) console.error('Failed to record token_status=invalid:', tokErr);
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }

    const locName = profile.google_location_name;
    const acctId = profile.google_account_id;

    // The full-location read is the one call that must succeed. Map every failure
    // to an honest code: a permission problem offers "choose a different listing",
    // a missing listing says so, and ANY other Google-side error (401/429/400/5xx)
    // becomes a retryable "couldn't reach your listing" — never an opaque crash.
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
      console.error('Audit: could not reach listing', locName, e?.status, String(e?.message).slice(0, 200));
      return NextResponse.json({ error: 'We couldn’t reach your Google listing right now.', code: 'google_unreachable' }, { status: 502 });
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
    // Categorise anything that escaped the inner handlers so the client can always
    // offer a real action. A GbpError (or a best-effort "Failed to get ..." that
    // somehow surfaced) is a reachable-but-erroring Google call → retryable. A
    // grant/refresh problem is a dead connection → reconnect. Only a genuinely
    // non-Google error stays 'unknown', and even that renders a friendly,
    // retryable screen client-side. Bare 'unknown' is never used for a
    // categorisable (Google/token) failure.
    const msg = String(error?.message);
    if (error instanceof GbpError || msg.includes('Failed to get')) {
      return NextResponse.json({ error: 'We couldn’t reach your Google listing right now.', code: 'google_unreachable' }, { status: 502 });
    }
    if (msg.includes('invalid_grant') || msg.includes('Token refresh failed')) {
      if (userId) { await supaAdmin.from('users').update({ token_status: 'invalid', token_invalid_at: new Date().toISOString() }).eq('id', userId).then(({ error: e }) => { if (e) console.error('Failed to record token_status=invalid:', e); }); }
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || 'Audit failed', code: 'unknown' }, { status: 500 });
  }
}
