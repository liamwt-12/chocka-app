/**
 * Loads the facts for the retention view (lib/retention.ts) for one tenant.
 * Reads only. Never selects an email address or a phone number.
 */
import { MANAGER_EMBED } from './managed-access';
import { shopStatus, liveRulesFromEnv } from './shop-status';
import { retentionSignals, retentionOrder, type RetentionRow } from './retention';

const DAY = 86400000;
const daysSince = (iso: string | null | undefined, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY)) : null);

export async function loadRetention(db: { from(table: string): any }, tenantId: string, now: Date = new Date()): Promise<{ rows: RetentionRow[]; counts: { high: number; some: number; none: number } }> {
  const { data: retailers, error } = await db.from('retailers')
    .select('id, name, town, user_id, place_id, delisted_at, created_at, connection_status, connection_detail, connection_checked_at, connect_issue, connect_issue_at, invite_bounced_at, listing_confirmed_at')
    .eq('tenant_id', tenantId).is('delisted_at', null).order('name');
  if (error) throw error;
  const shops = retailers || [];
  const ids = shops.map((r: any) => r.id);
  const userIds = shops.map((r: any) => r.user_id).filter(Boolean);

  const { data: invites } = ids.length ? await db.from('retailer_invites').select('id, retailer_id, status, expires_at, created_at, accepted_at, opened_at').in('retailer_id', ids) : { data: [] };
  // Tokens are read only to decide whether access works, and never leave this function.
  const { data: users } = userIds.length
    ? await db.from('users').select(`id, created_at, last_seen_at, onboarding_step, auto_post_enabled, auto_reply_enabled, google_refresh_token, token_status, token_invalid_at, managed_by_user_id, ${MANAGER_EMBED}, profiles ( id, google_location_name, google_place_id, audit_score, audit_score_after )`).in('id', userIds)
    : { data: [] };
  const userById = new Map<string, any>((users || []).map((u: any) => [u.id, u]));

  const profileIds = (users || []).map((u: any) => u.profiles?.[0]?.id).filter(Boolean);
  const changes = new Map<string, number>();
  if (profileIds.length) {
    const { data: log } = await db.from('change_log').select('profile_id').in('profile_id', profileIds).eq('action', 'update_location').eq('status', 'applied').neq('source', 'revert').is('reverted_at', null);
    for (const c of log || []) changes.set(c.profile_id, (changes.get(c.profile_id) || 0) + 1);
  }

  const rules = liveRulesFromEnv();
  const rows: RetentionRow[] = shops.map((r: any) => {
    const user = r.user_id ? userById.get(r.user_id) ?? null : null;
    const mine = (invites || []).filter((i: any) => i.retailer_id === r.id);
    const status = shopStatus(r, user, mine, now, rules);
    const profile = user?.profiles?.[0] ?? null;
    const firstInvite = mine.map((i: any) => i.created_at).sort()[0] ?? null;
    const made = profile ? changes.get(profile.id) || 0 : 0;
    const { signals, risk } = retentionSignals({
      connected: status.connected, live: status.live, statusLabel: status.label,
      invited: mine.length > 0, daysSinceInvited: daysSince(firstInvite, now), daysSinceJoined: daysSince(user?.created_at, now), daysSinceSeen: daysSince(user?.last_seen_at, now),
      postsOn: !!user?.auto_post_enabled, repliesOn: !!user?.auto_reply_enabled,
      scoreAtStart: profile?.audit_score ?? null, scoreNow: profile?.audit_score_after ?? null, changesMade: made,
    });
    return {
      name: r.name, town: r.town ?? null, status: status.label,
      joinedOn: user?.created_at ? String(user.created_at).slice(0, 10) : null, lastSeenOn: user?.last_seen_at ? String(user.last_seen_at).slice(0, 10) : null,
      postsOn: !!user?.auto_post_enabled, repliesOn: !!user?.auto_reply_enabled,
      scoreAtStart: profile?.audit_score ?? null, scoreNow: profile?.audit_score_after ?? null, changesMade: made,
      signals: signals.map((s) => s.label), risk,
    };
  });
  const ordered = retentionOrder(rows);
  return { rows: ordered, counts: { high: rows.filter((r) => r.risk === 'high').length, some: rows.filter((r) => r.risk === 'some').length, none: rows.filter((r) => r.risk === 'none').length } };
}

/** Stamp "opened the dashboard", at most once an hour, only while the view is on. Never throws. */
export async function markSeen(db: { from(table: string): any }, user: { id: string; last_seen_at?: string | null }, now: Date = new Date()): Promise<void> {
  try {
    if (user.last_seen_at && now.getTime() - new Date(user.last_seen_at).getTime() < 3600000) return;
    await db.from('users').update({ last_seen_at: now.toISOString() }).eq('id', user.id);
  } catch { /* a missed stamp is not worth failing a dashboard for */ }
}
