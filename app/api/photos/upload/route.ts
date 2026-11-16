import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import {
  shopPhotosEnabled, findShopByPhotoToken, preparePhoto,
  PHOTO_BUCKET, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_SHOP,
} from '@/lib/shop-photos';

/**
 * The upload link (lib/shop-photos.ts). No sign-in: the link itself is the
 * permission, and all it permits is adding photos for one shop.
 *
 * GET  ?token=            which shop this link is for, and how many more photos it can take
 * POST multipart          token, photo: check, clean, store as 'pending'
 *
 * 404 for everything unless SHOP_PHOTOS=on. Nothing uploaded here is used
 * anywhere until a rep approves it in /admin/pilot.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GONE = 'This link is not valid any more. Ask your rep for a new one.';

async function activeCount(retailerId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('shop_photos')
    .select('id', { count: 'exact', head: true })
    .eq('retailer_id', retailerId)
    .in('status', ['pending', 'approved']);
  return count || 0;
}

export async function GET(request: NextRequest) {
  if (!shopPhotosEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const shop = await findShopByPhotoToken(supabaseAdmin, request.nextUrl.searchParams.get('token'));
    if (!shop) return NextResponse.json({ error: GONE }, { status: 404 });
    const used = await activeCount(shop.id);
    return NextResponse.json({ shop: { name: shop.name, town: shop.town }, remaining: Math.max(0, MAX_PHOTOS_PER_SHOP - used) });
  } catch (err) {
    console.error('[photos/upload] lookup failed:', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!shopPhotosEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Refuse an oversized body before reading it. The margin covers the form's
  // own framing around the file.
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_PHOTO_BYTES + 64 * 1024) return NextResponse.json({ error: 'That photo is too big. Photos need to be under 4 MB.' }, { status: 413 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }

  try {
    const shop = await findShopByPhotoToken(supabaseAdmin, form.get('token'));
    if (!shop) return NextResponse.json({ error: GONE }, { status: 404 });

    const file = form.get('photo');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose a photo to upload.' }, { status: 400 });
    if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: 'That photo is too big. Photos need to be under 4 MB.' }, { status: 413 });

    // The browser's stated type and the file name are ignored: preparePhoto
    // decides from the bytes, then removes every piece of metadata.
    const prepared = preparePhoto(new Uint8Array(await file.arrayBuffer()));
    if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });
    const { image } = prepared;

    if (await activeCount(shop.id) >= MAX_PHOTOS_PER_SHOP) {
      return NextResponse.json({ error: `This shop already has ${MAX_PHOTOS_PER_SHOP} photos. Ask your rep to clear some before adding more.` }, { status: 409 });
    }

    // The stored name is ours, never the uploaded file's name.
    const path = `${shop.id}/${randomUUID()}.${image.extension}`;
    const { error: storeError } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .upload(path, Buffer.from(image.bytes), { contentType: image.contentType, upsert: false });
    if (storeError) throw new Error(`storage: ${storeError.message}`);

    const { error: rowError } = await supabaseAdmin.from('shop_photos').insert({
      retailer_id: shop.id,
      tenant_id: shop.tenant_id,
      storage_path: path,
      content_type: image.contentType,
      bytes: image.bytes.length,
      width: image.width,
      height: image.height,
      status: 'pending',
    });
    if (rowError) {
      // No record means nobody could ever approve or delete it, so remove the file.
      await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
      throw new Error(`record: ${rowError.message}`);
    }

    console.log(`[photos/upload] shop ${shop.id}: stored ${image.width}x${image.height} ${image.contentType}, removed: ${image.removed.join(', ') || 'nothing'}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[photos/upload] failed:', err);
    return NextResponse.json({ error: 'We could not save that photo. Please try again.' }, { status: 500 });
  }
}
