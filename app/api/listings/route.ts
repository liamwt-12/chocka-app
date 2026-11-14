import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getManageableListings } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';
import { SHOP_MESSAGES } from '@/lib/ownership';

// Feed for the onboarding / settings listing picker. Re-enumerates live on
// every call (no stored candidate list) and returns only what the picker
// renders — never tokens or internal ids beyond the account/location names the
// select endpoint needs to re-validate the choice.
export async function GET(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated', code: 'not_authenticated' }, { status: 401 });
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`)
      .eq('id', userId)
      .single();
    // A managed retailer (Route 1) legitimately has no token of their own — the
    // credential belongs to the operator account managing their listing — so the
    // question is "is there access", not "is there a token on this row".
    const access = resolveAccess(user);
    if (!access.ok) {
      console.warn('[listings] no Google access for user', user?.id, '—', access.reason);
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }

    const accessToken = await refreshAccessToken(
      decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)),
    );
    const listings = await getManageableListings(accessToken);

    // Ownership detection: if this user is an invited shop, say which listing we
    // expected, put it first, and mark it, so the picker can say "is it this one?".
    const { data: retailer } = await supabaseAdmin
      .from('retailers').select('name, town, place_id').eq('user_id', userId).maybeSingle();
    const expectedPlaceId = retailer?.place_id ?? null;

    const items = listings
      .map((l) => ({
        matchesExpected: !!expectedPlaceId && l.placeId === expectedPlaceId,
        waitingOnGoogle: l.hasVoiceOfMerchant === false,
        accountName: l.accountName,
        locationName: l.locationName,
        title: l.title,
        address: l.address,
        accountDisplay: l.accountDisplay,
        accountType: l.accountType,
      }))
      .sort((a, b) => Number(b.matchesExpected) - Number(a.matchesExpected) || a.title.localeCompare(b.title));

    const anyMatch = items.some((i) => i.matchesExpected);
    return NextResponse.json({
      listings: items,
      expected: retailer ? { name: retailer.name, town: retailer.town } : null,
      // Shown above the picker when we expected a shop and cannot see it here.
      help: retailer && expectedPlaceId && !anyMatch ? SHOP_MESSAGES.check_listing : null,
    });
  } catch (error: any) {
    console.error('Listings fetch error:', error);
    const code =
      error?.googleStatus === 'PERMISSION_DENIED' ? 'listing_access_denied'
      : String(error?.message).includes('invalid_grant') ? 'google_disconnected'
      : 'unknown';
    return NextResponse.json({ error: error.message || 'Failed to load listings', code }, { status: 500 });
  }
}
