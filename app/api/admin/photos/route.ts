import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { verifyAdminAuth, PILOT_TENANT_SLUG } from '@/lib/pilot';
import { refreshAccessToken } from '@/lib/google';
import { loggedAddListingPhoto } from '@/lib/change-log';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import {
  shopPhotosEnabled, listingPhotosEnabled, generatePhotoLinkToken, hashPhotoLinkToken, photoLinkExpiresAt,
  PHOTO_BUCKET, THUMBNAIL_URL_SECONDS, PUBLISH_URL_SECONDS,
} from '@/lib/shop-photos';

/**
 * Shop photos for the pilot admin page, behind ADMIN_PASSWORD like /api/admin/pilot.
 * Everything refuses unless SHOP_PHOTOS=on.
 *
 * POST { action: 'list', retailerId }          the shop's photos, with short-lived addresses to view them
 * POST { action: 'link', retailerId }          generate an upload link (replaces any earlier one); NOTHING IS SENT
 * POST { action: 'revoke_link', retailerId }   cancel the upload link
 * POST { action: 'approve', photoId }          allow a photo to be used on posts
 * POST { action: 'reject', photoId }           refuse a photo and delete its file
 * POST { action: 'to_listing', photoId }       add an approved photo to the Google listing itself.
 *                                              Refused unless SHOP_PHOTOS_TO_LISTING=on. Goes through the change log.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!process.env.ADMIN_PASSWORD) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  if (!verifyAdminAuth(request.headers.get('authorization'), process.env.ADMIN_PASSWORD)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!shopPhotosEnabled()) return NextResponse.json({ error: 'Shop photos are switched off (SHOP_PHOTOS)' }, { status: 403 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }

  const { data: tenantRow, error: tenantErr } = await supabaseAdmin.from('tenants').select('id').eq('slug', PILOT_TENANT_SLUG).single();
  if (tenantErr || !tenantRow) return NextResponse.json({ error: 'Stellar tenant not found' }, { status: 500 });
  const tenantId: string = tenantRow.id;

  // Only this tenant's shops and photos, whatever ids were posted.
  const shopById = async (id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    const { data } = await supabaseAdmin.from('retailers').select('id, name, user_id, photo_link_expires_at').eq('id', id).eq('tenant_id', tenantId).limit(1);
    return data?.[0] ?? null;
  };
  const photoById = async (id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    const { data } = await supabaseAdmin.from('shop_photos').select('id, retailer_id, status, storage_path, listing_media_name').eq('id', id).eq('tenant_id', tenantId).limit(1);
    return data?.[0] ?? null;
  };

  try {
    switch (body?.action) {
      case 'list': {
        const shop = await shopById(body.retailerId);
        if (!shop) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        const { data: photos, error } = await supabaseAdmin
          .from('shop_photos')
          .select('id, created_at, status, storage_path, width, height, bytes, use_count, last_used_at, listing_media_name')
          .eq('retailer_id', shop.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        const out = [];
        for (const p of photos || []) {
          let url: string | null = null;
          if (p.storage_path) {
            const { data: signed } = await supabaseAdmin.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path, THUMBNAIL_URL_SECONDS);
            url = signed?.signedUrl ?? null;
          }
          out.push({ id: p.id, createdAt: p.created_at, status: p.status, width: p.width, height: p.height, bytes: p.bytes, useCount: p.use_count, lastUsedAt: p.last_used_at, onListing: !!p.listing_media_name, url });
        }
        const linkActive = !!shop.photo_link_expires_at && Date.parse(shop.photo_link_expires_at) > Date.now();
        return NextResponse.json({ photos: out, linkExpiresAt: linkActive ? shop.photo_link_expires_at : null, listingEnabled: listingPhotosEnabled() });
      }

      case 'link': {
        const shop = await shopById(body.retailerId);
        if (!shop) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        const token = generatePhotoLinkToken();
        const expiresAt = photoLinkExpiresAt().toISOString();
        const { error } = await supabaseAdmin.from('retailers').update({ photo_link_hash: hashPhotoLinkToken(token), photo_link_expires_at: expiresAt }).eq('id', shop.id);
        if (error) throw error;
        // Returned once. Only the hash is stored, so it cannot be shown again.
        return NextResponse.json({ link: `${getTenantBySlug(PILOT_TENANT_SLUG).appUrl}/photos/${token}`, expiresAt });
      }

      case 'revoke_link': {
        const shop = await shopById(body.retailerId);
        if (!shop) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        const { error } = await supabaseAdmin.from('retailers').update({ photo_link_hash: null, photo_link_expires_at: null }).eq('id', shop.id);
        if (error) throw error;
        return NextResponse.json({ revoked: true });
      }

      case 'approve': {
        const photo = await photoById(body.photoId);
        if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
        if (!photo.storage_path) return NextResponse.json({ error: 'That photo has been deleted and cannot be approved' }, { status: 409 });
        const { error } = await supabaseAdmin.from('shop_photos').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', photo.id);
        if (error) throw error;
        return NextResponse.json({ approved: photo.id });
      }

      case 'reject': {
        const photo = await photoById(body.photoId);
        if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
        // Status first, so it stops being used even if the file delete fails.
        const { error } = await supabaseAdmin.from('shop_photos').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', photo.id);
        if (error) throw error;
        if (photo.storage_path) {
          const { error: removeError } = await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
          if (removeError) return NextResponse.json({ rejected: photo.id, warning: `Rejected, but the file could not be deleted: ${removeError.message}` });
          await supabaseAdmin.from('shop_photos').update({ storage_path: null }).eq('id', photo.id);
        }
        return NextResponse.json({ rejected: photo.id });
      }

      case 'to_listing': {
        // The second switch. Off by default; with it off, no Google call is made.
        if (!listingPhotosEnabled()) return NextResponse.json({ error: 'Adding photos to the Google listing is switched off (SHOP_PHOTOS_TO_LISTING)' }, { status: 403 });
        const photo = await photoById(body.photoId);
        if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
        if (photo.status !== 'approved' || !photo.storage_path) return NextResponse.json({ error: 'Only an approved photo can be added to the listing' }, { status: 409 });
        if (photo.listing_media_name) return NextResponse.json({ error: 'That photo is already on the listing' }, { status: 409 });

        const shop = await shopById(photo.retailer_id);
        if (!shop?.user_id) return NextResponse.json({ error: 'This shop has not connected its Google listing yet' }, { status: 409 });
        const { data: user } = await supabaseAdmin.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', shop.user_id).single();
        const access = resolveAccess(user as any);
        if (!access.ok) return NextResponse.json({ error: `No working Google access for this shop: ${access.reason}` }, { status: 409 });
        const { data: profile } = await supabaseAdmin.from('profiles').select('id, google_location_name, google_account_id').eq('user_id', shop.user_id).single();
        if (!profile?.google_location_name) return NextResponse.json({ error: 'This shop has no listing chosen yet' }, { status: 409 });

        const { data: signed, error: signError } = await supabaseAdmin.storage.from(PHOTO_BUCKET).createSignedUrl(photo.storage_path, PUBLISH_URL_SECONDS);
        if (signError || !signed?.signedUrl) throw new Error('could not prepare the photo for Google');

        const accessToken = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)));
        const result = await loggedAddListingPhoto(
          { db: supabaseAdmin, source: 'admin-photos', userId: shop.user_id, profileId: profile.id },
          accessToken, profile.google_location_name, { id: photo.id, url: signed.signedUrl }, profile.google_account_id,
        );
        await supabaseAdmin.from('shop_photos').update({ listing_media_name: result?.name ?? 'unknown' }).eq('id', photo.id);
        return NextResponse.json({ added: photo.id });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[admin/photos]', err);
    return NextResponse.json({ error: String(err?.message || 'Failed').slice(0, 300) }, { status: 500 });
  }
}
