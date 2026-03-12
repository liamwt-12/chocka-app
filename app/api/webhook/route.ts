import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyWebhookSignature } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');
    if (!signature) return NextResponse.json({ error: 'No signature' }, { status: 400 });

    const event = await verifyWebhookSignature(body, signature);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        if (!userId) break;

        await supabaseAdmin
          .from('users')
          .update({
            subscription_status: 'active',
            stripe_subscription_id: session.subscription,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        // Handle referral — record it and apply free month credit to referrer
        const referralCode = session.metadata?.referral_code;
        if (referralCode) {
          const { data: referrer } = await supabaseAdmin
            .from('users')
            .select('id, stripe_customer_id, email')
            .eq('referral_code', referralCode)
            .single();

          if (referrer) {
            // Record the referral
            await supabaseAdmin.from('referrals').insert({
              referrer_id: referrer.id,
              referred_id: userId,
              referral_code: referralCode,
              status: 'completed',
            });

            // Apply £29 credit to the referrer's Stripe account (one free month)
            if (referrer.stripe_customer_id) {
              try {
                const creditRes = await fetch('https://api.stripe.com/v1/customers/' + referrer.stripe_customer_id + '/balance_transactions', {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams({
                    amount: '-2900', // £29.00 in pence, negative = credit
                    currency: 'gbp',
                    description: 'Referral reward — thanks for spreading the word 👊',
                  }),
                });
                if (!creditRes.ok) {
                  console.error('Stripe credit failed:', await creditRes.text());
                }
              } catch (creditErr) {
                console.error('Stripe credit error:', creditErr);
              }
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (user) {
          const status = subscription.status === 'active' ? 'active' :
                         subscription.status === 'past_due' ? 'past_due' : 'cancelled';
          await supabaseAdmin
            .from('users')
            .update({ subscription_status: status, updated_at: new Date().toISOString() })
            .eq('id', user.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await supabaseAdmin
          .from('users')
          .update({ subscription_status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Webhook failed' }, { status: 400 });
  }
}
