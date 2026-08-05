import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createBillingPortalSession } from '@/lib/stripe';
import { getTenantForRow } from '@/lib/tenant';

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, tenants ( slug )')
      .eq('id', userId)
      .single();

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Same gate as /api/checkout, for the same reason: a free tenant has no
    // per-retailer billing to manage. The Settings button is already hidden for
    // them, but a hidden button is not a closed route.
    //
    // Checked BEFORE stripe_customer_id, deliberately. Otherwise a Stellar
    // retailer who somehow acquired a customer id — which the ungated checkout
    // route would have given them — could still open a billing portal for a
    // subscription that does not exist.
    // Cast because supabase-js types a `tenants ( slug )` embed as an array while
    // PostgREST returns a single object for a many-to-one — the same mismatch
    // TenantEmbeddedRow's own doc comment calls out. The runtime shape is the
    // object; the generated type is what is wrong here.
    const tenant = getTenantForRow(user as any);
    if (tenant.priceMonthlyGbp === 0) {
      console.error(
        `[billing-portal] REFUSED — ${tenant.brandName} has no per-retailer billing; user ${userId} has nothing to manage`,
      );
      return NextResponse.json(
        { error: 'This account has no subscription — the service is free.', code: 'no_billing_for_tenant' },
        { status: 400 },
      );
    }

    if (!user.stripe_customer_id) {
      return NextResponse.json({ error: 'No billing account found' }, { status: 400 });
    }

    // The portal's return URL, from the user's own tenant — see the fuller note
    // in /api/checkout. Identical defect, same one-line fix: both routes were
    // gated together and both built their return URL from the non-request-aware
    // getTenant(). Fixing one and not the other would leave the pair
    // inconsistent for whoever reads them next.
    const appUrl = tenant.appUrl;
    const session = await createBillingPortalSession(user.stripe_customer_id, `${appUrl}/settings`);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err);
    return NextResponse.json({ error: 'Failed to open billing portal' }, { status: 500 });
  }
}
