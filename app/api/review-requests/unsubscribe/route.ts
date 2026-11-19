import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { resultPage, confirmPage } from '@/lib/result-page';
import { verifyUnsubscribeToken } from '@/lib/review-requests';
import { suppress } from '@/lib/review-requests-data';

/**
 * The unsubscribe link in every review request (lib/review-requests.ts).
 *
 * GET shows a page with one button and changes nothing: email security
 * scanners open every link in a message, and must not unsubscribe anyone.
 * POST does it. A mail client's own one-click unsubscribe (RFC 8058) POSTs to
 * this same address with "List-Unsubscribe=One-Click" in the body, and is
 * handled the same way.
 *
 * Unsubscribing puts the address's hash on the platform-wide list: no shop
 * that uses the service can send it a review request again. Works whether or
 * not REVIEW_REQUESTS is on: an unsubscribe must always work.
 */
export const dynamic = 'force-dynamic';

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

function invalid(tenant: ReturnType<typeof getTenantBySlug>) {
  return html(resultPage(tenant, 'Link not recognised', `This unsubscribe link is not complete. To stop review requests, reply to the email, or write to ${tenant.privacyEmail}.`), 400);
}

export async function GET(request: NextRequest) {
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const url = new URL(request.url);
  if (!verifyUnsubscribeToken(url.searchParams.get('t'))) return invalid(tenant);
  return html(confirmPage(tenant, 'Stop review requests?', `You will not be sent another request to review a shop by any shop that uses ${tenant.brandName}.`, 'Yes, stop them', `${url.pathname}${url.search}`));
}

export async function POST(request: NextRequest) {
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const hash = verifyUnsubscribeToken(new URL(request.url).searchParams.get('t'));
  if (!hash) return invalid(tenant);
  if (!(await suppress(supabaseAdmin, hash))) {
    return html(resultPage(tenant, 'Something went wrong', `We could not record that just now. Please try the link again in a minute, or write to ${tenant.privacyEmail}.`), 500);
  }
  console.log('[review-requests] an address unsubscribed');
  return html(resultPage(tenant, 'Done', `You will not be sent any more review requests through ${tenant.brandName}.`));
}
