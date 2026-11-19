/**
 * The retention view: which shops are using the service and which are not, so
 * a person can help the ones that are not.
 *
 * For the person running the service, in /admin/pilot. OFF unless
 * RETENTION_VIEW=on. It reads; the only thing it ever writes is one "last
 * opened the dashboard" timestamp per account (also only while the flag is on).
 * It sends nothing to anyone, and its export carries no contact details.
 *
 * A signal is a plain, checkable fact about one shop, not a score: "invited 12
 * days ago, not connected", "nothing switched on". The risk level is just how
 * many of them there are and how serious, so it can be argued with.
 *
 * Pure: takes facts, returns signals.
 */
export function retentionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.RETENTION_VIEW || '').trim().toLowerCase() === 'on';
}

export interface RetentionFacts {
  connected: boolean;
  live: boolean;
  /** The plain status label from lib/shop-status.ts ("Check listing", "Connection lost"...). */
  statusLabel: string;
  /** The status key from lib/shop-status.ts, when known. */
  statusKey?: string;
  invited: boolean;
  daysSinceInvited: number | null;
  daysSinceJoined: number | null;
  /** Days since the dashboard was last opened; null if never recorded. */
  daysSinceSeen: number | null;
  /** Days since visits began to be recorded at all; null if they never have been. */
  daysRecording: number | null;
  /** Looked after by an operator account: the shop is not expected to sign in, so visits say nothing. */
  managed: boolean;
  postsOn: boolean;
  repliesOn: boolean;
  scoreAtStart: number | null;
  scoreNow: number | null;
  /** Changes to the listing that went through (suggestions taken, hours set...). */
  changesMade: number;
}

export type SignalKey = 'not_connected' | 'held' | 'never_opened' | 'gone_quiet' | 'nothing_on' | 'no_suggestions_taken' | 'no_improvement';
export interface Signal { key: SignalKey; label: string; serious: boolean }
export type Risk = 'high' | 'some' | 'none';

export const THRESHOLDS = { notConnectedDays: 7, notConnectedSeriousDays: 14, neverOpenedDays: 7, quietDays: 30, noSuggestionsDays: 14, noImprovementDays: 30 } as const;

export function retentionSignals(f: RetentionFacts): { signals: Signal[]; risk: Risk } {
  const out: Signal[] = [];
  const T = THRESHOLDS;
  if (!f.connected) {
    if (f.invited && f.daysSinceInvited !== null && f.daysSinceInvited >= T.notConnectedDays) {
      out.push({ key: 'not_connected', label: `Invited ${f.daysSinceInvited} days ago, not connected (${f.statusLabel.toLowerCase()})`, serious: f.daysSinceInvited >= T.notConnectedSeriousDays });
    }
    return finish(out);
  }
  // "Nothing switched on" is its own signal below, so it is not also listed here.
  if (!f.live && f.statusKey !== 'nothing_on') out.push({ key: 'held', label: `Connected but not live: ${f.statusLabel.toLowerCase()}`, serious: true });
  const joined = f.daysSinceJoined ?? 0;
  // Visits only mean something for a shop that signs in itself, and "never"
  // only once visits have been recorded for long enough to have seen one.
  const watched = Math.min(joined, f.daysRecording ?? 0);
  if (f.managed) { /* no dashboard signal */ }
  else if (f.daysSinceSeen === null) {
    if (watched >= T.neverOpenedDays) out.push({ key: 'never_opened', label: `Has not opened its dashboard in the ${watched} days visits have been recorded`, serious: false });
  } else if (f.daysSinceSeen >= T.quietDays) {
    out.push({ key: 'gone_quiet', label: `Has not opened its dashboard for ${f.daysSinceSeen} days`, serious: false });
  }
  if (!f.postsOn && !f.repliesOn) out.push({ key: 'nothing_on', label: 'Nothing switched on: no posts, no replies', serious: joined >= T.noSuggestionsDays });
  if (f.changesMade === 0 && joined >= T.noSuggestionsDays) out.push({ key: 'no_suggestions_taken', label: 'Has not taken any suggestion for its listing', serious: false });
  if (joined >= T.noImprovementDays && f.scoreAtStart !== null && f.scoreNow !== null && f.scoreNow <= f.scoreAtStart) {
    out.push({ key: 'no_improvement', label: `Score has not improved (${f.scoreAtStart} when it joined, ${f.scoreNow} now)`, serious: false });
  }
  return finish(out);
}

function finish(signals: Signal[]): { signals: Signal[]; risk: Risk } {
  const serious = signals.filter((s) => s.serious).length;
  return { signals, risk: serious > 0 || signals.length >= 3 ? 'high' : signals.length > 0 ? 'some' : 'none' };
}

export interface RetentionRow { name: string; town: string | null; status: string; joinedOn: string | null; lastSeenOn: string | null; postsOn: boolean; repliesOn: boolean; scoreAtStart: number | null; scoreNow: number | null; changesMade: number; signals: string[]; risk: Risk }

const cell = (v: unknown) => { const t = String(v ?? ''); const risky = /^[\s]*[=+\-@]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t); return risky || /[",\n\r\t]/.test(t) ? `"${(risky ? `'${t}` : t).replace(/"/g, '""')}"` : t; };

/** The view as a file. Shop name, town and facts only: no email address, no phone number. Pure. */
export function retentionCsv(rows: RetentionRow[]): string {
  const head = ['Shop', 'Town', 'Status', 'Joined', 'Dashboard last opened', 'Posts on', 'Replies on', 'Score at start', 'Score now', 'Changes made', 'At risk', 'Why'];
  const body = rows.map((r) => [r.name, r.town ?? '', r.status, r.joinedOn ?? '', r.lastSeenOn ?? '', r.postsOn ? 'yes' : 'no', r.repliesOn ? 'yes' : 'no', r.scoreAtStart ?? '', r.scoreNow ?? '', r.changesMade, r.risk === 'none' ? '' : r.risk, r.signals.join('; ')]);
  return [head, ...body].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** Most at risk first, then by name. Pure. */
export function retentionOrder<T extends { risk: Risk; signals: unknown[]; name: string }>(rows: T[]): T[] {
  const rank = { high: 0, some: 1, none: 2 } as const;
  return [...rows].sort((a, b) => rank[a.risk] - rank[b.risk] || b.signals.length - a.signals.length || a.name.localeCompare(b.name));
}
