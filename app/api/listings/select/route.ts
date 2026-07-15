import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getManageableListings } from '@/lib/google';

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
      .select('id, google_refresh_token')
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
    const accessToken = await refreshAccessToken(user.google_refresh_token);
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
      audit_score: null,
      audit_score_after: null,
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
