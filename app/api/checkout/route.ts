import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer, createCheckoutSession, getPriceId } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { phone, plan, referralCode } = await request.json();

    // Update phone number
    await supabaseAdmin
      .from('users')
      .update({ phone_number: phone, referred_by: referralCode || null, updated_at: new Date().toISOString() })
      .eq('id', userId);

    // Get user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Create Stripe customer if needed
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await createCustomer(user.email, user.name, {
        user_id: userId,
        referral_code: referralCode || '',
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // Create checkout session
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
    const session = await createCheckoutSession({
      customerId,
      priceId: getPriceId(plan === 'yearly' ? 'yearly' : 'monthly'),
      successUrl: `${appUrl}/dashboard?welcome=true`,
      cancelUrl: `${appUrl}/onboarding`,
      metadata: {
        user_id: userId,
        referral_code: referralCode || '',
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return NextResponse.json({ error: 'Checkout failed' }, { status: 500 });
  }
}
