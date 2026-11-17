/**
 * Where one shop is, in one place.
 *
 * Three things used to answer this separately and disagreed: the admin page,
 * Tarkett's console, and (by hand) the invoice. A shop connected to the wrong
 * listing, or to one Google had not verified, read as "Live" in all of them.
 * Five different reasons for not having connected all read "Link issued".
 *
 * This module is the single definition. Everything that needs to know whether a
 * shop is live, or why it is not, asks here: /admin/pilot, the needs-help list,
 * the console, the monthly count of live shops.
 *
 * LIVE (which is also what is BILLABLE) means, by default, all four of:
 *   connected   the shop is linked to an account and a listing is bound
 *   matched     the listing is the one we invited, or a person has confirmed it
 *   verified    Google has verified the listing, so it can actually be managed
 *   access      our permission from Google still works
 * The last three can be relaxed with LIVE_REQUIRES (a comma-separated list of
 * the ones to keep: "matched,verified,access" is the default). "connected" is
 * not optional: without a bound listing there is nothing to be live.
 *
 * LIVE DOES NOT DEPEND ON WHAT THE SHOP HAS SWITCHED ON. A shop is billable
 * while it is connected to a verified listing we can reach. Switching posts
 * and replies off, or pressing Pause, does not stop that; only disconnecting
 * (or losing access) does. That was decided on 20 November 2026.
 *
 * A LIVE SHOP WITH NOTHING SWITCHED ON IS STILL SHOWN. It is live, and it is
 * also "quiet": its status says "Nothing switched on" or "Paused by the
 * shop", it is on the needs-help list and in the console, so a shop that is
 * being paid for and getting nothing is never invisible.
 *
 * Nothing here, and nothing that reads it, ever switches posts or replies on
 * for a shop.
 *
 * Pure: takes rows, returns a status. Tested without a database.
 */
import { resolveAccess, type ManagedAccessRow } from './managed-access';
import { isInviteExpired } from './invite-token';
import { HELP, type HelpReason } from './connect-help';
import { switchesInForce } from './automation-mode';

export interface LiveRules { matched: boolean; verified: boolean; access: boolean }
export const DEFAULT_LIVE_RULES: LiveRules = { matched: true, verified: true, access: true };

/** LIVE_REQUIRES="matched,verified,access" (the default). Unset means the default. */
export function liveRulesFromEnv(value: string | undefined = process.env.LIVE_REQUIRES): LiveRules {
  return parseLiveRequires(value).rules;
}

const LIVE_WORDS = ['matched', 'verified', 'access'] as const;
/**
 * Read LIVE_REQUIRES. A value containing anything that is not one of the four
 * words (a typo, a semicolon, quotation marks) is NOT trusted to relax the
 * definition: the full definition applies, and `problem` says why. Relaxing
 * what counts as live changes what is billed, so it must be spelt exactly.
 */
export function parseLiveRequires(value: string | undefined): { rules: LiveRules; problem: string | null } {
  if (value === undefined || value.trim() === '') return { rules: { ...DEFAULT_LIVE_RULES }, problem: null };
  const words = value.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = words.filter((w) => !(LIVE_WORDS as readonly string[]).includes(w));
  if (unknown.length || !words.length) return { rules: { ...DEFAULT_LIVE_RULES }, problem: `LIVE_REQUIRES contains something that is not one of ${LIVE_WORDS.join(', ')} (${unknown.join(', ').slice(0, 60) || 'nothing readable'}), so it has been ignored and the full definition applies.` };
  const keep = new Set(words);
  return { rules: { matched: keep.has('matched'), verified: keep.has('verified'), access: keep.has('access') }, problem: null };
}

/**
 * The columns of the account row that shopStatus reads. Every query that
 * feeds it selects these (there is a test), so "live" cannot quietly be
 * decided without knowing what the shop has switched on.
 */
export const STATUS_USER_COLUMNS = 'auto_post_enabled, auto_reply_enabled, automation_paused_at, automation_mode, automation_consent_at, automation_consent_version';

/** Is anything being done for this shop: posts or replies on, and not paused? */
export function isActive(user: Parameters<typeof switchesInForce>[0]): boolean {
  if (!user || user.automation_paused_at) return false;
  // The switches as the jobs read them (lib/automation-mode.ts): switches that
  // were only turned on by a hands-off choice that is not in force do not count.
  const on = switchesInForce(user);
  return on.posts || on.replies;
}

export type StatusKey =
  | 'live'
  // connected, but something stops it counting as live
  | 'access_lost' | 'check_listing' | 'waiting_google' | 'no_listing_chosen'
  // live, and nothing is being done for it
  | 'nothing_on' | 'paused'
  // not connected, and we know why
  | 'cancelled' | 'unticked' | 'no_listing' | 'wrong_account' | 'google_error' | 'bounced' | 'link_expired'
  // not connected, and all we know is how far it got
  | 'started' | 'opened' | 'not_opened' | 'not_invited';

export type HelpButton = 'new_link' | 'reset' | 'confirm_listing' | 'bounced' | 'not_bounced';

export interface ShopStatus {
  key: StatusKey;
  /** Short label for a list. */
  label: string;
  /** Live, which is also billable. Does not depend on what the shop has switched on. */
  live: boolean;
  /** Live, but nothing is being done for it: posts and replies both off, or paused. Shown, so it is never invisible. */
  quiet: boolean;
  connected: boolean;
  /** Should a person look at this now? */
  needsHelp: boolean;
  /** 1 = act today, 2 = act this week, 3 = just so you know. */
  severity: 1 | 2 | 3;
  /** What is going on, in a sentence anyone can read. */
  why: string;
  /** What whoever is helping should do. */
  action: string;
  /** When it got into this state, if known. */
  since: string | null;
  buttons: HelpButton[];
}

export interface StatusRetailer {
  user_id: string | null;
  place_id?: string | null;
  connection_status?: string | null;
  connection_detail?: string | null;
  connection_checked_at?: string | null;
  connect_issue?: string | null;
  connect_issue_at?: string | null;
  invite_bounced_at?: string | null;
  listing_confirmed_at?: string | null;
}
export interface StatusInvite { status: string; expires_at: string; created_at: string; accepted_at?: string | null; opened_at?: string | null }
export interface StatusUser extends ManagedAccessRow {
  token_invalid_at?: string | null;
  auto_post_enabled?: boolean | null;
  auto_reply_enabled?: boolean | null;
  automation_paused_at?: string | null;
  automation_mode?: string | null;
  automation_consent_at?: string | null;
  automation_consent_version?: string | null;
  profiles?: Array<{ google_location_name: string | null }> | null;
}

/** How long a quiet state is left before it is flagged for a person. */
export const QUIET_DAYS = { started: 1, opened: 3, not_opened: 5 } as const;

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined, now: Date) => (iso ? Math.floor((now.getTime() - Date.parse(iso)) / DAY) : 0);
const onDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : '');
const ago = (n: number) => (n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

const ISSUE_KEYS: Record<string, StatusKey> = { cancelled: 'cancelled', unticked: 'unticked', no_listing: 'no_listing', wrong_account: 'wrong_account', google_error: 'google_error' };

export function shopStatus(
  retailer: StatusRetailer,
  user: StatusUser | null,
  invites: StatusInvite[],
  now: Date = new Date(),
  rules: LiveRules = liveRulesFromEnv(),
): ShopStatus {
  const base = { live: false, quiet: false, connected: false, needsHelp: true, severity: 2 as const, since: null as string | null, buttons: [] as HelpButton[] };

  // ── Connected (linked to an account) ──
  if (retailer.user_id) {
    const bound = !!user && (user.profiles || []).some((p) => !!p.google_location_name);
    if (!user || !bound) {
      return { ...base, key: 'no_listing_chosen', label: 'Signed in, no listing', severity: 1, since: retailer.connection_checked_at ?? null,
        why: !user ? 'The shop is linked to an account that no longer exists.' : retailer.connection_status === 'check_listing'
          ? 'Signed in with a Google account that looks after other listings, and did not pick one. It may be the wrong Google account.'
          : 'Signed in, but no listing was chosen.',
        action: 'Ask whether they saw their shop in the list. If not, they used the wrong Google account: press Reset connection and ask them to open the same link with the right one.',
        buttons: ['reset'] };
    }
    const access = resolveAccess(user);
    if (!access.ok && rules.access) {
      return { ...base, key: 'access_lost', label: 'Connection lost', connected: true, severity: 1, since: user.token_invalid_at ?? null,
        why: `Was connected. Our permission from Google stopped working${user.token_invalid_at ? ` on ${onDate(user.token_invalid_at)}` : ''}. This usually follows a password change, or someone removing us in Google.`,
        action: 'Ask them to sign in at the app, go to Settings and press Reconnect. Nothing is posted or changed until they do.',
        buttons: ['reset'] };
    }
    if (retailer.connection_status === 'waiting_google' && rules.verified) {
      return { ...base, key: 'waiting_google', label: 'Waiting on Google', connected: true, severity: 2, since: retailer.connection_checked_at ?? null,
        why: 'Connected, but Google has not finished verifying the listing, so it cannot be managed yet. We check again every day.',
        action: 'Ask whether Google\'s verification (a postcard, phone call or short video) has been done. Nothing else is needed from us.',
        buttons: ['reset'] };
    }
    if (retailer.connection_status === 'check_listing' && !retailer.listing_confirmed_at && rules.matched) {
      return { ...base, key: 'check_listing', label: 'Check listing', connected: true, severity: 1, since: retailer.connection_checked_at ?? null,
        why: !(retailer.place_id === null || /no expected listing on record/.test(retailer.connection_detail || ''))
          ? `Connected, but not to the listing we expected${retailer.connection_detail ? ` (${retailer.connection_detail})` : ''}. Nothing is posted to it until someone confirms it.`
          : 'Connected. We had no listing on record for this shop to compare it with, so a person needs to look at it. Nothing is posted to it until someone confirms it.',
        action: 'Compare the name and address with the shop. If it is their shop, press This is right. If not, press Reset connection and ask them to use the Google account for the right shop.',
        buttons: ['confirm_listing', 'reset'] };
    }
    // Connected, right listing, verified, access working: LIVE, and billable.
    // If nothing is being done for it, it is still live, and it is flagged.
    if (!isActive(user)) {
      if (user.automation_paused_at) {
        return { ...base, key: 'paused', label: 'Paused by the shop', live: true, quiet: true, connected: true, severity: 3, since: user.automation_paused_at,
          why: `Live, but the shop pressed Pause${user.automation_paused_at ? ` on ${onDate(user.automation_paused_at)}` : ''}, so nothing is being posted or replied to. It still counts as live: only disconnecting stops that.`,
          action: 'Ask whether something went wrong, and whether they would like to carry on. They press Resume in Settings. Only the shop can do this.',
          buttons: [] };
      }
      return { ...base, key: 'nothing_on', label: 'Nothing switched on', live: true, quiet: true, connected: true, severity: 2, since: retailer.connection_checked_at ?? null,
        why: 'Live, but posts and review replies are both switched off, so nothing is being done for this shop. It still counts as live.',
        action: 'A short call: ask whether they would like us to look after posts and replies. They choose on their dashboard or in Settings. Only the shop can switch these on.',
        buttons: [] };
    }
    return { ...base, key: 'live', label: 'Live', live: true, connected: true, needsHelp: false, severity: 3, since: null,
      why: access.ok && access.via === 'manager' ? 'live (manager access)' : 'live', action: '', buttons: ['reset'] };
  }

  // ── Not connected ──
  const pending = invites.filter((i) => i.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!pending) {
    return { ...base, key: 'not_invited', label: 'Not invited', needsHelp: false, severity: 3, why: 'No link has been made for this shop yet.', action: 'Make a link when Tarkett is ready to invite them.', buttons: ['new_link'] };
  }
  if (retailer.invite_bounced_at) {
    return { ...base, key: 'bounced', label: 'Invitation not delivered', severity: 1, since: retailer.invite_bounced_at,
      why: `The invitation was marked as bounced or sent to the wrong person on ${onDate(retailer.invite_bounced_at)}.`,
      action: 'Get the right contact for the shop and send the link again. Press Delivered now when it has gone to the right person.',
      buttons: ['not_bounced', 'new_link'] };
  }
  if (isInviteExpired(pending.expires_at, now)) {
    return { ...base, key: 'link_expired', label: 'Link expired', severity: 2, since: pending.expires_at,
      why: `The link ran out on ${onDate(pending.expires_at)} without being used.`,
      action: 'Press New link and send it on.', buttons: ['new_link', 'bounced'] };
  }
  const issue = retailer.connect_issue ? ISSUE_KEYS[retailer.connect_issue] : undefined;
  if (issue) {
    const text = HELP[retailer.connect_issue as HelpReason];
    const n = daysSince(retailer.connect_issue_at, now);
    return { ...base, key: issue, label: text.supportLabel, severity: issue === 'google_error' ? 2 : 1, since: retailer.connect_issue_at ?? null,
      why: `${whyFor(issue)} That was ${ago(n)}. Nothing was connected and the link still works.`,
      action: text.supportAction, buttons: ['bounced'] };
  }
  if (pending.accepted_at) {
    const n = daysSince(pending.accepted_at, now);
    return { ...base, key: 'started', label: 'Started, not finished', needsHelp: n >= QUIET_DAYS.started, severity: 2, since: pending.accepted_at,
      why: `Pressed "Connect" ${ago(n)} and did not come back from Google.`,
      action: 'Usually a forgotten Google password, or not knowing which Google account to use. Ask where they got stuck. The same link still works.', buttons: ['bounced'] };
  }
  if (pending.opened_at) {
    const n = daysSince(pending.opened_at, now);
    return { ...base, key: 'opened', label: 'Opened, not started', needsHelp: n >= QUIET_DAYS.opened, severity: 3, since: pending.opened_at,
      why: `Opened the invitation ${ago(n)} and has not pressed "Connect".`,
      action: 'A short call usually does it: say it takes two minutes and that they stay the owner of their listing.', buttons: ['bounced'] };
  }
  const n = daysSince(pending.created_at, now);
  return { ...base, key: 'not_opened', label: 'Not opened', needsHelp: n >= QUIET_DAYS.not_opened, severity: 3, since: pending.created_at,
    why: `Link made ${ago(n)}. It has not been opened.`,
    action: 'Check the invitation went to the right person, then send it again or ring. If the email came back, press Email bounced.', buttons: ['bounced'] };
}

function whyFor(key: StatusKey): string {
  switch (key) {
    case 'cancelled': return 'Pressed Cancel on Google\'s permission screen.';
    case 'unticked': return 'Signed in, but left the box about business listings unticked on Google\'s screen.';
    case 'no_listing': return 'Signed in with a Google account that does not look after any shop on Google Maps.';
    case 'wrong_account': return 'Signed in with a Google account that looks after other listings, not this shop.';
    case 'google_error': return 'Google did not answer when we looked for the listing.';
    default: return '';
  }
}

/** The needs-help list: shops a person should look at, most urgent and longest-waiting first. Pure. */
export function needsHelpOrder<T extends { status: ShopStatus }>(rows: T[]): T[] {
  return rows.filter((r) => r.status.needsHelp).sort((a, b) =>
    a.status.severity - b.status.severity || (a.status.since || '9999').localeCompare(b.status.since || '9999'));
}

/**
 * Should unattended work (writing and publishing posts, automatic replies, the
 * weekly text, the monthly report) be held for this shop?
 *
 * Yes while the listing it connected is not the one we invited and nobody has
 * confirmed it, or while Google has not verified it. The shop can still make
 * changes itself, with the screen in front of it; what stops is anything done
 * for it while nobody is looking. Returns the reason, or null to carry on.
 *
 * Takes the shop record as embedded on a user row (an array or a single row).
 * A user with no shop record (the other brand) is never held.
 */
export function automationHeld(retailers: unknown, rules: LiveRules = liveRulesFromEnv()): string | null {
  const r: any = Array.isArray(retailers) ? retailers[0] : retailers;
  if (!r) return null;
  if (r.connection_status === 'waiting_google' && rules.verified) return 'Google has not verified the listing yet';
  if (r.connection_status === 'check_listing' && !r.listing_confirmed_at && rules.matched) return 'the connected listing is not the one we expected and nobody has confirmed it';
  return null;
}
