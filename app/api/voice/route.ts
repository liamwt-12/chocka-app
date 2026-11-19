import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/session';
import { parseVoiceProfile, readStoredVoice, isEmptyVoice, EMPTY_VOICE } from '@/lib/voice';

/**
 * A shop's own voice profile (lib/voice.ts): the few short questions asked at
 * onboarding, and the "How your posts sound" card in Settings. The signed-in
 * user can only ever read or write the shop linked to their own account; the
 * shop is found from the session, never from the request (any id in the body is
 * ignored). retailers.user_id is unique, so there is at most one such shop.
 *
 * WHO CAN USE IT
 *  - A shop with a retailers row (Stellar): reads and writes its own row. A
 *    change is recorded as voice_updated_by = 'shop', whether the shop connected
 *    Google itself or was activated by a rep (Route 1): the person typing is the
 *    shop either way.
 *  - A Chocka account, or the Stellar operator account that manages Route 1
 *    listings: no retailers row of its own, so GET says available: false and
 *    POST is refused. Managing a shop's Google listing does not make its voice
 *    editable from here; a rep changes it in /admin/pilot, recorded as 'rep'.
 *
 * GET   { available, voice, updatedAt, updatedBy }   available is false when no shop is linked to this account
 * POST  { voice }              validates, then saves. An empty profile clears it.
 */
export const dynamic = 'force-dynamic';

async function shopFor(userId: string) {
  const { data } = await supabaseAdmin.from('retailers').select('id, voice_profile, voice_updated_at, voice_updated_by').eq('user_id', userId).limit(1);
  return data?.[0] ?? null;
}

export async function GET(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const shop = await shopFor(userId);
    return NextResponse.json({
      available: !!shop,
      voice: (shop && readStoredVoice(shop.voice_profile)) || EMPTY_VOICE,
      updatedAt: shop?.voice_updated_at ?? null,
      updatedBy: shop?.voice_updated_by ?? null,
    });
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
    // From the session only. A retailerId (or anything else) in the body is never read.
    const shop = await shopFor(userId);
    if (!shop) return NextResponse.json({ error: 'No shop is linked to this account' }, { status: 404 });
    const updatedAt = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('retailers')
      .update({
        voice_profile: isEmptyVoice(parsed.value) ? null : parsed.value,
        voice_updated_at: updatedAt,
        voice_updated_by: 'shop',
      })
      .eq('id', shop.id);
    if (error) throw error;
    return NextResponse.json({ saved: true, voice: parsed.value, updatedAt, updatedBy: 'shop' });
  } catch (err) {
    console.error('[voice] save failed:', err);
    return NextResponse.json({ error: 'We could not save that. Please try again.' }, { status: 500 });
  }
}
