import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateCancelHash, linkHashMatches } from '@/lib/cron';
import { getTenantBySlug, getTenantForRow } from '@/lib/tenant';
import { resultPage, confirmPage } from '@/lib/result-page';

/**
 * GET only shows a confirmation page. Email security scanners open every link in
 * a message, so acting on GET meant a scanner could cancel a retailer's post. The
 * button on that page POSTs back here, to the same URL, and POST does the work.
 */
export async function GET(request: NextRequest) {
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const url = new URL(request.url);
  const postId = url.searchParams.get('id');
  const hash = url.searchParams.get('hash');
  if (!postId || !hash || !linkHashMatches(hash, generateCancelHash(postId))) {
    return new NextResponse(resultPage(tenant, 'Invalid link', 'This cancel link has expired or is invalid.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }
  return new NextResponse(
    confirmPage(tenant, 'Cancel this post?', 'Nothing will be published this week if you cancel.', 'Yes, cancel this post', `${url.pathname}${url.search}`),
    { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // The brand for every page this route renders. Read from the Host (via the
  // header middleware sets) rather than from the user row, because THREE of the
  // five exits below — missing params, bad hash, post not found — render before
  // any user has been loaded. A per-user resolution would brand two of the five
  // screens correctly and leave the rest Chocka, which is worse than either
  // answer applied consistently.
  //
  // Host is not a compromise here: the cancel link is built by post-generator
  // from `getTenantForRow(user).appUrl`, so the origin a retailer lands on IS
  // their own tenant's. The two resolutions agree by construction, and this one
  // additionally works before the row is in hand.
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));

  const postId = searchParams.get('id');
  const hash = searchParams.get('hash');

  if (!postId || !hash) {
    return new NextResponse(resultPage(tenant, 'Invalid link', 'This cancel link is missing some information.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Verify hash
  const expectedHash = generateCancelHash(postId);
  if (!linkHashMatches(hash, expectedHash)) {
    return new NextResponse(resultPage(tenant, 'Invalid link', 'This cancel link has expired or is invalid.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Check post exists and is cancellable
  const { data: post } = await supabaseAdmin
    .from('scheduled_posts')
    .select('*, profiles!inner(user_id, users:user_id(phone_number, sms_enabled, tenants ( slug )))')
    .eq('id', postId)
    .single();

  if (!post) {
    return new NextResponse(resultPage(tenant, 'Post not found', 'This post may have already been published or cancelled.'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (post.status !== 'pending_approval') {
    return new NextResponse(resultPage(tenant, 'Already handled', `This post has already been ${post.status}.`), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Cancel the post: only if it is still waiting, and only say so if the write
  // happened. Before, a failed write, or the publisher getting there first,
  // still produced "Post cancelled".
  const { data: cancelled, error: cancelError } = await supabaseAdmin
    .from('scheduled_posts')
    .update({ status: 'cancelled' })
    .eq('id', postId)
    .eq('status', 'pending_approval')
    .select('id');
  if (cancelError) {
    console.error('[posts/cancel] update failed:', cancelError.message);
    return new NextResponse(resultPage(tenant, 'Something went wrong', 'We could not cancel that post. Please try the link again in a minute.'), { headers: { 'Content-Type': 'text/html' } });
  }
  if (!cancelled?.length) {
    return new NextResponse(resultPage(tenant, 'Already handled', 'This post has already been published or cancelled.'), { headers: { 'Content-Type': 'text/html' } });
  }

  // SMS confirmation
  const user = post.profiles?.users;
  if (user?.sms_enabled && user?.phone_number) {
    const { sendSMS, logSMS } = await import('@/lib/twilio');
    // Resolved from the user row rather than the Host, so the brand is right
    // even if the link is opened on the other tenant's domain.
    //
    // Deliberately a different resolution from the page above, not an oversight.
    // A text message is a durable thing sent TO the account holder, so it takes
    // the account's brand; the page is transient chrome for whoever is looking
    // at this URL right now, and it has to render on paths where no account is
    // known. The two only diverge if a link is opened on the wrong host, and in
    // that case each is still right about its own audience.
    const smsBody = `Post cancelled — nothing will be published this week. We'll try again next Sunday. - ${getTenantForRow(user).brandName}`;
    const sid = await sendSMS({ to: user.phone_number, body: smsBody });
    await logSMS(supabaseAdmin, post.profiles.user_id, user.phone_number, 'post_cancelled', smsBody, sid);
  }

  return new NextResponse(resultPage(tenant, 'Post cancelled', 'Nothing will be published this week. We\'ll write a new one next Sunday.'), {
    headers: { 'Content-Type': 'text/html' },
  });
}
