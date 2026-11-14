import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generatePostActionHash, linkHashMatches } from '@/lib/cron';
import { getTenantBySlug } from '@/lib/tenant';
import { resultPage, confirmPage } from '@/lib/result-page';
import { AWAITING_APPROVAL, PUBLISHABLE } from '@/lib/safe-automation';

/**
 * Approve or skip a post that is awaiting approval (a shop's first three).
 * GET shows a confirmation page only, so email scanners that open links cannot
 * approve anything; the button POSTs back here and POST does the work.
 *
 *   approve -> status becomes pending_approval, so the publisher posts it at
 *              its scheduled time (or on its next run, if that time has passed)
 *   skip    -> status becomes cancelled
 */
function parse(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const action = url.searchParams.get('action');
  const hash = url.searchParams.get('hash');
  const ok = !!id && (action === 'approve' || action === 'skip') && linkHashMatches(hash, generatePostActionHash(id, action));
  return { url, id: id!, action: action as 'approve' | 'skip', ok };
}

const html = (body: string) => new NextResponse(body, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest) {
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const { url, action, ok } = parse(request);
  if (!ok) return html(resultPage(tenant, 'Invalid link', 'This link has expired or is invalid.'));
  return html(action === 'approve'
    ? confirmPage(tenant, 'Approve this post?', 'It will go up on your Google listing at the time in the email.', 'Yes, approve it', `${url.pathname}${url.search}`)
    : confirmPage(tenant, 'Skip this week?', 'Nothing will be posted this week.', 'Yes, skip it', `${url.pathname}${url.search}`));
}

export async function POST(request: NextRequest) {
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const { id, action, ok } = parse(request);
  if (!ok) return html(resultPage(tenant, 'Invalid link', 'This link has expired or is invalid.'));

  const update = action === 'approve'
    ? { status: PUBLISHABLE, approved_at: new Date().toISOString() }
    : { status: 'cancelled' };
  // Only a post still awaiting approval can change, so a second tap is harmless.
  const { data, error } = await supabaseAdmin
    .from('scheduled_posts')
    .update(update)
    .eq('id', id)
    .eq('status', AWAITING_APPROVAL)
    .select('id');
  if (error) {
    console.error('[posts/approve] update failed:', error.message);
    return html(resultPage(tenant, 'Something went wrong', 'Please try the link again in a minute.'));
  }
  if (!data?.length) return html(resultPage(tenant, 'Already handled', 'This post has already been approved, skipped or published.'));
  return html(action === 'approve'
    ? resultPage(tenant, 'Post approved', 'It will go up on your Google listing at the scheduled time.')
    : resultPage(tenant, 'Skipped', 'Nothing will be posted this week.'));
}
