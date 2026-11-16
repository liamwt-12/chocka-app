import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFields, isDeadGrant } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';
import { fromGooglePeriods, fromGoogleSpecialPeriods } from '@/lib/opening-hours';
import { upcomingBankHolidays } from '@/lib/bank-holidays';

/**
 * What Google holds now for the things a shop can change from Settings: its
 * opening hours, its holiday hours and its website. Read fresh each time, so
 * the editor always starts from the truth, including changes the shop made in
 * Google itself. Reads only.
 */
export async function GET(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { data: user } = await supabaseAdmin.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', userId).single();
    const access = resolveAccess(user);
    if (!access.ok) return NextResponse.json({ available: false, why: 'We have lost the connection to your Google account. Reconnect above, then your hours will show here.' });
    const { data: profile } = await supabaseAdmin.from('profiles').select('google_location_name').eq('user_id', userId).maybeSingle();
    if (!profile?.google_location_name) return NextResponse.json({ available: false, why: 'No listing is connected yet.' });

    let token: string;
    try { token = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId))); }
    catch (e) { return NextResponse.json({ available: false, why: isDeadGrant(e) ? 'We have lost the connection to your Google account. Reconnect above, then your hours will show here.' : 'Google did not answer just now. Try again in a minute.' }); }

    const loc = await getLocationFields(token, profile.google_location_name, ['regularHours', 'specialHours', 'websiteUri']);
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      available: true,
      hours: fromGooglePeriods(loc?.regularHours?.periods),
      holidays: fromGoogleSpecialPeriods(loc?.specialHours?.specialHourPeriods, today),
      website: loc?.websiteUri || '',
      today,
      // Offered as one-tap additions in the holiday editor.
      bankHolidays: upcomingBankHolidays(today, 120),
    });
  } catch (e: any) {
    console.error('[listing]', String(e?.message).slice(0, 200));
    return NextResponse.json({ available: false, why: 'We could not read your listing from Google just now. Try again in a minute.' });
  }
}
