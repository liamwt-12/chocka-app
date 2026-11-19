import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { verifyAdminAuth, PILOT_TENANT_SLUG } from '@/lib/pilot';
import { sendEmail } from '@/lib/email';
import { supabaseStore, loadRequestShop } from '@/lib/review-requests-data';
import { handleReviewRequestAction } from '@/lib/review-requests-admin';

/**
 * Review requests for /admin/pilot, behind ADMIN_PASSWORD like /api/admin/pilot.
 * lib/review-requests.ts explains the feature; lib/review-requests-admin.ts the
 * two actions. Kept out of the pilot route on purpose: that route sends nothing,
 * ever, and its tests hold it to that.
 *
 * POST { action: 'suppress', email }                          adds it to the do-not-email list; works with the switch off; answers "Done" either way
 * POST { action: 'dry_run', retailerId, csv }                 sends nothing, writes nothing
 * POST { action: 'send', retailerId, csv, confirmCount }      only with REVIEW_REQUESTS=on and the count typed back
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!process.env.ADMIN_PASSWORD) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  if (!verifyAdminAuth(request.headers.get('authorization'), process.env.ADMIN_PASSWORD)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }

  const { data: tenantRow, error: tenantErr } = await supabaseAdmin.from('tenants').select('id').eq('slug', PILOT_TENANT_SLUG).single();
  if (tenantErr || !tenantRow) return NextResponse.json({ error: 'Stellar tenant not found' }, { status: 500 });

  try {
    const out = await handleReviewRequestAction(body, {
      tenant: getTenantBySlug(PILOT_TENANT_SLUG),
      // Only this tenant's shops, whatever id was posted.
      loadShop: (id) => loadRequestShop(supabaseAdmin, tenantRow.id, id),
      store: supabaseStore(supabaseAdmin),
      deps: { send: (e) => sendEmail(e) },
      env: process.env,
    });
    return NextResponse.json(out.body, { status: out.status });
  } catch (err: any) {
    // The message never carries an address: the store's errors name the table and the migration only.
    console.error('[admin/review-requests]', err?.message || err);
    return NextResponse.json({ error: String(err?.message || 'Failed').slice(0, 300) }, { status: 500 });
  }
}
