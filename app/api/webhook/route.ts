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
        await supabaseAdmin.from('users').update({ subscription_status: 'active', stripe_subscription_id: session.subscription, updated_at: new Date().toISOString() }).eq('id', userId);
        const rc = session.metadata?.referral_code;
        if (rc) {
          const { data: referrer } = await supabaseAdmin.from('users').select('id').eq('referral_code', rc).single();
          if (referrer) await supabaseAdmin.from('referrals').insert({ referrer_id: referrer.id, referred_id: userId, referral_code: rc, status: 'completed' });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { data: u } = await supabaseAdmin.from('users').select('id').eq('stripe_subscription_id', sub.id).single();
        if (u) {
          const s = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'cancelled';
          await supabaseAdmin.from('users').update({ subscription_status: s, updated_at: new Date().toISOString() }).eq('id', u.id);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        await supabaseAdmin.from('users').update({ subscription_status: 'cancelled', updated_at: new Date().toISOString() }).eq('stripe_subscription_id', event.data.object.id);
        break;
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Webhook failed' }, { status: 400 });
  }
}
