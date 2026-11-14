/**
 * Pilot tools: add a retailer, generate invite links in a batch, see who is live.
 *
 * GENERATE ONLY. Nothing here sends anything. Tarkett makes first contact with
 * every retailer (decided 2026-08-17; under PECR, Stellar has no lawful basis to
 * contact most of these businesses cold), so the links are handed to Liam or a
 * rep to pass on. Do not add a sender here: an automatic invite sender is the
 * one thing this pilot must not have.
 *
 * Pure functions plus one database helper with the client injected, so the
 * rules are tested without Supabase.
 */
import { timingSafeEqual } from 'crypto';
import { generateInviteToken, hashInviteToken, inviteExpiresAt, isInviteExpired, DEFAULT_TTL_DAYS } from './invite-token';
import { resolveAccess, type ManagedAccessRow } from './managed-access';

export const PILOT_TENANT_SLUG = 'stellar';
/** A batch larger than this is refused, so a mis-click cannot mint links for the whole network. */
export const MAX_INVITE_BATCH = 25;
/** retailers.source for rows added through the admin page rather than the store-locator import. */
export const MANUAL_SOURCE = 'admin';

/** Same check as /api/admin (Bearer ADMIN_PASSWORD), but timing-safe. */
export function verifyAdminAuth(authorization: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  const given = (authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Adding a retailer ────────────────────────────────────────────────────────

export interface NewRetailerInput { name?: unknown; town?: unknown; contactEmail?: unknown }
export interface NewRetailer { name: string; town: string | null; contact_email: string | null }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateNewRetailer(input: NewRetailerInput): { ok: true; value: NewRetailer } | { ok: false; error: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const town = typeof input.town === 'string' ? input.town.trim() : '';
  const email = typeof input.contactEmail === 'string' ? input.contactEmail.trim().toLowerCase() : '';
  if (name.length < 2) return { ok: false, error: 'Shop name is required' };
  if (name.length > 120) return { ok: false, error: 'Shop name is too long' };
  if (town.length > 80) return { ok: false, error: 'Town is too long' };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'That email address does not look right' };
  return { ok: true, value: { name, town: town || null, contact_email: email || null } };
}

// ── Who is live ──────────────────────────────────────────────────────────────

export type PilotState = 'live' | 'connected_not_live' | 'invited' | 'invite_expired' | 'not_invited';

export interface PilotInvite { id: string; status: 'pending' | 'accepted' | 'revoked'; expires_at: string; created_at: string; accepted_at: string | null }
export interface PilotUser extends ManagedAccessRow {
  created_at?: string | null;
  onboarding_step?: string | null;
  profiles?: Array<{ google_location_name: string | null }> | null;
}

/**
 * Where one retailer is in the pilot.
 *
 * LIVE means what the billing definition needs: the retailer is linked to an
 * account, we hold working Google access for it (their own, or manager access),
 * and a listing is bound, so the scheduled jobs will actually act on it.
 * Anything short of that is "connected, not live", with the reason, because a
 * retailer who signed in but whose access failed must not be billed or counted.
 */
export function pilotStatus(
  retailer: { user_id: string | null },
  user: PilotUser | null,
  invites: PilotInvite[],
  now: Date = new Date(),
): { state: PilotState; detail: string } {
  if (retailer.user_id) {
    if (!user) return { state: 'connected_not_live', detail: 'linked account not found' };
    const access = resolveAccess(user);
    if (!access.ok) return { state: 'connected_not_live', detail: `no working Google access: ${access.reason}` };
    const bound = (user.profiles || []).some((p) => !!p.google_location_name);
    if (!bound) return { state: 'connected_not_live', detail: 'signed in, but no listing chosen yet' };
    return { state: 'live', detail: access.via === 'manager' ? 'live (manager access)' : 'live' };
  }
  const pending = invites
    .filter((i) => i.status === 'pending')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (pending) {
    return isInviteExpired(pending.expires_at, now)
      ? { state: 'invite_expired', detail: `link expired ${pending.expires_at.slice(0, 10)}` }
      : { state: 'invited', detail: `link valid until ${pending.expires_at.slice(0, 10)}` };
  }
  return { state: 'not_invited', detail: 'no link yet' };
}

// ── Generating invite links ──────────────────────────────────────────────────

export interface InviteDb { from(table: string): any }

export interface MintResult {
  retailerId: string;
  name?: string;
  ok: boolean;
  link?: string;
  expiresAt?: string;
  error?: string;
}

/**
 * Mint one invite link per retailer. Generate only: nothing is sent, and the
 * link is returned exactly once (only its hash is stored).
 *
 * Same rules as scripts/mint-invite.ts: a retailer already linked to an account
 * gets nothing, and a retailer with a pending, unexpired link gets nothing
 * (revoke it first). An expired pending link is revoked automatically, because
 * it can no longer be used and a fresh one is what the rep needs.
 */
export async function mintInvites(
  db: InviteDb,
  retailerIds: string[],
  appUrl: string,
  now: Date = new Date(),
  ttlDays: number = DEFAULT_TTL_DAYS,
): Promise<MintResult[]> {
  const ids = Array.from(new Set(retailerIds.filter((x) => typeof x === 'string' && x)));
  if (ids.length === 0) return [];
  if (ids.length > MAX_INVITE_BATCH) throw new Error(`At most ${MAX_INVITE_BATCH} links at a time`);

  const results: MintResult[] = [];
  for (const id of ids) {
    const { data: r, error } = await db.from('retailers').select('id, tenant_id, name, contact_email, user_id').eq('id', id).single();
    if (error || !r) { results.push({ retailerId: id, ok: false, error: 'retailer not found' }); continue; }
    if (r.user_id) { results.push({ retailerId: id, name: r.name, ok: false, error: 'already connected, no link needed' }); continue; }

    const { data: pending } = await db.from('retailer_invites').select('id, expires_at').eq('retailer_id', id).eq('status', 'pending');
    const live = (pending || []).filter((p: any) => !isInviteExpired(p.expires_at, now));
    if (live.length) {
      results.push({ retailerId: id, name: r.name, ok: false, error: `already has a valid link (until ${String(live[0].expires_at).slice(0, 10)}); revoke it first` });
      continue;
    }
    for (const p of pending || []) {
      await db.from('retailer_invites').update({ status: 'revoked', updated_at: now.toISOString() }).eq('id', p.id).eq('status', 'pending');
    }

    const token = generateInviteToken();
    const expiresAt = inviteExpiresAt(now, ttlDays).toISOString();
    const { error: insertError } = await db.from('retailer_invites').insert({
      retailer_id: r.id,
      tenant_id: r.tenant_id,
      email: r.contact_email ?? 'unknown@invalid.example',
      token_hash: hashInviteToken(token),
      status: 'pending',
      expires_at: expiresAt,
      // sent_at stays null: we never send. The rep or Tarkett passes the link on.
    });
    if (insertError) { results.push({ retailerId: id, name: r.name, ok: false, error: `could not save: ${insertError.message}` }); continue; }
    results.push({ retailerId: id, name: r.name, ok: true, link: `${appUrl}/invite/${token}`, expiresAt });
  }
  return results;
}

/**
 * Validate an ad start date from the admin page. Returns the ISO date, null to
 * clear it, or undefined if it is not a real calendar date. Dates more than a
 * year either side of today are refused as typos.
 */
export function parseAdStartDate(input: unknown, now: Date = new Date()): string | null | undefined {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  const d = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input) return undefined;
  if (Math.abs(d.getTime() - now.getTime()) > 366 * 86_400_000) return undefined;
  return input;
}
