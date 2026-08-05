import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getManageableListings } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';

// Bind (or re-bind) the user's single profile to a listing they chose.
// Reached from the onboarding picker and the settings "change listing" path.
// The chosen ids are NEVER trusted — we re-enumerate the user's manageable
// listings live and confirm the pair is genuinely in that set before writing.
export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated', code: 'not_authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const accountName = typeof body.accountName === 'string' ? body.accountName : '';
    const locationName = typeof body.locationName === 'string' ? body.locationName : '';
    if (!accountName || !locationName) {
      return NextResponse.json({ error: 'Missing accountName or locationName', code: 'bad_request' }, { status: 400 });
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, google_refresh_token, tenant_id')
      .eq('id', userId)
      .single();
    if (!user?.google_refresh_token) {
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }

    // ── Server-side re-validation ──
    // Re-fetch the manageable set live and require an exact match on BOTH ids.
    // getManageableListings only returns role-manageable listings, so
    // membership here is proof the user can manage this exact pairing — a
    // hand-crafted POST cannot bind an account/location the user doesn't hold.
    const accessToken = await refreshAccessToken(
      decryptSecret(user.google_refresh_token, userTokenAad(user.id)),
    );
    const listings = await getManageableListings(accessToken);
    const chosen = listings.find(
      (l) => l.accountName === accountName && l.locationName === locationName
    );
    if (!chosen) {
      return NextResponse.json(
        { error: 'That listing is not one you can manage', code: 'listing_access_denied' },
        { status: 403 }
      );
    }

    // Denormalised fields come from the re-validated candidate, not the request
    // body. Clear any stale audit scores so the fresh audit repopulates for the
    // newly-bound listing (matters for the "change listing" re-pick path).
    const profileFields = {
      google_account_id: chosen.accountName,
      google_location_name: chosen.locationName,
      business_name: chosen.title,
      category: chosen.category,
      address: chosen.address,
      latitude: chosen.latitude,
      longitude: chosen.longitude,
      // The other half of the bind-time capture — see the callback's
      // bindManageableListing. Both insert sites must set this or they drift,
      // and a re-pick has to overwrite it: the whole point of re-picking is
      // that the previous listing was the wrong business.
      google_place_id: chosen.placeId ?? null,
      audit_score: null,
      audit_score_after: null,

      // The profile's tenant is its owner's tenant — read from the user row, not
      // from this request's Host, for the reason spelled out on the callback's
      // bindManageableListing. Applied on the update path too: re-picking a
      // listing never changes whose account it is, so writing the owner's tenant
      // is a repair for any row the old insert left null, not a re-tag.
      //
      // Omitted entirely when the user carries no tenant, so an untagged owner
      // can never null out a profile that already has one.
      ...(user.tenant_id ? { tenant_id: user.tenant_id } : {}),
    };

    // One profile per user (unchanged 1:1 model) — update in place if it
    // already exists (re-pick / repair), otherwise create it.
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      const { error } = await supabaseAdmin.from('profiles').update(profileFields).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from('profiles').insert({ user_id: userId, ...profileFields });
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      listing: { title: chosen.title, address: chosen.address, accountDisplay: chosen.accountDisplay },
    });
  } catch (error: any) {
    console.error('Listing select error:', error);
    const code =
      error?.googleStatus === 'PERMISSION_DENIED' ? 'listing_access_denied'
      : String(error?.message).includes('invalid_grant') ? 'google_disconnected'
      : 'unknown';
    return NextResponse.json({ error: error.message || 'Selection failed', code }, { status: 500 });
  }
}
