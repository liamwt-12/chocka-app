import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET — get referral stats for a user
export async function GET(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('referral_code')
      .eq('id', userId)
      .single();

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const { count } = await supabaseAdmin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', userId)
      .eq('status', 'completed');

    return NextResponse.json({
      referral_code: user.referral_code,
      referral_count: count || 0,
    });
  } catch (err) {
    console.error('Referral stats error:', err);
    return NextResponse.json({ error: 'Failed to get referral stats' }, { status: 500 });
  }
}

// POST — record a referral (called from webhook after checkout)
export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: authUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
    if (!authUser) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { referrer_code, referred_id, referred_name } = await request.json();

    if (!referrer_code || !referred_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Find the referrer
    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('referral_code', referrer_code)
      .single();

    if (!referrer) {
      return NextResponse.json({ error: 'Invalid referral code' }, { status: 400 });
    }

    // Create referral record
    await supabaseAdmin.from('referrals').insert({
      referrer_id: referrer.id,
      referred_id,
      referred_name: referred_name || null,
      referral_code: referrer_code,
      status: 'completed',
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Referral creation error:', err);
    return NextResponse.json({ error: 'Failed to record referral' }, { status: 500 });
  }
}
