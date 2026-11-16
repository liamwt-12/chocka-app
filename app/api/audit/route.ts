import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getGoogleUpdated, getAttributes, getMedia, getReviews, getLocalPosts, GbpError, fetchDailyMetrics, isDeadGrant } from '@/lib/google';
import { syncDailyMetrics } from '@/lib/metrics';
import { scoreProfile, manualGaps } from '@/lib/audit';
import { fromGooglePeriods } from '@/lib/opening-hours';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';

export async function POST(request: NextRequest) {
  const userId = getSessionUserId(request);
  try {
    if (!userId) { console.error('Audit: no userId cookie'); return NextResponse.json({ error: 'Not authenticated', code: 'not_authenticated' }, { status: 401 }); }

    const { data: userData } = await supaAdmin.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', userId).single();
    // A managed retailer (Route 1) legitimately has no token of their own — the
    // credential belongs to the operator account managing their listing — so the
    // question is "is there access", not "is there a token on this row".
    const access = resolveAccess(userData);
    if (!access.ok) { console.error('Audit: no Google access for user', userId, '—', access.reason); return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 }); }

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
        decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)),
      );
    } catch (e: any) {
      console.error('Audit: token refresh failed for user', userId, String(e?.message).slice(0, 200));
      // Only a dead grant means the shop is disconnected. A "too many requests"
      // or a bad moment at Google is not: the connection is fine, so nothing is
      // recorded against it and the shop is offered a retry.
      if (!isDeadGrant(e)) {
        return NextResponse.json({ error: 'We couldn’t reach Google right now.', code: 'google_unreachable' }, { status: 502 });
      }
      // Recorded against the row the credential lives on, which for a managed
      // retailer is the operator, not this user.
      const { error: tokErr } = await supaAdmin.from('users').update({ token_status: 'invalid', token_invalid_at: new Date().toISOString() }).eq('id', access.aadUserId);
      if (tokErr) console.error('Failed to record token_status=invalid:', tokErr);
      if (access.via === 'manager') console.error(`Audit: MANAGER TOKEN FAILED (${access.aadUserId}) — affects every retailer it manages, not just ${userId}.`);
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

    // Connect-time history: the first time a listing is audited, pull Google's
    // ~18 months of daily figures so the shop has a baseline from before it
    // joined. Runs alongside the reads below, never fails the audit, and the
    // hourly metrics-sync job retries it if it does not complete here.
    const historyPull = profile.metrics_backfilled_at
      ? Promise.resolve(null)
      : syncDailyMetrics(supaAdmin, profile, (from, to) => fetchDailyMetrics(accessToken, locName, from, to))
          .catch((e: any) => { console.warn('Audit: history pull failed, metrics-sync will retry:', String(e?.message).slice(0, 200)); return null; });

    // The rest are best-effort — a failure just lowers the score, never crashes.
    const [googleUpdated, attributes, media, reviews, posts] = await Promise.all([
      getGoogleUpdated(accessToken, locName).catch(() => null),
      getAttributes(accessToken, locName).catch(() => ({ attributes: [] })),
      getMedia(accessToken, locName, acctId).catch(() => ({ mediaItems: [] })),
      getReviews(accessToken, locName, acctId).catch(() => ({ reviews: [] })),
      getLocalPosts(accessToken, locName, acctId).catch(() => ({ localPosts: [] })),
    ]);

    await historyPull;
    const audit = scoreProfile({ location, attributes, media, reviews, posts, googleUpdated });
    const city = location.storefrontAddress?.locality || '';
    const primaryCat = location.categories?.primaryCategory?.displayName || profile.category || '';

    // The hours Google holds now, laid out as an editable week. There is no
    // default: an empty week stays empty until the shop fills it in, and
    // nothing is written unless the shop confirms it (lib/opening-hours.ts).
    const hours = fromGooglePeriods(location.regularHours?.periods);

    // THE SCORE AT ACTIVATION IS WRITTEN ONCE. It is what every later "up N
    // points" is measured against, so it must be the listing as we found it.
    // It used to be overwritten on every look, so checking the listing again
    // after our own fixes replaced the baseline with the improved number.
    // `audit_score_after` is the latest MEASURED score, never a prediction.
    // (Choosing a different listing clears both: app/api/listings/select.)
    const scores: Record<string, number> = { audit_score_after: audit.score };
    if (profile.audit_score === null || profile.audit_score === undefined) scores.audit_score = audit.score;
    const { error: updateErr } = await supaAdmin.from('profiles').update(scores).eq('id', profile.id);
    if (updateErr) console.error('Failed to save audit scores:', updateErr);

    return NextResponse.json({
      audit,
      scoreAtActivation: scores.audit_score ?? profile.audit_score,
      // What the score counts that we do not fix, and how the shop can.
      manual: manualGaps(audit),
      hours,
      locationData: { title: location.title, address: location.storefrontAddress, primaryCategory: primaryCat, city, mapsUri: location.metadata?.mapsUri || null, newReviewUri: location.metadata?.newReviewUri || null },
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
    if (msg.includes('Token refresh failed') && !isDeadGrant(error)) {
      return NextResponse.json({ error: 'We couldn’t reach Google right now.', code: 'google_unreachable' }, { status: 502 });
    }
    if (isDeadGrant(error)) {
      if (userId) { await supaAdmin.from('users').update({ token_status: 'invalid', token_invalid_at: new Date().toISOString() }).eq('id', userId).then(({ error: e }) => { if (e) console.error('Failed to record token_status=invalid:', e); }); }
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || 'Audit failed', code: 'unknown' }, { status: 500 });
  }
}
