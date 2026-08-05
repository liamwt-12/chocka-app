import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateCancelHash } from '@/lib/cron';
import { getTenantBySlug, getTenantForRow } from '@/lib/tenant';
import { resultPage } from '@/lib/result-page';

export async function GET(request: NextRequest) {
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
  if (hash !== expectedHash) {
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

  // Cancel the post
  await supabaseAdmin
    .from('scheduled_posts')
    .update({ status: 'cancelled' })
    .eq('id', postId);

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
