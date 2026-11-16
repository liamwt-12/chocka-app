import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cancelSubscription } from '@/lib/stripe';
import { getSessionUserId, clearSessionCookies } from '@/lib/session';
import { deletePhotoFilesForShops } from '@/lib/shop-photos';

// PATCH — update user settings
export async function PATCH(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await request.json();

    // Only allow specific fields to be updated
    const allowedFields = ['auto_post_enabled', 'auto_reply_enabled', 'sms_enabled'];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    for (const field of allowedFields) {
      if (field in body) {
        // Every field on this list is a flag. Coerce rather than trust, so a
        // string "false" cannot arrive and read as true.
        updates[field] = Boolean(body[field]);
      }
    }

    // phone_number is here so a free tenant has somewhere to save it that is not
    // /api/checkout. On a paid tenant the phone is written by the checkout route
    // on the way to Stripe; a Stellar retailer never goes to Stripe, and without
    // this they would reach the end of onboarding with no number stored and no
    // Monday stats text.
    //
    // Validated, unlike the flags above: this is the first free-text field on the
    // allowlist, and an allowlist that waves strings through is not an allowlist.
    // Same UK-mobile rule the onboarding form applies client-side — the client
    // check is for the retailer's benefit, this one is the actual constraint.
    if ('phone_number' in body) {
      const raw = typeof body.phone_number === 'string' ? body.phone_number.replace(/\s/g, '') : '';
      // A mobile number is optional. An empty value removes it, and with it
      // every text we would otherwise send.
      if (raw === '') {
        updates.phone_number = null;
      } else {
        if (!/^(\+44|0)7\d{9}$/.test(raw)) {
          return NextResponse.json({ error: 'Not a valid UK mobile number' }, { status: 400 });
        }
        updates.phone_number = raw;
      }
    }

    const { error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Settings update error:', err);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}

// DELETE — delete account and all data
export async function DELETE(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Get user for Stripe cancellation
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('stripe_subscription_id')
      .eq('id', userId)
      .single();

    // Cancel Stripe subscription
    if (user?.stripe_subscription_id) {
      try {
        await cancelSubscription(user.stripe_subscription_id);
      } catch (err) {
        console.error('Stripe cancellation failed:', err);
        // Continue with deletion anyway
      }
    }

    // The shop's photos go with the account. The shop's record itself outlives
    // the account by design (retailers.user_id is `on delete set null`), so
    // nothing would otherwise remove photos the shop uploaded: both the files
    // and their records are deleted here. Done BEFORE the user row goes, while
    // the link from account to shop still exists.
    //
    // A failure does not stop the account being deleted: someone asking to
    // leave must be able to leave. It is logged loudly, the photo records stay
    // (so the files can still be found and removed by a rep), and the retention
    // job removes them with the shop record later.
    try {
      const { data: shops, error: shopsError } = await supabaseAdmin.from('retailers').select('id').eq('user_id', userId);
      if (shopsError) console.error(`[account/delete] COULD NOT LOOK UP THE SHOP for user ${userId}, so its photos and upload link were NOT cleared: ${shopsError.message}. Clear them by hand in /admin/pilot.`);
      const shopIds = (shops || []).map((s: any) => s.id);
      if (shopIds.length) {
        // The upload link first, so nothing new can arrive while the files are being removed.
        await supabaseAdmin.from('retailers').update({ photo_link_hash: null, photo_link_expires_at: null }).in('id', shopIds);
        const photos = await deletePhotoFilesForShops(supabaseAdmin, supabaseAdmin.storage, shopIds, { alsoDeleteRecords: true });
        for (const f of photos.failed) console.error(`[account/delete] PHOTOS NOT FULLY DELETED for shop ${f.id} (user ${userId}): ${f.reason}. Remove them by hand in /admin/pilot.`);
        if (photos.filesRemoved) console.log(`[account/delete] removed ${photos.filesRemoved} photo file(s) for user ${userId}`);
      }
    } catch (err) {
      console.error(`[account/delete] photo cleanup failed for user ${userId}:`, err);
    }

    // Delete user — cascades to profiles, reviews, posts, etc. via FK constraints
    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    // Clear session cookie
    const response = NextResponse.json({ success: true });
    clearSessionCookies(response);
    return response;
  } catch (err) {
    console.error('Account deletion error:', err);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
