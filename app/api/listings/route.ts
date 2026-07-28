import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getManageableListings } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';

// Feed for the onboarding / settings listing picker. Re-enumerates live on
// every call (no stored candidate list) and returns only what the picker
// renders — never tokens or internal ids beyond the account/location names the
// select endpoint needs to re-validate the choice.
export async function GET(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated', code: 'not_authenticated' }, { status: 401 });
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, google_refresh_token')
      .eq('id', userId)
      .single();
    if (!user?.google_refresh_token) {
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }

    const accessToken = await refreshAccessToken(
      decryptSecret(user.google_refresh_token, userTokenAad(user.id)),
    );
    const listings = await getManageableListings(accessToken);

    const items = listings
      .map((l) => ({
        accountName: l.accountName,
        locationName: l.locationName,
        title: l.title,
        address: l.address,
        accountDisplay: l.accountDisplay,
        accountType: l.accountType,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({ listings: items });
  } catch (error: any) {
    console.error('Listings fetch error:', error);
    const code =
      error?.googleStatus === 'PERMISSION_DENIED' ? 'listing_access_denied'
      : String(error?.message).includes('invalid_grant') ? 'google_disconnected'
      : 'unknown';
    return NextResponse.json({ error: error.message || 'Failed to load listings', code }, { status: 500 });
  }
}
