import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer, createCheckoutSession, getPriceId } from '@/lib/stripe';
import { getTenant, getTenantForRow } from '@/lib/tenant';

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { phone, plan, referralCode } = await request.json();

    // Load the user BEFORE writing anything, so the entitlement gate below runs
    // before any side effect. The tenant embed makes this route tenant-aware.
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*, tenants ( slug )')
      .eq('id', userId)
      .single();

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // A free tenant has no per-retailer billing AT ALL. Stellar Local is funded
    // by Tarkett, invoiced monthly against active user counts and reconciled by
    // hand — there is no subscription per retailer, so there is nothing for
    // Stripe to do and no correct outcome for this route.
    //
    // Refusing here rather than only hiding the button, because the button is a
    // sign and this is the lock. Reached today from onboarding's "Nearly there"
    // screen, which every retailer passes through.
    //
    // Resolved from users.tenant_id, NOT the request Host: which brand a person
    // belongs to is a property of their account, and a Stellar retailer opening
    // the Chocka host must not thereby become billable.
    //
    // What this prevented: a real Stripe customer created and persisted against
    // their row (that happened even when session creation later failed), and a
    // checkout page quoting Chocka's monthly price to a retailer who was told
    // the service is free.
    const tenant = getTenantForRow(user);
    if (tenant.priceMonthlyGbp === 0) {
      console.error(
        `[checkout] REFUSED — ${tenant.brandName} has no per-retailer billing; user ${userId} must never reach Stripe`,
      );
      return NextResponse.json(
        { error: 'This account has no subscription — the service is free.', code: 'no_billing_for_tenant' },
        { status: 400 },
      );
    }

    // Update phone number. After the gate, so a refused request writes nothing.
    await supabaseAdmin
      .from('users')
      .update({ phone_number: phone, referred_by: referralCode || null, updated_at: new Date().toISOString() })
      .eq('id', userId);

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
    const appUrl = getTenant().appUrl;
    const session = await createCheckoutSession({
      customerId,
      priceId: getPriceId(plan),
      successUrl: `${appUrl}/onboarding?paid=true`,
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
