import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { data: user } = await supabaseAdmin.from('users').select('referral_code').eq('id', userId).single();
    const { count } = await supabaseAdmin.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', userId).eq('status', 'completed');
    return NextResponse.json({ referral_code: user?.referral_code, count: count || 0 });
  } catch (err) {
    console.error('Referral error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
