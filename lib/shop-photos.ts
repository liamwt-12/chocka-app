/**
 * Photos of a shop's work: uploaded through a link, approved by a rep, then
 * attached to posts.
 *
 * THE RULES
 *
 *  1. OFF BY DEFAULT. Nothing here runs unless SHOP_PHOTOS=on. With it off the
 *     upload link is a 404, the admin actions refuse, and posts are written and
 *     published exactly as before.
 *  2. UPLOAD IS BY LINK. A rep generates a link for one shop in /admin/pilot and
 *     passes it on (nothing is sent). Only the link's hash is stored, it expires,
 *     and generating a new one cancels the old one. The link lets its holder add
 *     photos for that one shop and nothing else: it cannot read, approve, delete
 *     or see anything.
 *  3. EVERY FILE IS CHECKED AND CLEANED before it is stored: JPEG or PNG by its
 *     actual bytes, within the size limits, and with all metadata removed,
 *     including the GPS position (lib/image-metadata.ts). A file that cannot be
 *     cleaned is refused, never stored as it came.
 *  4. NOTHING IS USED UNTIL A REP APPROVES IT. A new photo is 'pending'. Only
 *     'approved' photos are ever attached to a post or offered for the listing.
 *     Rejecting a photo deletes the file.
 *  5. ADDING A PHOTO TO THE GOOGLE LISTING ITSELF is a separate switch,
 *     SHOP_PHOTOS_TO_LISTING=on, also off by default, and goes through the
 *     change log (lib/change-log.ts) so it can be undone. It also needs the
 *     migration 20261116110000_change_log_add_media, which must not be applied
 *     anywhere until the earlier ones are on production (see that file). Until
 *     then the attempt fails safely: no log row, so no write.
 *
 * Pure functions plus helpers that take the database client as an argument.
 */
import { createHmac, randomBytes } from 'crypto';
import { cleanImage, remainingMetadata, ImageError, type CleanImage } from './image-metadata';

export const PHOTO_BUCKET = 'shop-photos';

/**
 * Largest upload accepted. Netlify refuses request bodies over 6 MB and encodes
 * binary bodies as base64 on the way in, so about 4 MB of photo is the most
 * that can arrive. The upload page shrinks photos in the browser first, so a
 * normal phone photo ends up well under this.
 */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** Google refuses photos under 10 KB. */
export const MIN_PHOTO_BYTES = 10 * 1024;
/** Google's minimum for a post photo is 400 x 300. */
export const MIN_LONG_SIDE = 400;
export const MIN_SHORT_SIDE = 300;
export const MAX_SIDE = 10000;

/** Photos a shop can have waiting or approved at once. Rejected ones do not count. */
export const MAX_PHOTOS_PER_SHOP = 40;
export const PHOTO_LINK_TTL_DAYS = 30;
/** The same photo is not attached to another post for this long. */
export const PHOTO_REUSE_DAYS = 56;
/** How long the address handed to Google stays valid. Google fetches the photo straight away. */
export const PUBLISH_URL_SECONDS = 60 * 60;
export const THUMBNAIL_URL_SECONDS = 10 * 60;

export type PhotoStatus = 'pending' | 'approved' | 'rejected';

// ── Switches ────────────────────────────────────────────────────────────────

const on = (v: string | undefined) => (v || '').trim().toLowerCase() === 'on';

/** Uploading, approving and attaching photos to posts. Off unless SHOP_PHOTOS=on. */
export function shopPhotosEnabled(): boolean {
  return on(process.env.SHOP_PHOTOS);
}

/** Adding a photo to the Google listing itself. Needs BOTH switches on. */
export function listingPhotosEnabled(): boolean {
  return shopPhotosEnabled() && on(process.env.SHOP_PHOTOS_TO_LISTING);
}

// ── The upload link ─────────────────────────────────────────────────────────

function linkSecret(): string {
  const raw = process.env.CANCEL_HASH_SECRET;
  if (!raw || !raw.trim()) throw new Error('CANCEL_HASH_SECRET is not set, so photo links can be neither issued nor checked');
  return raw.trim();
}

export function generatePhotoLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Namespaced, so a photo link token can never be replayed as an invite token or the reverse. */
export function hashPhotoLinkToken(token: string): string {
  if (typeof token !== 'string' || !token) throw new Error('refusing to hash an empty token');
  return createHmac('sha256', linkSecret()).update(`photo-link:${token}`).digest('hex');
}

export function photoLinkExpiresAt(now: Date = new Date(), days: number = PHOTO_LINK_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export interface PhotoDb { from(table: string): any }

export interface PhotoShop { id: string; tenant_id: string; name: string; town: string | null }

/**
 * The shop a link belongs to, or null if the link is unknown, cancelled, or
 * expired. Looked up by hash, so the token itself is never stored or compared
 * as text.
 */
export async function findShopByPhotoToken(db: PhotoDb, rawToken: unknown, now: Date = new Date()): Promise<PhotoShop | null> {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const { data, error } = await db
    .from('retailers')
    .select('id, tenant_id, name, town, photo_link_expires_at, delisted_at')
    .eq('photo_link_hash', hashPhotoLinkToken(token))
    .limit(1);
  const row = !error && data?.[0];
  if (!row || row.delisted_at) return null;
  if (!row.photo_link_expires_at || Date.parse(row.photo_link_expires_at) <= now.getTime()) return null;
  return { id: row.id, tenant_id: row.tenant_id, name: row.name, town: row.town ?? null };
}

// ── Checking and cleaning one file ──────────────────────────────────────────

export type PreparedPhoto = { ok: true; image: CleanImage } | { ok: false; error: string };

/**
 * Everything that must be true of a file before it is stored. Returns the
 * cleaned image, or a reason the person uploading can act on.
 */
export function preparePhoto(input: Uint8Array): PreparedPhoto {
  if (input.length > MAX_PHOTO_BYTES) return { ok: false, error: 'That photo is too big. Photos need to be under 4 MB.' };
  if (input.length < MIN_PHOTO_BYTES) return { ok: false, error: 'That file is too small to be a usable photo.' };

  let image: CleanImage;
  try {
    image = cleanImage(input);
  } catch (err) {
    if (err instanceof ImageError) {
      return { ok: false, error: err.message === 'not a JPEG or PNG' ? 'Photos need to be JPEG or PNG files.' : 'We could not read that photo. Try saving it again, or use a different one.' };
    }
    throw err;
  }

  const long = Math.max(image.width, image.height);
  const short = Math.min(image.width, image.height);
  if (long < MIN_LONG_SIDE || short < MIN_SHORT_SIDE) return { ok: false, error: `That photo is too small. It needs to be at least ${MIN_LONG_SIDE} by ${MIN_SHORT_SIDE} pixels.` };
  if (long > MAX_SIDE) return { ok: false, error: 'That photo is too large in size. Try a smaller version.' };

  // Read the cleaned file back with a separate check. If anything is left, the
  // photo is refused rather than stored: failing closed is the whole point.
  const left = remainingMetadata(image.bytes);
  if (left.length) return { ok: false, error: 'We could not make that photo safe to store. Try a different one.' };

  return { ok: true, image };
}

// ── Choosing a photo for a post ─────────────────────────────────────────────

export interface PhotoRow {
  id: string;
  status: PhotoStatus;
  storage_path: string | null;
  use_count: number | null;
  last_used_at: string | null;
  created_at: string;
}

/**
 * The approved photo to attach to the next post, or null for a post with no
 * photo. Least used first, then the one used longest ago. A photo used within
 * the last eight weeks is not offered again, so a shop with one photo does not
 * get the same picture every Monday.
 */
export function pickPhotoForPost<T extends PhotoRow>(photos: T[], now: Date = new Date()): T | null {
  const cutoff = now.getTime() - PHOTO_REUSE_DAYS * 86_400_000;
  const usable = photos.filter((p) => p.status === 'approved' && !!p.storage_path && (!p.last_used_at || Date.parse(p.last_used_at) <= cutoff));
  usable.sort((a, b) =>
    (a.use_count || 0) - (b.use_count || 0) ||
    (a.last_used_at || '').localeCompare(b.last_used_at || '') ||
    a.created_at.localeCompare(b.created_at));
  return usable[0] ?? null;
}

/**
 * Pick and reserve a photo for a new post. Returns its id, or null.
 *
 * Never throws and never blocks a post: with the switch off, no shop, no
 * approved photo, or any database error, the answer is "no photo" and the post
 * is written as it always was.
 */
export async function reservePhotoForUser(db: PhotoDb, userId: string | null | undefined, now: Date = new Date()): Promise<string | null> {
  if (!shopPhotosEnabled() || !userId) return null;
  try {
    const { data: shops } = await db.from('retailers').select('id').eq('user_id', userId).limit(1);
    const shopId = shops?.[0]?.id;
    if (!shopId) return null;
    const { data: photos, error } = await db
      .from('shop_photos')
      .select('id, status, storage_path, use_count, last_used_at, created_at')
      .eq('retailer_id', shopId)
      .eq('status', 'approved');
    if (error) return null;
    const pick = pickPhotoForPost((photos || []) as PhotoRow[], now);
    if (!pick) return null;
    const { error: reserveError } = await db
      .from('shop_photos')
      .update({ use_count: (pick.use_count || 0) + 1, last_used_at: now.toISOString() })
      .eq('id', pick.id)
      .eq('status', 'approved');
    return reserveError ? null : pick.id;
  } catch {
    return null;
  }
}

export interface PhotoStorage {
  from(bucket: string): {
    createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  };
}

/**
 * A short-lived address for a post's photo, for Google to fetch at publish
 * time, or null to publish the post without a photo.
 *
 * Checked again here, at the last moment: the switch must still be on and the
 * photo must still be approved. A photo rejected after the post was written is
 * not published. Never throws.
 */
export async function photoUrlForPost(db: PhotoDb, storage: PhotoStorage, photoId: string | null | undefined): Promise<string | null> {
  if (!shopPhotosEnabled() || !photoId) return null;
  try {
    const { data, error } = await db.from('shop_photos').select('id, status, storage_path').eq('id', photoId).limit(1);
    const photo = !error && data?.[0];
    if (!photo || photo.status !== 'approved' || !photo.storage_path) return null;
    const { data: signed, error: signError } = await storage.from(PHOTO_BUCKET).createSignedUrl(photo.storage_path, PUBLISH_URL_SECONDS);
    if (signError || !signed?.signedUrl) return null;
    return signed.signedUrl;
  } catch {
    return null;
  }
}
