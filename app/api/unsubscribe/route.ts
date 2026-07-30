// Perform an unsubscribe. POST only — see the note on the landing page about why a
// GET must never do this.
//
// Never fails the retailer's request for our own reasons. If the write errors we
// still tell them they are removed and shout in the logs, because the alternative is
// a person who tried to opt out, was told it did not work, and has no other route.
// An unsubscribe we failed to record is our problem to fix, not theirs to retry.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { parseUnsubscribeRef } from '@/lib/invite-token';

export async function POST(request: NextRequest) {
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const baseUrl =
    tenant.slug === 'stellar' ? tenant.appUrl : process.env.NEXT_PUBLIC_APP_URL || request.url;

  let ref: string | null = null;
  try {
    const form = await request.formData();
    const raw = form.get('ref');
    ref = typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return NextResponse.json({ error: 'Expected a form submission' }, { status: 400 });
  }

  const retailerId = ref ? parseUnsubscribeRef(ref) : null;
  if (!retailerId) {
    return NextResponse.json({ error: 'Invalid unsubscribe link' }, { status: 400 });
  }

  const { data: retailer } = await supabaseAdmin
    .from('retailers')
    .select('id,contact_email,tenant_id')
    .eq('id', retailerId)
    .maybeSingle();

  if (retailer?.contact_email) {
    const { error } = await supabaseAdmin.from('email_suppressions').insert({
      email: retailer.contact_email.toLowerCase(),
      tenant_id: retailer.tenant_id,
      reason: 'unsubscribe-link',
      source: `retailer:${retailer.id}`,
    });
    // 23505 is the unique index: already suppressed, which is success, not failure.
    if (error && error.code !== '23505') {
      console.error(
        `[unsubscribe] FAILED to record opt-out for retailer ${retailer.id}: ${error.message}. ` +
          `They were told they are removed — suppress this address by hand.`,
      );
    } else {
      console.log(`[unsubscribe] recorded for retailer ${retailer.id}`);
    }
  } else {
    console.error(`[unsubscribe] no contact_email for retailer ${retailerId}`);
  }

  // 303 so the browser turns this into a GET and a reload does not re-post.
  return NextResponse.redirect(
    new URL(`/unsubscribe/${encodeURIComponent(ref!)}?done=1`, baseUrl),
    303,
  );
}

export async function GET() {
  return NextResponse.json(
    { error: 'Use the button on the unsubscribe page' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
