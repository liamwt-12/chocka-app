import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/session';
import { parseVoiceProfile, readStoredVoice, isEmptyVoice, EMPTY_VOICE } from '@/lib/voice';

/**
 * A shop's own voice profile (lib/voice.ts): the few short questions asked at
 * onboarding. The signed-in user can only ever read or write the shop linked to
 * their own account; the shop is found from the session, never from the request.
 *
 * GET   { available, voice }   available is false when no shop is linked to this account
 * POST  { voice }              validates, then saves. An empty profile clears it.
 */
export const dynamic = 'force-dynamic';

async function shopFor(userId: string) {
  const { data } = await supabaseAdmin.from('retailers').select('id, voice_profile').eq('user_id', userId).limit(1);
  return data?.[0] ?? null;
}

export async function GET(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const shop = await shopFor(userId);
    return NextResponse.json({ available: !!shop, voice: (shop && readStoredVoice(shop.voice_profile)) || EMPTY_VOICE });
  } catch (err) {
    console.error('[voice] read failed:', err);
    // Not being able to read it is not a reason to stop onboarding.
    return NextResponse.json({ available: false, voice: EMPTY_VOICE });
  }
}

export async function POST(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }

  const parsed = parseVoiceProfile(body?.voice);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const shop = await shopFor(userId);
    if (!shop) return NextResponse.json({ error: 'No shop is linked to this account' }, { status: 404 });
    const { error } = await supabaseAdmin
      .from('retailers')
      .update({
        voice_profile: isEmptyVoice(parsed.value) ? null : parsed.value,
        voice_updated_at: new Date().toISOString(),
        voice_updated_by: 'shop',
      })
      .eq('id', shop.id);
    if (error) throw error;
    return NextResponse.json({ saved: true, voice: parsed.value });
  } catch (err) {
    console.error('[voice] save failed:', err);
    return NextResponse.json({ error: 'We could not save that. Please try again.' }, { status: 500 });
  }
}
