import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createBillingPortalSession } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { data: user } = await supabaseAdmin.from('users').select('stripe_customer_id').eq('id', userId).single();
    if (!user?.stripe_customer_id) return NextResponse.json({ error: 'No billing account' }, { status: 400 });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
    const session = await createBillingPortalSession(user.stripe_customer_id, `${appUrl}/settings`);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
