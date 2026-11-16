import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/session';
import { SHOP_MESSAGES } from '@/lib/ownership';
import { signInviteRef } from '@/lib/invite-token';
import { helpPath } from '@/lib/connect-help';

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

    // "Not my shop": a way back to Google with a different account, keeping the invite.
    let wrongAccountPath: string | null = null;
    if (retailer) {
      const { data: inv } = await supabaseAdmin.from('retailer_invites').select('id').eq('retailer_id', retailer.id).order('created_at', { ascending: false }).limit(1);
      if (inv?.[0]?.id) { try { wrongAccountPath = helpPath('wrong_account', signInviteRef(inv[0].id)); } catch { /* no shortcut */ } }
    }
    const st = retailer?.connection_status;
    const note = st === 'waiting_google' || (st === 'check_listing' && !retailer?.listing_confirmed_at)
      ? { status: st, ...SHOP_MESSAGES[st as 'waiting_google' | 'check_listing'] } : null;

    return NextResponse.json({
      connected: true,
      shop: { name: profile.business_name, address: profile.address },
      note,
      wrongAccountPath,
      choices: { posts: !!user?.auto_post_enabled, replies: !!user?.auto_reply_enabled, hasMobile: !!user?.phone_number },
    });
  } catch (e: any) {
    console.error('[connected]', String(e?.message).slice(0, 200));
    return NextResponse.json({ error: 'Could not load' }, { status: 500 });
  }
}
