import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
vi.mock('./google', () => ({
  getLocationFields: vi.fn(async () => { calls.push('snapshot'); return { name: 'locations/1', profile: { description: 'old text' } }; }),
  updateLocation: vi.fn(async (_t: string, _l: string, _m: string, data: any) => { calls.push('patch'); return { name: 'locations/1', ...data }; }),
  createLocalPost: vi.fn(async () => { calls.push('post'); return { name: 'accounts/9/locations/1/localPosts/77' }; }),
  replyToReview: vi.fn(async () => { calls.push('reply'); return {}; }),
  createLocationMedia: vi.fn(async () => { calls.push('media'); return { name: 'accounts/9/locations/1/media/55' }; }),
}));

import * as google from './google';
import {
  loggedUpdateLocation, loggedCreatePost, loggedReplyToReview, loggedAddListingPhoto,
  maskFields, pickFields, locationFromResourceName, planRevert, type ChangeRow,
} from './change-log';

/** Minimal fake of the Supabase query builder for change_log. */
function fakeDb(opts: { failInsert?: boolean; failUpdate?: boolean } = {}) {
  const rows: any[] = [];
  const db = {
    rows,
    from: () => ({
      insert: (r: any) => ({
        select: () => ({
          single: async () => {
            calls.push('log-insert');
            if (opts.failInsert) return { data: null, error: { message: 'db down' } };
            const row = { id: `row-${rows.length + 1}`, ...r };
            rows.push(row);
            return { data: { id: row.id }, error: null };
          },
        }),
      }),
      update: (patch: any) => ({
        eq: async (_c: string, id: string) => {
          calls.push(`log-update:${patch.status}`);
          if (opts.failUpdate) return { error: { message: 'db down' } };
          Object.assign(rows.find((r) => r.id === id), patch);
          return { error: null };
        },
      }),
    }),
  };
  return db;
}

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('loggedUpdateLocation', () => {
  it('snapshots, records pending, writes, then records applied, in that order', async () => {
    const db = fakeDb();
    await loggedUpdateLocation({ db, source: 'onboarding', userId: 'u', profileId: 'p' }, 'tok', 'locations/1', 'profile', { profile: { description: 'new text' } });
    expect(calls).toEqual(['snapshot', 'log-insert', 'patch', 'log-update:applied']);
    expect(db.rows[0]).toMatchObject({
      action: 'update_location', target: 'profile', location_name: 'locations/1', source: 'onboarding',
      user_id: 'u', profile_id: 'p', status: 'applied',
      before_value: { profile: { description: 'old text' } },
      after_value: { profile: { description: 'new text' } },
    });
  });

  it('does not write to Google if the log row cannot be recorded', async () => {
    await expect(
      loggedUpdateLocation({ db: fakeDb({ failInsert: true }), source: 'onboarding' }, 't', 'locations/1', 'profile', {}),
    ).rejects.toThrow(/write not made/);
    expect(google.updateLocation).not.toHaveBeenCalled();
  });

  it('does not write to Google if the snapshot fails', async () => {
    vi.mocked(google.getLocationFields).mockRejectedValueOnce(new Error('403'));
    await expect(loggedUpdateLocation({ db: fakeDb(), source: 'onboarding' }, 't', 'locations/1', 'profile', {})).rejects.toThrow('403');
    expect(google.updateLocation).not.toHaveBeenCalled();
  });

  it('marks the row failed and rethrows when Google refuses', async () => {
    vi.mocked(google.updateLocation).mockRejectedValueOnce(new Error('Update failed (profile): bad'));
    const db = fakeDb();
    await expect(loggedUpdateLocation({ db, source: 'onboarding' }, 't', 'locations/1', 'profile', {})).rejects.toThrow('bad');
    expect(db.rows[0]).toMatchObject({ status: 'failed', error: 'Update failed (profile): bad' });
  });

  it('still returns the result if only the final log update fails', async () => {
    const res = await loggedUpdateLocation({ db: fakeDb({ failUpdate: true }), source: 'onboarding' }, 't', 'locations/1', 'profile', { profile: { description: 'x' } });
    expect(res).toMatchObject({ name: 'locations/1' });
  });

  it('records an absent field as absent, so a revert clears it', async () => {
    vi.mocked(google.getLocationFields).mockResolvedValueOnce({ name: 'locations/1' });
    const db = fakeDb();
    await loggedUpdateLocation({ db, source: 'onboarding' }, 't', 'locations/1', 'serviceItems', { serviceItems: [1] });
    expect(db.rows[0].before_value).toEqual({});
  });
});

describe('loggedCreatePost and loggedReplyToReview', () => {
  it('records the created post name for a later delete', async () => {
    const db = fakeDb();
    await loggedCreatePost({ db, source: 'post-publisher' }, 't', 'locations/1', 'Hello', 'accounts/9');
    expect(db.rows[0]).toMatchObject({ action: 'create_post', before_value: null, after_value: { name: 'accounts/9/locations/1/localPosts/77', summary: 'Hello' } });
  });

  it('records whether the previous reply was known', async () => {
    const db = fakeDb();
    await loggedReplyToReview({ db, source: 'review-alerts' }, 't', 'accounts/9/locations/1/reviews/r1', 'Thanks!', null);
    await loggedReplyToReview({ db, source: 'auto-reply' }, 't', 'locations/1/reviews/r2', 'Thanks!');
    expect(db.rows[0]).toMatchObject({ location_name: 'locations/1', target: 'accounts/9/locations/1/reviews/r1', before_value: { known: true, comment: null } });
    expect(db.rows[1].before_value).toEqual({ known: false, comment: null });
  });
});

describe('helpers', () => {
  it('maskFields', () => {
    expect(maskFields('profile, serviceItems,profile.description')).toEqual(['profile', 'serviceItems']);
  });
  it('pickFields', () => {
    expect(pickFields({ a: 1, b: null, c: 3 }, ['a', 'b', 'z'])).toEqual({ a: 1, b: null });
  });
  it('locationFromResourceName', () => {
    expect(locationFromResourceName('accounts/1/locations/2/reviews/3')).toBe('locations/2');
  });
});

describe('planRevert', () => {
  const base: ChangeRow = { id: 'c1', action: 'update_location', location_name: 'locations/1', target: 'profile', before_value: { profile: { description: 'old' } }, after_value: {}, status: 'applied', reverted_at: null };

  it('restores masked fields from the before-value', () => {
    expect(planRevert(base)).toEqual({ kind: 'restore_fields', changeId: 'c1', locationName: 'locations/1', updateMask: 'profile', body: { profile: { description: 'old' } } });
  });
  it('restores an empty field as an empty body under the same mask', () => {
    expect(planRevert({ ...base, target: 'serviceItems', before_value: {} })).toMatchObject({ updateMask: 'serviceItems', body: {} });
  });
  it('skips already-reverted and failed rows', () => {
    expect(planRevert({ ...base, reverted_at: '2026-11-14' }).kind).toBe('skip');
    expect(planRevert({ ...base, status: 'failed' }).kind).toBe('skip');
  });
  it('treats a pending row as revertible (the write may have happened)', () => {
    expect(planRevert({ ...base, status: 'pending' }).kind).toBe('restore_fields');
  });
  it('deletes a created post', () => {
    expect(planRevert({ ...base, action: 'create_post', target: null, before_value: null, after_value: { name: 'x/localPosts/1' } })).toMatchObject({ kind: 'delete_post', postName: 'x/localPosts/1' });
  });
  it('restores, deletes or skips a reply depending on what was known', () => {
    const r = { ...base, action: 'reply_review' as const, target: 'locations/1/reviews/9' };
    expect(planRevert({ ...r, before_value: { known: true, comment: 'earlier' } })).toMatchObject({ kind: 'restore_reply', comment: 'earlier' });
    expect(planRevert({ ...r, before_value: { known: true, comment: null } }).kind).toBe('delete_reply');
    expect(planRevert({ ...r, before_value: { known: false, comment: null } }).kind).toBe('skip');
  });
});

describe('photos (lib/shop-photos.ts)', () => {
  const ctx = (db: any) => ({ db, source: 'post-publisher' as const, userId: 'u', profileId: 'p' });

  it('a post with no photo is logged and sent exactly as before', async () => {
    const db = fakeDb();
    await loggedCreatePost(ctx(db), 'tok', 'locations/1', 'Hello', 'accounts/9');
    expect(google.createLocalPost).toHaveBeenCalledWith('tok', 'locations/1', 'Hello', 'accounts/9', undefined);
    expect(db.rows[0].after_value).toEqual({ name: 'accounts/9/locations/1/localPosts/77', summary: 'Hello' });
  });

  it('a post with a photo records which photo, and never its short-lived address', async () => {
    const db = fakeDb();
    await loggedCreatePost(ctx(db), 'tok', 'locations/1', 'Hello', 'accounts/9', { id: 'photo-1', url: 'https://staging.example/signed?token=secret' });
    expect(google.createLocalPost).toHaveBeenCalledWith('tok', 'locations/1', 'Hello', 'accounts/9', 'https://staging.example/signed?token=secret');
    expect(db.rows[0].after_value).toEqual({ name: 'accounts/9/locations/1/localPosts/77', summary: 'Hello', photoId: 'photo-1' });
    expect(JSON.stringify(db.rows[0])).not.toContain('secret');
  });

  it('a listing photo is recorded before it is written, then marked applied with its name', async () => {
    const db = fakeDb();
    await loggedAddListingPhoto({ db, source: 'admin-photos', userId: 'u', profileId: 'p' }, 'tok', 'locations/1', { id: 'photo-1', url: 'https://staging.example/signed?token=secret' }, 'accounts/9');
    expect(calls).toEqual(['log-insert', 'media', 'log-update:applied']);
    expect(db.rows[0]).toMatchObject({ action: 'add_media', source: 'admin-photos', status: 'applied', before_value: null, after_value: { name: 'accounts/9/locations/1/media/55', photoId: 'photo-1' } });
    expect(JSON.stringify(db.rows[0])).not.toContain('secret');
  });

  it('if the log cannot be written, the listing photo is NOT added', async () => {
    await expect(loggedAddListingPhoto({ db: fakeDb({ failInsert: true }), source: 'admin-photos' }, 'tok', 'locations/1', { id: 'photo-1', url: 'https://x.example/p.jpg' })).rejects.toThrow(/write not made/);
    expect(google.createLocationMedia).not.toHaveBeenCalled();
  });

  it('undoing a listing photo deletes it; with no name recorded it is skipped', () => {
    const row: ChangeRow = { id: 'c1', action: 'add_media', location_name: 'locations/1', target: null, before_value: null, after_value: { name: 'accounts/9/locations/1/media/55', photoId: 'photo-1' }, status: 'applied', reverted_at: null };
    expect(planRevert(row)).toEqual({ kind: 'delete_media', changeId: 'c1', mediaName: 'accounts/9/locations/1/media/55' });
    expect(planRevert({ ...row, after_value: null, status: 'pending' }).kind).toBe('skip');
  });
});
