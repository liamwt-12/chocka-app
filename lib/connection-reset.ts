/**
 * Undoing a connection that went to the wrong Google account.
 *
 * WHAT WAS WRONG. A shop that signed in with the wrong Google account (a
 * personal Gmail, say) was tied to that account for good. Signing in again with
 * the right one was refused as "invite-only", and the original link said it had
 * "already been used". The only way out was editing the database by hand.
 *
 * Two ways out now, both through here:
 *
 *   releaseStaleClaim   automatic. When someone arrives through a shop's own
 *                       invite and the shop is held by an account that never
 *                       got as far as a listing, that half-made account is
 *                       removed and the newcomer carries on. It only ever
 *                       removes an account with NO listing bound, so it cannot
 *                       take a working connection away from anyone.
 *
 *   resetConnection     deliberate, from /admin/pilot. Removes whatever account
 *                       holds the shop, working or not, and re-opens the shop's
 *                       link so it can connect again.
 *
 * In both cases the Google permission the old account gave is handed back to
 * Google (best effort), the shop's own record is kept, and its link works again.
 */
import { decryptSecret, userTokenAad } from './secrets';
import { inviteExpiresAt, isInviteExpired, DEFAULT_TTL_DAYS } from './invite-token';

export interface ResetDb { from(table: string): any }

export interface ResetResult {
  ok: boolean;
  /** Was there an account to remove? */
  removedAccount: boolean;
  /** Can the shop use the link it already has? If not, generate a new one. */
  linkReusable: boolean;
  detail: string;
}

async function revokeAtGoogle(user: { id: string; google_refresh_token?: string | null }, fetchImpl: typeof fetch): Promise<void> {
  if (!user.google_refresh_token) return;
  try {
    const token = decryptSecret(user.google_refresh_token, userTokenAad(user.id));
    await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch (err) {
    // The account is removed either way; the shop can also remove us in Google.
    console.error(`[reset] could not hand back the Google permission for user ${user.id}:`, String((err as any)?.message).slice(0, 160));
  }
}

/** Re-open the shop's most recent link. Returns whether a usable one exists afterwards. */
async function reopenInvite(db: ResetDb, retailerId: string, now: Date): Promise<boolean> {
  const { data: invites } = await db.from('retailer_invites').select('id, status, expires_at, created_at').eq('retailer_id', retailerId).order('created_at', { ascending: false });
  const list: any[] = invites || [];
  // A pending link already exists (only one can): it just needs to be in date.
  const target = list.find((i) => i.status === 'pending') ?? list.find((i) => i.status === 'accepted');
  if (!target) return false;
  const patch: Record<string, unknown> = { status: 'pending', user_id: null, updated_at: now.toISOString() };
  if (isInviteExpired(target.expires_at, now)) patch.expires_at = inviteExpiresAt(now, DEFAULT_TTL_DAYS).toISOString();
  const { error } = await db.from('retailer_invites').update(patch).eq('id', target.id);
  if (error) { console.error(`[reset] could not re-open invite ${target.id}: ${error.message}`); return false; }
  return true;
}

async function removeAccount(db: ResetDb, retailerId: string, userId: string, why: string, now: Date, fetchImpl: typeof fetch): Promise<ResetResult> {
  const { data: user } = await db.from('users').select('id, google_refresh_token').eq('id', userId).maybeSingle();
  if (user) await revokeAtGoogle(user, fetchImpl);
  // Unlink first, so the shop is free even if the delete below fails.
  const { error: unlinkError } = await db.from('retailers')
    .update({ user_id: null, connection_status: 'invited', connection_detail: why.slice(0, 500), connection_checked_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', retailerId).eq('user_id', userId);
  if (unlinkError) return { ok: false, removedAccount: false, linkReusable: false, detail: `could not free the shop: ${unlinkError.message}` };
  if (user) {
    const { error: delError } = await db.from('users').delete().eq('id', userId);
    if (delError) console.error(`[reset] shop ${retailerId} freed, but account ${userId} could not be deleted: ${delError.message}`);
  }
  const linkReusable = await reopenInvite(db, retailerId, now);
  return { ok: true, removedAccount: !!user, linkReusable, detail: why };
}

/**
 * If the shop is held by an account that never bound a listing, remove that
 * account. Returns true if the shop is free afterwards (including when it was
 * free all along). Never removes an account that has a listing.
 */
export async function releaseStaleClaim(db: ResetDb, retailerId: string, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const { data: retailer } = await db.from('retailers').select('id, user_id').eq('id', retailerId).maybeSingle();
  if (!retailer) return false;
  if (!retailer.user_id) {
    // Free, but its link may still be marked used by an account since deleted.
    await reopenInvite(db, retailerId, now);
    return true;
  }
  const { data: profile } = await db.from('profiles').select('id, google_location_name').eq('user_id', retailer.user_id).maybeSingle();
  if (profile?.google_location_name) return false; // a real connection: only a person may reset it
  const r = await removeAccount(db, retailerId, retailer.user_id, 'an earlier sign-in with a Google account that had no listing was cleared automatically', now, fetchImpl);
  if (r.ok) console.log(`[reset] cleared a half-made account so shop ${retailerId} can connect again`);
  return r.ok;
}

/** Support pressed "Reset connection" for this shop. */
export async function resetConnection(db: ResetDb, retailerId: string, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<ResetResult> {
  const { data: retailer } = await db.from('retailers').select('id, user_id').eq('id', retailerId).maybeSingle();
  if (!retailer) return { ok: false, removedAccount: false, linkReusable: false, detail: 'shop not found' };
  if (!retailer.user_id) {
    const linkReusable = await reopenInvite(db, retailerId, now);
    await db.from('retailers').update({ connection_status: 'invited', connection_detail: 'connection reset by support; nothing was connected', connection_checked_at: now.toISOString() }).eq('id', retailerId);
    return { ok: true, removedAccount: false, linkReusable, detail: 'nothing was connected' };
  }
  return removeAccount(db, retailerId, retailer.user_id, 'connection reset by support', now, fetchImpl);
}
