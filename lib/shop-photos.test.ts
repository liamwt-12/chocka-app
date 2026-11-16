import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shopPhotosEnabled, listingPhotosEnabled, generatePhotoLinkToken, hashPhotoLinkToken, photoLinkExpiresAt,
  findShopByPhotoToken, preparePhoto, pickPhotoForPost, reservePhotoForUser, photoUrlForPost,
  MAX_PHOTO_BYTES, MIN_PHOTO_BYTES, PHOTO_REUSE_DAYS, PHOTO_BUCKET, PUBLISH_URL_SECONDS, type PhotoRow,
} from './shop-photos';
import { hashInviteToken } from './invite-token';
import { createLocalPost, createLocationMedia } from './google';
import { makeJpeg, makePng, contains, GPS_MARKER } from './image-test-fixtures';

const NOW = new Date('2026-11-16T09:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  process.env.CANCEL_HASH_SECRET = 'test-secret';
  delete process.env.SHOP_PHOTOS;
  delete process.env.SHOP_PHOTOS_TO_LISTING;
});

describe('the switches are off unless turned on', () => {
  it('both are off by default', () => {
    expect(shopPhotosEnabled()).toBe(false);
    expect(listingPhotosEnabled()).toBe(false);
  });
  it('only the exact word "on" turns photos on', () => {
    for (const v of ['true', '1', 'yes', 'enabled', '']) { process.env.SHOP_PHOTOS = v; expect(shopPhotosEnabled()).toBe(false); }
    process.env.SHOP_PHOTOS = ' ON '; expect(shopPhotosEnabled()).toBe(true);
  });
  it('listing photos need BOTH switches', () => {
    process.env.SHOP_PHOTOS_TO_LISTING = 'on'; expect(listingPhotosEnabled()).toBe(false);
    process.env.SHOP_PHOTOS = 'on'; expect(listingPhotosEnabled()).toBe(true);
    delete process.env.SHOP_PHOTOS_TO_LISTING; expect(listingPhotosEnabled()).toBe(false);
  });
});

describe('the upload link', () => {
  const shopRow = { id: 'r1', tenant_id: 't1', name: 'Testwell', town: 'Leeds', photo_link_expires_at: photoLinkExpiresAt(NOW).toISOString(), delisted_at: null };
  /** A fake retailers table that only answers when asked for the right hash. */
  const dbWith = (row: any, token: string) => {
    const seen: any[] = [];
    return {
      seen,
      from: () => ({ select: () => ({ eq: (col: string, val: string) => { seen.push([col, val]); return { limit: async () => ({ data: val === hashPhotoLinkToken(token) ? [row] : [], error: null }) }; } }) }),
    };
  };

  it('tokens are long, random, and stored only as a hash', () => {
    const a = generatePhotoLinkToken(), b = generatePhotoLinkToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashPhotoLinkToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPhotoLinkToken(a)).not.toContain(a);
  });
  it('a photo link cannot be used as an invite link, or the reverse', () => {
    const t = generatePhotoLinkToken();
    expect(hashPhotoLinkToken(t)).not.toBe(hashInviteToken(t));
  });
  it('finds the shop for a valid link, looked up by hash and never by the token itself', async () => {
    const token = generatePhotoLinkToken();
    const db = dbWith(shopRow, token);
    expect(await findShopByPhotoToken(db, token, NOW)).toEqual({ id: 'r1', tenant_id: 't1', name: 'Testwell', town: 'Leeds' });
    expect(db.seen).toEqual([['photo_link_hash', hashPhotoLinkToken(token)]]);
  });
  it('refuses a wrong, malformed, expired or delisted-shop link', async () => {
    const token = generatePhotoLinkToken();
    expect(await findShopByPhotoToken(dbWith(shopRow, token), generatePhotoLinkToken(), NOW)).toBeNull();
    for (const bad of [null, undefined, '', 'short', 42, `${token}/../x`, "' or 1=1 --"]) expect(await findShopByPhotoToken(dbWith(shopRow, token), bad, NOW)).toBeNull();
    expect(await findShopByPhotoToken(dbWith({ ...shopRow, photo_link_expires_at: daysAgo(1) }, token), token, NOW)).toBeNull();
    expect(await findShopByPhotoToken(dbWith({ ...shopRow, photo_link_expires_at: null }, token), token, NOW)).toBeNull();
    expect(await findShopByPhotoToken(dbWith({ ...shopRow, delisted_at: daysAgo(3) }, token), token, NOW)).toBeNull();
  });
  it('links last 30 days', () => {
    expect(photoLinkExpiresAt(NOW).toISOString()).toBe('2026-12-16T09:00:00.000Z');
  });
});

describe('preparePhoto: what must be true before a file is stored', () => {
  const ok = { minBytes: MIN_PHOTO_BYTES + 100 };

  it('accepts a normal JPEG or PNG and returns it cleaned', () => {
    const r = preparePhoto(makeJpeg({ ...ok, orientation: 6, xmp: true }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(contains(r.image.bytes, GPS_MARKER)).toBe(false);
      expect([r.image.contentType, r.image.width, r.image.height]).toEqual(['image/jpeg', 1200, 900]);
    }
    expect(preparePhoto(makePng({ ...ok, exif: true })).ok).toBe(true);
  });
  it('refuses a file that is not a JPEG or PNG, whatever it is called', () => {
    const fake = new Uint8Array(MIN_PHOTO_BYTES + 100).fill(0x41); // "AAAA…"
    expect(preparePhoto(fake)).toEqual({ ok: false, error: 'Photos need to be JPEG or PNG files.' });
    const svg = new Uint8Array(Buffer.from('<svg onload="alert(1)">'.padEnd(MIN_PHOTO_BYTES + 100, ' ')));
    expect(preparePhoto(svg).ok).toBe(false);
  });
  it('refuses a file that is too big or too small', () => {
    expect(preparePhoto(makeJpeg({ minBytes: MAX_PHOTO_BYTES + 1 }))).toEqual({ ok: false, error: 'That photo is too big. Photos need to be under 4 MB.' });
    expect(preparePhoto(makeJpeg()).ok).toBe(false);
  });
  it('refuses a photo smaller than Google will take, either way round', () => {
    expect(preparePhoto(makeJpeg({ ...ok, width: 399, height: 399 })).ok).toBe(false);
    expect(preparePhoto(makeJpeg({ ...ok, width: 800, height: 299 })).ok).toBe(false);
    expect(preparePhoto(makeJpeg({ ...ok, width: 300, height: 400 })).ok).toBe(true); // portrait is fine
    expect(preparePhoto(makeJpeg({ ...ok, width: 20000, height: 900 })).ok).toBe(false);
  });
  it('refuses a damaged file with a message, not an exception', () => {
    const r = preparePhoto(makeJpeg({ ...ok, truncated: true }));
    expect(r).toEqual({ ok: false, error: 'We could not read that photo. Try saving it again, or use a different one.' });
  });
});

describe('pickPhotoForPost: only approved photos, and not the same one every week', () => {
  const p = (id: string, over: Partial<PhotoRow> = {}): PhotoRow => ({ id, status: 'approved', storage_path: `r1/${id}.jpg`, use_count: 0, last_used_at: null, created_at: daysAgo(10), ...over });

  it('never picks a pending or rejected photo, or one whose file is gone', () => {
    expect(pickPhotoForPost([p('a', { status: 'pending' }), p('b', { status: 'rejected' }), p('c', { storage_path: null })], NOW)).toBeNull();
    expect(pickPhotoForPost([], NOW)).toBeNull();
  });
  it('picks the least used, then the one used longest ago, then the oldest', () => {
    expect(pickPhotoForPost([p('a', { use_count: 2, last_used_at: daysAgo(100) }), p('b', { use_count: 1, last_used_at: daysAgo(90) })], NOW)?.id).toBe('b');
    expect(pickPhotoForPost([p('a', { use_count: 1, last_used_at: daysAgo(70) }), p('b', { use_count: 1, last_used_at: daysAgo(90) })], NOW)?.id).toBe('b');
    expect(pickPhotoForPost([p('a', { created_at: daysAgo(5) }), p('b', { created_at: daysAgo(9) })], NOW)?.id).toBe('b');
  });
  it('does not reuse a photo within eight weeks: a shop with one photo gets it once, then text posts', () => {
    expect(pickPhotoForPost([p('a', { use_count: 1, last_used_at: daysAgo(PHOTO_REUSE_DAYS - 1) })], NOW)).toBeNull();
    expect(pickPhotoForPost([p('a', { use_count: 1, last_used_at: daysAgo(PHOTO_REUSE_DAYS + 1) })], NOW)?.id).toBe('a');
  });
});

/** A tiny fake of the two tables these helpers read, recording every update. */
function fakeDb(tables: { retailers?: any[]; shop_photos?: any[] }, opts: { failPhotos?: boolean } = {}) {
  const updates: any[] = [];
  return {
    updates,
    from(table: 'retailers' | 'shop_photos') {
      const filters: Record<string, any> = {};
      const rows = () => (tables[table] || []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filters[k] = v; return q; },
        limit: async () => ({ data: rows(), error: null }),
        update: (patch: any) => { const u: any = { table, patch, filters: {} as any }; updates.push(u); const uq: any = { eq: (k: string, v: any) => { u.filters[k] = v; return uq; }, then: (res: any) => res({ error: null }) }; return uq; },
        then: (res: any) => res(table === 'shop_photos' && opts.failPhotos ? { data: null, error: { message: 'relation "shop_photos" does not exist' } } : { data: rows(), error: null }),
      };
      return q;
    },
  };
}

describe('reservePhotoForUser: attaching a photo to a new post', () => {
  const tables = () => ({
    retailers: [{ id: 'r1', user_id: 'u1' }],
    shop_photos: [
      { id: 'pending1', retailer_id: 'r1', status: 'pending', storage_path: 'r1/x.jpg', use_count: 0, last_used_at: null, created_at: daysAgo(1) },
      { id: 'ok1', retailer_id: 'r1', status: 'approved', storage_path: 'r1/y.jpg', use_count: 0, last_used_at: null, created_at: daysAgo(2) },
      { id: 'other-shop', retailer_id: 'r2', status: 'approved', storage_path: 'r2/z.jpg', use_count: 0, last_used_at: null, created_at: daysAgo(9) },
    ],
  });

  it('does nothing at all while the switch is off', async () => {
    const db = fakeDb(tables());
    const spy = vi.spyOn(db, 'from');
    expect(await reservePhotoForUser(db, 'u1', NOW)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it('with the switch on, reserves this shop\'s approved photo and marks it used', async () => {
    process.env.SHOP_PHOTOS = 'on';
    const db = fakeDb(tables());
    expect(await reservePhotoForUser(db, 'u1', NOW)).toBe('ok1');
    expect(db.updates).toEqual([{ table: 'shop_photos', patch: { use_count: 1, last_used_at: NOW.toISOString() }, filters: { id: 'ok1', status: 'approved' } }]);
  });
  it('returns null, never throws: no shop, no approved photo, or the table not existing yet', async () => {
    process.env.SHOP_PHOTOS = 'on';
    expect(await reservePhotoForUser(fakeDb(tables()), 'nobody', NOW)).toBeNull();
    expect(await reservePhotoForUser(fakeDb(tables()), null, NOW)).toBeNull();
    expect(await reservePhotoForUser(fakeDb({ retailers: [{ id: 'r1', user_id: 'u1' }], shop_photos: [] }), 'u1', NOW)).toBeNull();
    expect(await reservePhotoForUser(fakeDb(tables(), { failPhotos: true }), 'u1', NOW)).toBeNull();
    expect(await reservePhotoForUser({ from: () => { throw new Error('down'); } }, 'u1', NOW)).toBeNull();
  });
});

describe('photoUrlForPost: the last check before Google sees a photo', () => {
  const storage = (url: string | null = 'https://staging.example/signed?token=abc') => {
    const calls: any[] = [];
    return { calls, from: (bucket: string) => ({ createSignedUrl: async (path: string, ttl: number) => { calls.push([bucket, path, ttl]); return url ? { data: { signedUrl: url }, error: null } : { data: null, error: { message: 'nope' } }; } }) };
  };
  const photos = (status: string, path: string | null = 'r1/y.jpg') => ({ shop_photos: [{ id: 'ok1', status, storage_path: path }] });

  it('gives nothing while the switch is off, without touching storage', async () => {
    const s = storage();
    expect(await photoUrlForPost(fakeDb(photos('approved')), s, 'ok1')).toBeNull();
    expect(s.calls).toEqual([]);
  });
  it('gives a short-lived address for an approved photo', async () => {
    process.env.SHOP_PHOTOS = 'on';
    const s = storage();
    expect(await photoUrlForPost(fakeDb(photos('approved')), s, 'ok1')).toBe('https://staging.example/signed?token=abc');
    expect(s.calls).toEqual([[PHOTO_BUCKET, 'r1/y.jpg', PUBLISH_URL_SECONDS]]);
  });
  it('gives nothing for a photo rejected after the post was written, a deleted file, a post with no photo, or a storage failure', async () => {
    process.env.SHOP_PHOTOS = 'on';
    expect(await photoUrlForPost(fakeDb(photos('rejected')), storage(), 'ok1')).toBeNull();
    expect(await photoUrlForPost(fakeDb(photos('pending')), storage(), 'ok1')).toBeNull();
    expect(await photoUrlForPost(fakeDb(photos('approved', null)), storage(), 'ok1')).toBeNull();
    expect(await photoUrlForPost(fakeDb(photos('approved')), storage(), null)).toBeNull();
    expect(await photoUrlForPost(fakeDb(photos('approved')), storage(null), 'ok1')).toBeNull();
    expect(await photoUrlForPost(fakeDb(photos('approved')), storage(), 'unknown')).toBeNull();
  });
});

describe('what is sent to Google (mocked)', () => {
  const realFetch = global.fetch;
  let sent: Array<{ url: string; body: any }>;
  beforeEach(() => {
    sent = [];
    global.fetch = vi.fn(async (url: any, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ name: 'accounts/1/locations/2/thing/3' }), { status: 200 }); }) as any;
  });
  afterEach(() => { global.fetch = realFetch; });

  it('a post with no photo is exactly the request it always was', async () => {
    await createLocalPost('tok', 'locations/2', 'Hello', 'accounts/1');
    await createLocalPost('tok', 'locations/2', 'Hello', 'accounts/1', null);
    expect(sent[0].body).toEqual({ languageCode: 'en-GB', summary: 'Hello', topicType: 'STANDARD' });
    expect(sent[1].body).toEqual(sent[0].body);
  });
  it('a post with a photo carries one PHOTO media item', async () => {
    await createLocalPost('tok', 'locations/2', 'Hello', 'accounts/1', 'https://staging.example/p.jpg');
    expect(sent[0].url).toMatch(/accounts\/1\/locations\/2\/localPosts$/);
    expect(sent[0].body.media).toEqual([{ mediaFormat: 'PHOTO', sourceUrl: 'https://staging.example/p.jpg' }]);
  });
  it('a listing photo goes to the media endpoint as an ADDITIONAL photo', async () => {
    await createLocationMedia('tok', 'locations/2', 'https://staging.example/p.jpg', 'accounts/1');
    expect(sent[0].url).toMatch(/accounts\/1\/locations\/2\/media$/);
    expect(sent[0].body).toEqual({ mediaFormat: 'PHOTO', locationAssociation: { category: 'ADDITIONAL' }, sourceUrl: 'https://staging.example/p.jpg' });
  });
});
