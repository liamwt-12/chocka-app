/**
 * Every write the app makes to a Google Business Profile goes through here, so
 * that "undo any change" has something to undo from.
 *
 * Order of operations for each write:
 *   1. snapshot the values about to change (update_location only)
 *   2. insert a change_log row, status 'pending', with before_value
 *   3. make the Google write
 *   4. mark the row 'applied' with after_value, or 'failed' with the error
 *
 * If 1 or 2 fails, the write is NOT made: an unrecorded change is exactly what
 * this exists to prevent. If 4 fails, the write has already happened, so the
 * result is returned and the row stays 'pending' with its before_value intact.
 * That is still enough to revert from, and the error is logged.
 *
 * The database client is passed in rather than imported, so the module is
 * testable without Supabase credentials and so the revert script can reuse it.
 */
import {
  getLocationFields,
  updateLocation,
  createLocalPost,
  createLocationMedia,
  replyToReview,
} from './google';

export type ChangeSource = 'onboarding' | 'post-publisher' | 'review-alerts' | 'auto-reply' | 'revert' | 'admin-photos';
export type ChangeAction = 'update_location' | 'create_post' | 'reply_review' | 'add_media';

/** The subset of the Supabase client this module uses. */
export interface ChangeLogDb {
  from(table: 'change_log'): any;
}

export interface WriteContext {
  db: ChangeLogDb;
  source: ChangeSource;
  userId?: string | null;
  profileId?: string | null;
}

/** 'profile,serviceItems' → ['profile', 'serviceItems']. Nested masks keep their top-level field. */
export function maskFields(updateMask: string): string[] {
  return Array.from(
    new Set(
      updateMask
        .split(',')
        .map((f) => f.trim().split('.')[0])
        .filter(Boolean),
    ),
  );
}

/** Copy only the named top-level fields. Absent fields stay absent: that is what "was empty" looks like. */
export function pickFields(obj: Record<string, unknown> | null | undefined, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj) return out;
  for (const f of fields) if (f in obj) out[f] = obj[f];
  return out;
}

/** 'accounts/1/locations/2/reviews/3' → 'locations/2'. Falls back to the input. */
export function locationFromResourceName(name: string): string {
  const m = /(locations\/[^/]+)/.exec(name);
  return m ? m[1] : name;
}

async function withLog<T>(
  ctx: WriteContext,
  entry: { action: ChangeAction; location_name: string; target: string | null; before_value: unknown },
  write: () => Promise<T>,
  after: (result: T) => unknown,
): Promise<T> {
  const { data: row, error: insertError } = await ctx.db
    .from('change_log')
    .insert({
      user_id: ctx.userId ?? null,
      profile_id: ctx.profileId ?? null,
      source: ctx.source,
      status: 'pending',
      ...entry,
    })
    .select('id')
    .single();
  if (insertError || !row?.id) {
    throw new Error(`change_log: could not record before-value, write not made: ${insertError?.message ?? 'no row returned'}`);
  }

  let result: T;
  try {
    result = await write();
  } catch (err: any) {
    const { error } = await ctx.db
      .from('change_log')
      .update({ status: 'failed', error: String(err?.message ?? err).slice(0, 2000) })
      .eq('id', row.id);
    if (error) console.error(`[change-log] could not mark ${row.id} failed: ${error.message}`);
    throw err;
  }

  const { error: updateError } = await ctx.db
    .from('change_log')
    .update({ status: 'applied', after_value: after(result) ?? null })
    .eq('id', row.id);
  if (updateError) {
    console.error(`[change-log] write applied but row ${row.id} not marked applied: ${updateError.message}`);
  }
  return result;
}

/** updateLocation, with the previous values of every masked field recorded first. */
export async function loggedUpdateLocation(
  ctx: WriteContext,
  accessToken: string,
  locationName: string,
  updateMask: string,
  data: Record<string, unknown>,
) {
  const fields = maskFields(updateMask);
  const current = await getLocationFields(accessToken, locationName, fields);
  const before = pickFields(current, fields);
  return withLog(
    ctx,
    { action: 'update_location', location_name: locationName, target: updateMask, before_value: before },
    () => updateLocation(accessToken, locationName, updateMask, data),
    (res: any) => {
      const fromResponse = pickFields(res, fields);
      return Object.keys(fromResponse).length ? fromResponse : pickFields(data, fields);
    },
  );
}

/** createLocalPost. There is no "before"; the after-value carries the post's resource name, which is what a revert deletes. */
export async function loggedCreatePost(
  ctx: WriteContext,
  accessToken: string,
  locationName: string,
  content: string,
  accountId?: string,
  /** Optional photo (lib/shop-photos.ts). The log records which photo, never its address, which is short-lived. */
  photo?: { id: string; url: string } | null,
) {
  return withLog(
    ctx,
    { action: 'create_post', location_name: locationName, target: null, before_value: null },
    () => createLocalPost(accessToken, locationName, content, accountId, photo?.url),
    (res: any) => ({ name: res?.name ?? null, summary: content, ...(photo ? { photoId: photo.id } : {}) }),
  );
}

/**
 * Add a photo to the listing's own gallery. There is no "before"; the
 * after-value carries the media item's resource name, which is what a revert
 * deletes. Callers must check listingPhotosEnabled() first: this function logs
 * and writes, it does not decide.
 */
export async function loggedAddListingPhoto(
  ctx: WriteContext,
  accessToken: string,
  locationName: string,
  photo: { id: string; url: string },
  accountId?: string,
) {
  return withLog(
    ctx,
    { action: 'add_media', location_name: locationName, target: null, before_value: null },
    () => createLocationMedia(accessToken, locationName, photo.url, accountId),
    (res: any) => ({ name: res?.name ?? null, photoId: photo.id }),
  );
}

/**
 * replyToReview. `previousReply` is the reply that was on the review before, if
 * the caller knows it (undefined = not known, null = there was none). A revert
 * restores it, or deletes the reply if there was none.
 */
export async function loggedReplyToReview(
  ctx: WriteContext,
  accessToken: string,
  reviewName: string,
  comment: string,
  previousReply?: string | null,
) {
  return withLog(
    ctx,
    {
      action: 'reply_review',
      location_name: locationFromResourceName(reviewName),
      target: reviewName,
      before_value: { known: previousReply !== undefined, comment: previousReply ?? null },
    },
    () => replyToReview(accessToken, reviewName, comment),
    () => ({ comment }),
  );
}

/** A change_log row as the revert planner needs it. */
export interface ChangeRow {
  id: string;
  action: ChangeAction;
  location_name: string;
  target: string | null;
  before_value: any;
  after_value: any;
  status: 'pending' | 'applied' | 'failed';
  reverted_at: string | null;
}

export type RevertStep =
  | { kind: 'restore_fields'; changeId: string; locationName: string; updateMask: string; body: Record<string, unknown> }
  | { kind: 'delete_post'; changeId: string; postName: string }
  | { kind: 'delete_media'; changeId: string; mediaName: string }
  | { kind: 'restore_reply'; changeId: string; reviewName: string; comment: string }
  | { kind: 'delete_reply'; changeId: string; reviewName: string }
  | { kind: 'skip'; changeId: string; reason: string };

/**
 * Turn one logged change into the write that undoes it. Pure, so it is fully
 * testable without touching Google.
 *
 * For update_location the body holds exactly the before-values, sent with the
 * original update mask. A field absent from before_value is in the mask but not
 * the body, which is how the Business Profile API is told to clear it: the
 * listing goes back to having nothing there, as it did before.
 */
export function planRevert(row: ChangeRow): RevertStep {
  if (row.reverted_at) return { kind: 'skip', changeId: row.id, reason: 'already reverted' };
  if (row.status === 'failed') return { kind: 'skip', changeId: row.id, reason: 'the original write failed, nothing to undo' };

  switch (row.action) {
    case 'update_location': {
      if (!row.target) return { kind: 'skip', changeId: row.id, reason: 'no update mask recorded' };
      const fields = maskFields(row.target);
      return {
        kind: 'restore_fields',
        changeId: row.id,
        locationName: row.location_name,
        updateMask: fields.join(','),
        body: pickFields(row.before_value ?? {}, fields),
      };
    }
    case 'create_post': {
      const name = row.after_value?.name;
      if (!name) return { kind: 'skip', changeId: row.id, reason: 'post name not recorded (the write may not have completed)' };
      return { kind: 'delete_post', changeId: row.id, postName: name };
    }
    case 'add_media': {
      const name = row.after_value?.name;
      if (!name) return { kind: 'skip', changeId: row.id, reason: 'photo name not recorded (the write may not have completed)' };
      return { kind: 'delete_media', changeId: row.id, mediaName: name };
    }
    case 'reply_review': {
      if (!row.target) return { kind: 'skip', changeId: row.id, reason: 'review name not recorded' };
      if (!row.before_value?.known) return { kind: 'skip', changeId: row.id, reason: 'previous reply not known; check the review by hand' };
      const prev = row.before_value.comment;
      return prev
        ? { kind: 'restore_reply', changeId: row.id, reviewName: row.target, comment: prev }
        : { kind: 'delete_reply', changeId: row.id, reviewName: row.target };
    }
  }
}
