import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { getSessionUserId, clearSessionCookies } from '@/lib/session';
import { resetConnection } from '@/lib/connection-reset';
import { signInviteRef } from '@/lib/invite-token';

/**
 * "This is not my shop" / "None of these is my shop": the signed-in shop starts
 * again with a different Google account.
 *
 * Until this existed, those links led to a page saying "your link still works"
 * when, for a shop that had already connected a listing, it did not: the second
 * sign-in was turned away as "already claimed" and the wrong listing stayed.
 *
 * POST only, from a button, by the signed-in shop, for its OWN connection. It
 * removes the account that is signed in (handing the Google permission back),
 * re-opens that shop's invitation, signs the browser out, and sends it to
 * Google with the invitation attached. Nothing on any Google listing is touched.
 * The shop's own record, and the log of anything we changed, are kept.
 */
export async function POST(request: NextRequest) {
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const baseUrl = tenant.slug === 'stellar' ? tenant.appUrl : process.env.NEXT_PUBLIC_APP_URL || request.url;
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.redirect(new URL('/login', baseUrl), 303);

  // Only a shop we invited has an invitation to go back to.
  const { data: retailer } = await supabaseAdmin.from('retailers').select('id').eq('user_id', userId).maybeSingle();
  if (!retailer) return NextResponse.redirect(new URL('/settings', baseUrl), 303);

  const result = await resetConnection(supabaseAdmin, retailer.id);
  console.log(`[connection/reset] shop ${retailer.id} started again by its own choice: ok=${result.ok}, link reusable=${result.linkReusable}`);

  let next = new URL('/login', baseUrl);
  if (result.ok && result.linkReusable) {
    const { data: inv } = await supabaseAdmin.from('retailer_invites').select('id').eq('retailer_id', retailer.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1);
    if (inv?.[0]?.id) {
      next = new URL('/api/auth/callback/google', baseUrl);
      next.searchParams.set('invite', signInviteRef(inv[0].id));
    }
  }
  const response = NextResponse.redirect(next, 303);
  clearSessionCookies(response);
  return response;
}

export async function GET() {
  return NextResponse.json({ error: 'Use the button' }, { status: 405, headers: { Allow: 'POST' } });
}
