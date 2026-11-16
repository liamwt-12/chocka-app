/**
 * Putting one change back, for the Undo button in /admin/pilot and for the
 * command-line script (scripts/revert-listing-change.ts). One implementation,
 * so the button and the script cannot drift apart.
 *
 * Every change the app makes to a listing is logged with what it replaced
 * (lib/change-log.ts). Undoing reads that record and writes the old value back:
 *
 *   a field (description, services, categories, hours, website, holiday hours)
 *       -> the old value is written back; a field that was empty is cleared
 *   a post      -> the post is deleted
 *   a reply     -> the earlier reply is restored, or ours is deleted if there was none
 *   a photo     -> the photo is removed from the listing
 *
 * The undo is itself logged, and for a field it is read back from Google and
 * only reported as done if Google now holds the old value. A customer's review
 * is never touched: nobody but Google can remove one.
 *
 * It refuses, in plain words, when there is nothing safe to do: already
 * undone, the original write failed, the earlier reply is not known, or the
 * field has been changed again since (undoing would throw away a later edit).
 */
import * as google from './google';
import { planRevert, loggedUpdateLocation, loggedReplyToReview, maskFields, pickFields, type ChangeRow, type RevertStep } from './change-log';
import { resolveAccess, MANAGER_EMBED } from './managed-access';
import { decryptSecret, userTokenAad } from './secrets';
import { fromGooglePeriods, describeHours } from './opening-hours';

export interface RevertDb { from(table: string): any }
export interface UndoResult { ok: boolean; message: string; detail?: string }
type Row = ChangeRow & { profile_id: string | null; user_id?: string | null; created_at: string; source: string };

const FIELD_NAMES: Record<string, string> = { profile: 'Description', serviceItems: 'Services', categories: 'Categories', regularHours: 'Opening hours', specialHours: 'Holiday hours', websiteUri: 'Website' };

/** What a logged value was, in a few words a person can check against the listing. Pure. */
export function summarise(field: string, value: any): string {
  const v = value?.[field];
  if (v === undefined || v === null) return 'nothing';
  switch (field) {
    case 'profile': { const d = String(v.description || ''); return d ? `"${d.slice(0, 90)}${d.length > 90 ? '…' : ''}"` : 'nothing'; }
    case 'serviceItems': { const n = (v as any[]).map((s) => s?.freeFormServiceItem?.label?.displayName || s?.structuredServiceItem?.description).filter(Boolean); return n.length ? `${n.length} services: ${n.slice(0, 6).join(', ')}${n.length > 6 ? '…' : ''}` : 'no services'; }
    case 'categories': { const extra = (v.additionalCategories || []).length; return `main category${extra ? ` plus ${extra} more` : ' only'}`; }
    case 'regularHours': { const r = fromGooglePeriods(v.periods); return r.daysSet ? describeHours(r.draft).filter((l) => !l.endsWith('closed')).join('; ') : 'no hours'; }
    case 'specialHours': { const n = (v.specialHourPeriods || []).length; return n ? `${n} holiday date${n === 1 ? '' : 's'}` : 'none'; }
    case 'websiteUri': return String(v);
    default: return JSON.stringify(v).slice(0, 90);
  }
}

export interface ChangeView { id: string; when: string; what: string; before: string; after: string; source: string; status: string; undone: boolean; canUndo: boolean; whyNot: string | null }

/** One logged change, described for the admin page. Pure. */
export function describeChange(row: Row): ChangeView {
  const step = planRevert(row);
  let what = 'Change', before = '', after = '';
  if (row.action === 'update_location') {
    const fields = maskFields(row.target || '');
    what = fields.map((f) => FIELD_NAMES[f] || f).join(', ');
    before = fields.map((f) => summarise(f, row.before_value)).join(' | ');
    after = fields.map((f) => summarise(f, row.after_value)).join(' | ');
  } else if (row.action === 'create_post') { what = 'Post published'; before = 'no post'; after = `"${String(row.after_value?.summary || '').slice(0, 90)}"`; }
  else if (row.action === 'reply_review') { what = 'Reply to a review'; before = row.before_value?.known ? (row.before_value.comment ? `"${String(row.before_value.comment).slice(0, 90)}"` : 'no reply') : 'not known'; after = `"${String(row.after_value?.comment || '').slice(0, 90)}"`; }
  else if (row.action === 'add_media') { what = 'Photo added to the listing'; before = 'no photo'; after = 'photo'; }
  const undone = !!row.reverted_at;
  const whyNot = row.source === 'revert' ? 'This is itself an undo.' : step.kind === 'skip' ? plainSkip(step.reason) : null;
  return { id: row.id, when: row.created_at, what, before, after, source: row.source, status: row.status, undone, canUndo: !whyNot, whyNot };
}

function plainSkip(reason: string): string {
  if (/already reverted/.test(reason)) return 'Already undone.';
  if (/original write failed/.test(reason)) return 'The change never went through, so there is nothing to undo.';
  if (/previous reply not known/.test(reason)) return 'We do not know what reply was there before, so this one has to be checked by hand in Google.';
  return 'There is not enough on record to undo this safely. Check the listing by hand in Google.';
}

/**
 * The same value, whatever order its keys come in. The database stores a
 * logged value with its keys reordered, and Google returns them in its own
 * order, so comparing the text of the two would call identical values
 * different (found by the staging run: an undo was refused as "changed since"
 * when nothing had changed).
 */
const canon = (v: unknown): string => JSON.stringify(v ?? null, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as any)[k]])) : x));
export const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/**
 * Undo one logged change. `confirm: false` only says what would happen.
 * Never throws; the result says what happened in words for support.
 */
export async function undoChange(db: RevertDb, changeId: string, opts: { confirm?: boolean; g?: typeof google; allowLaterEdits?: boolean } = {}): Promise<UndoResult> {
  const g = opts.g ?? google;
  try {
    const { data: row } = await db.from('change_log').select('*').eq('id', changeId).maybeSingle();
    if (!row) return { ok: false, message: 'That change could not be found.' };
    const view = describeChange(row as Row);
    if (!view.canUndo) return { ok: false, message: view.whyNot || 'This change cannot be undone.' };
    const step: RevertStep = planRevert(row as ChangeRow);
    if (!row.profile_id) return { ok: false, message: 'The account this change was made for has since been removed, so we no longer have access to the listing. Change it by hand in Google.' };

    const { data: profile } = await db.from('profiles').select('id, user_id').eq('id', row.profile_id).maybeSingle();
    const { data: user } = profile ? await db.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', profile.user_id).maybeSingle() : { data: null };
    const access = resolveAccess(user as any);
    if (!access.ok) return { ok: false, message: 'We have lost the connection to this shop\'s Google account, so nothing can be undone until it reconnects.' };

    let token: string;
    try { token = await g.refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId))); }
    catch (e) { return { ok: false, message: g.isDeadGrant(e) ? 'We have lost the connection to this shop\'s Google account, so nothing can be undone until it reconnects.' : 'Google did not answer. Try again in a minute.' }; }

    // A field changed again since (by us or by the shop in Google) is not put
    // back blindly: that would throw away the later edit.
    const changedSince = `${view.what} has been changed again since this was made, so undoing it would lose that later change. Look at the listing and undo the most recent change first.`;
    if (step.kind === 'restore_fields' && !opts.allowLaterEdits) {
      const fields = maskFields(step.updateMask);
      const now = pickFields(await g.getLocationFields(token, step.locationName, fields), fields);
      if (row.status === 'pending') {
        // We never recorded how this change ended. If the listing still holds
        // what was there before, there is nothing to undo; otherwise we cannot
        // tell our change from someone else's, and a person has to look.
        if (!same(now, pickFields(row.before_value ?? {}, fields))) return { ok: false, message: `We do not have a complete record of this change, and ${view.what.toLowerCase()} is not what it was before it. Check the listing in Google before putting anything back.` };
      } else if (!same(now, pickFields(row.after_value ?? {}, fields))) {
        // Compared even when what we wrote was "nothing" (a field we cleared):
        // if it has something in it now, that is a later change.
        return { ok: false, message: changedSince };
      }
    }
    // A reply is only ever removed or replaced if it is still the one WE wrote.
    // If the shop has since rewritten it in its own words, it is left alone.
    let reviewNow: any = null;
    if (step.kind === 'delete_reply' || step.kind === 'restore_reply') {
      const account = /^(accounts\/[^/]+)\//.exec(step.reviewName)?.[1];
      const reviews = (await g.getReviews(token, row.location_name, account)).reviews || [];
      reviewNow = reviews.find((r: any) => r.name === step.reviewName) ?? null;
      const current = String(reviewNow?.reviewReply?.comment ?? '').trim();
      const ours = String(row.after_value?.comment ?? '').trim();
      if (!reviewNow) return { ok: false, message: 'That review is no longer on the listing, so there is nothing to undo.' };
      if (!current) return { ok: false, message: 'There is no reply on that review any more, so there is nothing to undo.' };
      if (!opts.allowLaterEdits && (!ours || current !== ours)) return { ok: false, message: 'The reply on that review is not the one we wrote: it has been changed since, so we have left it alone.' };
    }
    if (!opts.confirm) return { ok: true, message: `Would put ${view.what.toLowerCase()} back to: ${view.before}.` };

    const ctx = { db: db as any, source: 'revert' as const, userId: user!.id, profileId: row.profile_id };
    let revertId: string | null = null;
    if (step.kind === 'restore_fields') {
      await loggedUpdateLocation(ctx, token, step.locationName, step.updateMask, step.body);
      const fields = maskFields(step.updateMask);
      const after = pickFields(await g.getLocationFields(token, step.locationName, fields), fields);
      if (!same(after, step.body)) return { ok: false, message: `We sent the old ${view.what.toLowerCase()} back, but Google is not showing it. Check the listing in Google.` };
    } else if (step.kind === 'restore_reply') {
      await loggedReplyToReview(ctx, token, step.reviewName, step.comment);
    } else if (step.kind === 'delete_post') { await g.deleteLocalPost(token, step.postName); }
    else if (step.kind === 'delete_reply') { await g.deleteReviewReply(token, step.reviewName); }
    else if (step.kind === 'delete_media') { await g.deleteLocationMedia(token, step.mediaName); }

    if (step.kind === 'delete_post' || step.kind === 'delete_reply' || step.kind === 'delete_media') {
      // Deletions are recorded here; restores were recorded by the logged* call above.
      const target = step.kind === 'delete_post' ? step.postName : step.kind === 'delete_media' ? step.mediaName : step.reviewName;
      const { data } = await db.from('change_log').insert({ user_id: user!.id, profile_id: row.profile_id, location_name: row.location_name, source: 'revert', action: row.action, target, before_value: row.after_value, after_value: null, status: 'applied' }).select('id').single();
      revertId = data?.id ?? null;
      // Our own record of a reply we have just removed, so the daily check does not think it is still answered.
      if (step.kind === 'delete_reply') await db.from('reviews').update({ reply_content: null }).eq('profile_id', row.profile_id).eq('google_review_id', step.reviewName.split('/reviews/')[1] || '');
    } else {
      const { data } = await db.from('change_log').select('id').eq('source', 'revert').eq('location_name', row.location_name).order('created_at', { ascending: false }).limit(1).maybeSingle();
      revertId = data?.id ?? null;
    }
    const { error: stampError } = await db.from('change_log').update({ reverted_at: new Date().toISOString(), reverted_by_change_id: revertId }).eq('id', row.id);
    if (stampError) console.error(`[revert] undone on Google, but change ${row.id} could not be marked as undone: ${stampError.message}`);
    // Only say "checked" for what was read back.
    if (step.kind === 'delete_reply' || step.kind === 'restore_reply') {
      const account = /^(accounts\/[^/]+)\//.exec(step.reviewName)?.[1];
      const after = ((await g.getReviews(token, row.location_name, account)).reviews || []).find((r: any) => r.name === step.reviewName);
      const now = String(after?.reviewReply?.comment ?? '').trim();
      const want = step.kind === 'restore_reply' ? step.comment.trim() : '';
      if (now !== want) return { ok: false, message: 'We asked Google to put the reply back, but the review does not show it yet. Check the review in Google.' };
      return { ok: true, message: `${view.what} put back to: ${view.before}. Checked on Google.` };
    }
    if (step.kind === 'restore_fields') return { ok: true, message: `${view.what} put back to: ${view.before}. Checked on Google.` };
    return { ok: true, message: `${view.what}: removed from the listing.` };
  } catch (e) {
    const raw = String((e as any)?.message ?? e).replace(/\s+/g, ' ').slice(0, 300);
    console.error(`[revert] change ${changeId}: ${raw}`);
    return { ok: false, message: 'Google did not accept the undo. Nothing may have changed: check the listing in Google.', detail: raw };
  }
}
