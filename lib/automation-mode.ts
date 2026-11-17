/**
 * Hands-off, or ask me first: the one choice a shop makes about how we work.
 *
 * ASK ME FIRST is the careful behaviour the app has always had for a free
 * shop: posts and replies are off until the shop turns them on, its first
 * three posts wait for approval, and a 1 to 3 star review gets a drafted
 * holding reply that goes nowhere until the shop approves it.
 *
 * HANDS-OFF means we post and reply for the shop until it says otherwise:
 *   - the weekly post goes out without waiting for approval. Each one is still
 *     shown first (on the dashboard, and in the email that already goes out
 *     before a post), and can be stopped with one tap
 *   - 4 and 5 star reviews are answered automatically, as before
 *   - a 1 to 3 star review gets the fixed holding reply straight away
 *     (lib/safe-automation.ts: never AI wording), and the shop is told
 * and Pause and Undo are always one tap away.
 *
 * WHAT DOES NOT CHANGE IN EITHER MODE
 *   - A listing nobody has confirmed, or that Google has not verified, stays
 *     held (lib/shop-status.ts automationHeld). Hands-off does not lift a hold.
 *   - Every write is logged and can be undone from Settings.
 *   - Low-star reviews never get AI wording.
 *
 * PERMISSION. Hands-off is only ever in force when the shop itself chose it on
 * a screen that showed the wording below. The moment, and the version of the
 * wording, are stored with the choice. No code path sets hands-off for a shop
 * that did not choose it: the tenant's "default" is which option is offered
 * first on the screen, not something applied on the shop's behalf.
 *
 * OFF unless HANDS_OFF_MODE=on. While it is off the choice is not offered, and
 * a stored choice of hands-off has no effect: every shop is treated as ask me
 * first, which is the app exactly as it was.
 *
 * Pure: no database, no network.
 */

export type AutomationMode = 'hands_off' | 'ask_first';

/**
 * The version of the wording a shop is shown when it chooses hands-off. Change
 * it whenever HANDS_OFF_WORDING changes in meaning, so a stored permission can
 * always be matched to the words that were on the screen.
 *
 * DRAFT: needs solicitor review before HANDS_OFF_MODE is switched on.
 */
export const HANDS_OFF_WORDING_VERSION = '2026-11-19-draft';

/** What the shop reads before it chooses. {brand} is the brand name. DRAFT: needs solicitor review. */
export const HANDS_OFF_WORDING = {
  title: 'Hands-off',
  summary: 'We post and reply for you until you say otherwise.',
  points: [
    'We put a short post on your Google listing each week. You see each one before it goes up and can stop it.',
    'We reply to your 4 and 5 star reviews.',
    'If you get a 1, 2 or 3 star review we post one short, polite reply that asks the customer to contact you, and we tell you straight away. It is the same careful wording every time.',
    'Pause and Undo are always one tap away in Settings.',
  ],
  permission: 'By choosing Hands-off you give {brand} permission to post and reply on your Google listing for you, as described here, until you tell us to stop.',
  button: 'Yes, look after it for me',
} as const;

export const ASK_FIRST_WORDING = {
  title: 'Ask me first',
  summary: 'Nothing goes on your listing unless you have said yes to it.',
  points: [
    'Posts and review replies are off until you turn them on.',
    'You approve your first three posts before they go up.',
    'A reply to a 1, 2 or 3 star review always waits for you.',
  ],
  button: 'Ask me first',
} as const;

/**
 * The wording versions a stored permission may name and still be in force. A
 * permission given against wording that is no longer on this list (a draft
 * that was later changed, say) stops counting: the shop is asked again.
 */
export const ACCEPTED_WORDING_VERSIONS: readonly string[] = [HANDS_OFF_WORDING_VERSION];

export function handsOffEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.HANDS_OFF_MODE || '').trim().toLowerCase() === 'on';
}

export interface ModeRow {
  automation_mode?: string | null;
  automation_consent_at?: string | null;
  automation_consent_version?: string | null;
  automation_paused_at?: string | null;
}

/**
 * Is hands-off in force for this shop? Only with the switch on, the shop's own
 * choice on record, AND the record of its permission (when, and which
 * wording). A row that says hands-off without that record is treated as ask me
 * first: when in doubt, ask.
 */
export function isHandsOff(row: ModeRow | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!row || !handsOffEnabled(env)) return false;
  return row.automation_mode === 'hands_off' && !!row.automation_consent_at && !!row.automation_consent_version && ACCEPTED_WORDING_VERSIONS.includes(row.automation_consent_version);
}

/** The mode in force, which is what every job and screen should ask for. */
export function effectiveMode(row: ModeRow | null | undefined, env: Record<string, string | undefined> = process.env): AutomationMode {
  return isHandsOff(row, env) ? 'hands_off' : 'ask_first';
}

/**
 * Has the shop pressed Pause? While it has, nothing is written, published or
 * replied to for it, in either mode. Pause is honoured whether or not the
 * hands-off switch is on: a shop that asked us to stop must stay stopped.
 */
export function isPaused(row: ModeRow | null | undefined): boolean {
  return !!row?.automation_paused_at;
}

/**
 * What is switched on for this shop, as every job should read it.
 *
 * Choosing hands-off turns posts and replies on, because that is what the shop
 * agreed to. If that choice is then NOT in force (HANDS_OFF_MODE has been
 * switched off, or the wording it agreed to is no longer accepted), the
 * switches it turned on do not count either: a shop that only ever said yes
 * to hands-off has not said yes to anything else.
 */
export function switchesInForce(row: (ModeRow & { auto_post_enabled?: boolean | null; auto_reply_enabled?: boolean | null }) | null | undefined, env: Record<string, string | undefined> = process.env): { posts: boolean; replies: boolean } {
  if (!row) return { posts: false, replies: false };
  if (row.automation_mode === 'hands_off' && !isHandsOff(row, env)) return { posts: false, replies: false };
  return { posts: row.auto_post_enabled === true, replies: row.auto_reply_enabled === true };
}

/** Which option the choice screen offers first for a tenant. Never applied for the shop. */
export function offeredFirst(tenantDefault: AutomationMode | undefined): AutomationMode {
  return tenantDefault === 'hands_off' ? 'hands_off' : 'ask_first';
}

export type ChoiceInput = { mode?: unknown; wordingVersion?: unknown; /** The mode stored for the shop now. */ currentMode?: string | null };
export type ChoiceResult =
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Turn what the choice screen posted into the columns to write. Pure.
 *
 * Hands-off is refused unless the screen says which wording it showed and that
 * is the current wording: permission given against words we cannot name is not
 * permission. It turns posts and replies on, because that is what was agreed.
 *
 * Ask me first, chosen by a shop that was never in hands-off, changes nothing
 * else: the two switches stay as the shop left them. Chosen by a shop leaving
 * hands-off, it also turns both switches off. The earlier record of
 * permission is kept, as history.
 */
export function planChoice(input: ChoiceInput, now: Date, env: Record<string, string | undefined> = process.env): ChoiceResult {
  if (!handsOffEnabled(env)) return { ok: false, status: 404, error: 'Not available' };
  const at = now.toISOString();
  if (input.mode === 'ask_first') {
    const update: Record<string, unknown> = { automation_mode: 'ask_first', automation_mode_chosen_at: at, updated_at: at };
    // Leaving hands-off: the two switches it turned on go off again, so that
    // "nothing goes on your listing unless you have said yes to it" is true
    // from this moment. The shop turns on what it wants, as any shop does.
    if (input.currentMode === 'hands_off') Object.assign(update, { auto_post_enabled: false, auto_reply_enabled: false });
    return { ok: true, update };
  }
  if (input.mode !== 'hands_off') return { ok: false, status: 400, error: 'Choose Hands-off or Ask me first.' };
  if (input.wordingVersion !== HANDS_OFF_WORDING_VERSION) {
    return { ok: false, status: 409, error: 'This page is out of date. Please reload it and choose again.' };
  }
  return { ok: true, update: {
    automation_mode: 'hands_off', automation_mode_chosen_at: at,
    automation_consent_at: at, automation_consent_version: HANDS_OFF_WORDING_VERSION,
    auto_post_enabled: true, auto_reply_enabled: true, updated_at: at,
  } };
}

/** What Settings and the admin page show. No dates are invented: null stays null. */
export function describeMode(row: ModeRow | null | undefined, env: Record<string, string | undefined> = process.env): { mode: AutomationMode; label: string; chosen: boolean; paused: boolean; permissionOn: string | null; wordingVersion: string | null } {
  const mode = effectiveMode(row, env);
  const chosen = row?.automation_mode === 'hands_off' || row?.automation_mode === 'ask_first';
  return {
    mode, chosen, paused: isPaused(row),
    label: mode === 'hands_off' ? 'Hands-off' : chosen ? 'Ask me first' : 'Ask me first (not chosen yet)',
    permissionOn: mode === 'hands_off' ? row!.automation_consent_at ?? null : null,
    wordingVersion: mode === 'hands_off' ? row!.automation_consent_version ?? null : null,
  };
}

/**
 * Does the next post need the shop's approval? In hands-off, never. Otherwise
 * the existing rule (the first three). One place, so the generator and the
 * tests cannot drift.
 */
export function postNeedsApproval(row: ModeRow | null | undefined, publishedPostCount: number, approvalRequiredPosts: number, env: Record<string, string | undefined> = process.env): boolean {
  if (isHandsOff(row, env)) return false;
  return publishedPostCount < approvalRequiredPosts;
}

/**
 * Was this review left after the shop gave its hands-off permission? Only
 * those are answered unattended: "if you get a 1, 2 or 3 star review" is a
 * promise about reviews to come, not about one the shop may already have
 * dealt with by phone. An undatable review counts as earlier.
 */
export function leftSincePermission(reviewCreateTime: string | null | undefined, row: ModeRow | null | undefined): boolean {
  const r = reviewCreateTime ? Date.parse(reviewCreateTime) : NaN;
  const c = row?.automation_consent_at ? Date.parse(row.automation_consent_at) : NaN;
  return Number.isFinite(r) && Number.isFinite(c) && r >= c;
}

/** May the fixed holding reply to a low-star review be published without the shop's approval? Hands-off only. */
export function holdingReplyGoesOut(row: ModeRow | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return isHandsOff(row, env) && !isPaused(row);
}
