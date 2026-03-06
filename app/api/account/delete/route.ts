import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cancelSubscription } from '@/lib/stripe';

export async function PATCH(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const body = await request.json();
    const allowed = ['auto_post_enabled', 'auto_reply_enabled', 'sms_enabled'];
    const updates: any = { updated_at: new Date().toISOString() };
    for (const f of allowed) { if (f in body) updates[f] = body[f]; }
    await supabaseAdmin.from('users').update(updates).eq('id', userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Settings update error:', err);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { data: user } = await supabaseAdmin.from('users').select('stripe_subscription_id').eq('id', userId).single();
    if (user?.stripe_subscription_id) {
      try { await cancelSubscription(user.stripe_subscription_id); } catch {} 
    }
    await supabaseAdmin.from('users').delete().eq('id', userId);
    const response = NextResponse.json({ success: true });
    response.cookies.delete('chocka_user_id');
    return response;
  } catch (err) {
    console.error('Delete error:', err);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
