/**
 * What the Tarkett console shows. Read only, and only reachable through the
 * console API, which is behind the TARKETT_CONSOLE_ENABLED flag and the
 * funder login (lib/funder-auth.ts).
 *
 * WHAT IS SHOWN, per shop in Tarkett's network on Stellar:
 *   everyone:            name, town (Tarkett's own published data), where they are
 *                        in the pilot, and their Google connection status
 *   participating shops: presence score at activation, posts and replies in the
 *                        last 30 days, change in customer actions and views since
 *                        joining (percentages, as in the league), ad start date
 * WHAT IS NEVER SHOWN: contact details, phone numbers, review text, anything
 * about a shop's customers, and any score for a shop that has not joined.
 */
import { pilotStatus, type PilotInvite, type PilotUser } from './pilot';
import { ADMIN_LABELS, type ConnectionStatus } from './ownership';
import { MANAGER_EMBED } from './managed-access';
import { loadMetricRows, isoDate, type MetricRow } from './metrics';
import { buildLeague, leagueWindows, type LeagueEntry, type LeagueExcluded } from './league';

export interface ConsoleShop {
  retailerId: string;
  name: string;
  town: string | null;
  pilotState: string;
  connection: string | null;
  participating: boolean;
  joinedOn: string | null;
  scoreAtActivation: number | null;
  postsLast30: number | null;
  repliesLast30: number | null;
  actionsChange: number | null;
  viewsChange: number | null;
  improvement: string | null;
  adStartDate: string | null;
}

export interface ConsoleData {
  generatedAt: string;
  counts: Record<string, number>;
  shops: ConsoleShop[];
  league: { ranked: LeagueEntry[]; excluded: LeagueExcluded[] };
}

interface Db { from(table: string): any }

export async function loadConsoleData(db: Db, tenantId: string, now: Date = new Date()): Promise<ConsoleData> {
  const { data: retailers, error } = await db
    .from('retailers')
    .select('id, name, town, user_id, connection_status, ad_start_date')
    .eq('tenant_id', tenantId)
    .order('name');
  if (error) throw error;
  const rows = retailers || [];
  const ids = rows.map((r: any) => r.id);
  const userIds = rows.map((r: any) => r.user_id).filter(Boolean);

  const { data: invites } = ids.length
    ? await db.from('retailer_invites').select('id, retailer_id, status, expires_at, created_at, accepted_at').in('retailer_id', ids)
    : { data: [] };
  // Tokens are read only to decide whether access works. They never leave this function.
  const { data: users } = userIds.length
    ? await db.from('users')
        .select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}, profiles ( id, created_at, audit_score, google_location_name )`)
        .in('id', userIds)
    : { data: [] };
  const userById = new Map<string, any>((users || []).map((u: any) => [u.id, u]));

  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const leagueInputs: Parameters<typeof buildLeague>[0] = [];
  const shops: ConsoleShop[] = [];

  for (const r of rows) {
    const user: PilotUser | null = r.user_id ? userById.get(r.user_id) ?? null : null;
    const state = pilotStatus(r, user, (invites || []).filter((i: any) => i.retailer_id === r.id) as PilotInvite[], now).state;
    const profile = (user as any)?.profiles?.[0] ?? null;
    const participating = !!(r.user_id && profile);
    const shop: ConsoleShop = {
      retailerId: r.id, name: r.name, town: r.town, pilotState: state,
      connection: r.connection_status ? ADMIN_LABELS[r.connection_status as ConnectionStatus] ?? r.connection_status : null,
      participating, joinedOn: null, scoreAtActivation: null, postsLast30: null, repliesLast30: null,
      actionsChange: null, viewsChange: null, improvement: null, adStartDate: participating ? r.ad_start_date ?? null : null,
    };
    if (participating) {
      const joinedOn = isoDate(new Date(profile.created_at));
      shop.joinedOn = joinedOn;
      shop.scoreAtActivation = profile.audit_score ?? null;
      const { count: posts } = await db.from('scheduled_posts').select('id', { count: 'exact', head: true })
        .eq('profile_id', profile.id).eq('status', 'published').gte('published_at', since30);
      const { count: replies } = await db.from('review_replies').select('id, reviews!inner(profile_id)', { count: 'exact', head: true })
        .eq('reviews.profile_id', profile.id).eq('status', 'published').gte('published_at', since30);
      shop.postsLast30 = posts ?? 0;
      shop.repliesLast30 = replies ?? 0;
      const w = leagueWindows(joinedOn, now);
      const metricRows: MetricRow[] = await loadMetricRows(db, profile.id, w.baselineFrom, w.recentTo);
      leagueInputs.push({ retailerId: r.id, name: r.name, town: r.town, activatedOn: joinedOn, rows: metricRows });
    }
    shops.push(shop);
  }

  const league = buildLeague(leagueInputs, now);
  for (const e of league.ranked) {
    const s = shops.find((x) => x.retailerId === e.retailerId)!;
    s.actionsChange = e.actionsChange; s.viewsChange = e.viewsChange; s.improvement = e.band;
  }
  for (const e of league.excluded) {
    const s = shops.find((x) => x.retailerId === e.retailerId)!;
    s.improvement = `Too early: ${e.reason}`;
  }

  const counts = shops.reduce((acc: Record<string, number>, s) => { acc[s.pilotState] = (acc[s.pilotState] || 0) + 1; return acc; }, {});
  return { generatedAt: now.toISOString(), counts, shops, league };
}

/** Fields a console response must never contain, checked in tests. */
export const FORBIDDEN_CONSOLE_FIELDS = ['contact_email', 'contactEmail', 'email', 'phone', 'phone_number', 'google_refresh_token', 'comment', 'reviewer_name'];

