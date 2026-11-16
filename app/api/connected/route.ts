import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/session';
import { SHOP_MESSAGES } from '@/lib/ownership';

/**
 * What the "you're connected" page shows: which shop, and anything the shop
 * should know about it. Reads our own records only; it does not call Google,
 * so the page appears at once.
 */
export async function GET(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const [{ data: user }, { data: profile }, { data: retailer }] = await Promise.all([
      supabaseAdmin.from('users').select('auto_post_enabled, auto_reply_enabled, phone_number').eq('id', userId).single(),
      supabaseAdmin.from('profiles').select('business_name, address, google_location_name').eq('user_id', userId).maybeSingle(),
      supabaseAdmin.from('retailers').select('id, name, connection_status, listing_confirmed_at').eq('user_id', userId).maybeSingle(),
    ]);
    if (!profile?.google_location_name) return NextResponse.json({ connected: false });

    // "This is not my shop": an invited shop can start again with a different Google account.
    const canStartAgain = !!retailer;
    const st = retailer?.connection_status;
    const note = st === 'waiting_google' || (st === 'check_listing' && !retailer?.listing_confirmed_at)
      ? { status: st, ...SHOP_MESSAGES[st as 'waiting_google' | 'check_listing'] } : null;

    return NextResponse.json({
      connected: true,
      shop: { name: profile.business_name, address: profile.address },
      note,
      canStartAgain,
      choices: { posts: !!user?.auto_post_enabled, replies: !!user?.auto_reply_enabled, hasMobile: !!user?.phone_number },
    });
  } catch (e: any) {
    console.error('[connected]', String(e?.message).slice(0, 200));
    return NextResponse.json({ error: 'Could not load' }, { status: 500 });
  }
}
