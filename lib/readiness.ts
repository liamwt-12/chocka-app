/**
 * "Is everything in place to invite shops?" One panel in /admin/pilot.
 *
 * Launching to many shops at once fails in boring ways: a migration that was
 * not applied, a setting that was never set, a switch left on. Each of those
 * used to show up as a shop getting stuck. This checks them all at once, before
 * anyone is invited, and says what to do about each.
 *
 * It reports whether a setting is PRESENT, never its value. Nothing secret
 * leaves the server. It reads; it changes nothing.
 */
import { parseLiveRequires } from './shop-status';
import { billingSettingsFromEnv, termProblem } from './billing';

export interface Check {
  key: string;
  label: string;
  /** true = in place, false = must be fixed before inviting shops, null = for information. */
  ok: boolean | null;
  detail: string;
}

type Env = Record<string, string | undefined>;
const set = (env: Env, k: string) => !!(env[k] && env[k]!.trim());
const isOn = (env: Env, k: string) => (env[k] || '').trim().toLowerCase() === 'on';

const REQUIRED: Array<[string, string, string]> = [
  ['SESSION_SECRET', 'Sign-in sessions', 'Without it nobody can stay signed in.'],
  ['SECRET_ENCRYPTION_KEY', 'Stored Google permissions are encrypted', 'Without it a shop cannot connect.'],
  ['CANCEL_HASH_SECRET', 'Invite links and email links are signed', 'Without it every invite link shows an error.'],
  ['CRON_SECRET', 'Scheduled jobs can run', 'Without it no post, reply, figure or daily check runs.'],
  ['GOOGLE_CLIENT_ID', 'Google sign-in (client id)', 'Without it the Connect button fails.'],
  ['GOOGLE_CLIENT_SECRET', 'Google sign-in (client secret)', 'Without it the Connect button fails.'],
  ['ANTHROPIC_API_KEY', 'Suggestions can be written', 'Without it no description, post or reply can be drafted.'],
  ['STELLAR_APP_URL', 'The Stellar address', 'Without it invite links point at the wrong place.'],
];

/** Settings, checked for presence only. Pure. */
export function settingChecks(env: Env = process.env): Check[] {
  const out: Check[] = REQUIRED.map(([k, label, why]) => ({ key: k, label, ok: set(env, k), detail: set(env, k) ? 'Set.' : `${k} is not set. ${why}` }));
  const admin = env.ADMIN_PASSWORD || '';
  out.push({ key: 'ADMIN_PASSWORD', label: 'Admin password', ok: admin.length >= 16, detail: admin.length >= 16 ? 'Set.' : admin ? 'Set, but shorter than 16 characters. Use a long random one.' : 'Not set.' });
  out.push({ key: 'RESEND_API_KEY', label: 'Email can be sent', ok: set(env, 'RESEND_API_KEY') ? true : null, detail: set(env, 'RESEND_API_KEY') ? 'Set.' : 'Not set. Nothing can be emailed (the welcome email, the Friday preview, the monthly report).' });

  // Safety switches. Not right or wrong: shown so nothing is on by surprise.
  const legacy = (env.SESSION_ACCEPT_LEGACY_COOKIE || '').trim().toLowerCase() !== 'false';
  out.push({ key: 'SESSION_ACCEPT_LEGACY_COOKIE', label: 'Old unsigned sign-in cookie refused', ok: !legacy, detail: legacy ? 'Still accepted. Set SESSION_ACCEPT_LEGACY_COOKIE=false: until then a session can be forged by anyone who learns an account id.' : 'Refused.' });
  const querySecret = (env.CRON_ACCEPT_QUERY_SECRET || '').trim().toLowerCase() !== 'false';
  out.push({ key: 'CRON_ACCEPT_QUERY_SECRET', label: 'Job secret only accepted in a header', ok: querySecret ? null : true, detail: querySecret ? 'The secret is still accepted in the address as well. Set CRON_ACCEPT_QUERY_SECRET=false once the schedulers use the header.' : 'Header only.' });
  out.push({ key: 'WELCOME_EMAIL', label: 'Welcome email (one, after a shop connects)', ok: null, detail: isOn(env, 'WELCOME_EMAIL') ? 'ON. Each shop gets one email when it connects.' : 'Off. Set WELCOME_EMAIL=on to send it.' });
  out.push({ key: 'EARLY_POST_PREVIEW_EMAILS', label: 'Preview email for posts waiting for approval', ok: null, detail: isOn(env, 'EARLY_POST_PREVIEW_EMAILS') ? 'ON. Shops are emailed about posts waiting for approval.' : 'Off. Shops approve posts on their dashboard.' });
  out.push({ key: 'REVIEW_ALERT_EMAILS', label: 'Email every shop about every new review', ok: null, detail: isOn(env, 'REVIEW_ALERT_EMAILS') ? 'ON. Every connected shop is emailed about a new review, whether or not replies are switched on.' : 'Off. Only shops with replies on hear about a review, and only a low one. Read the emails in this page first, then set REVIEW_ALERT_EMAILS=on.' });
  out.push({ key: 'HANDS_OFF_MODE', label: 'Hands-off mode (the shop chooses: we post and reply without asking each time)', ok: null, detail: isOn(env, 'HANDS_OFF_MODE') ? 'ON. A shop that connects is offered Hands-off or Ask me first, and for a shop that chose Hands-off posts and replies go out without further approval. Check the wording was reviewed first.' : 'Off. Every shop is asked first, as before. Set HANDS_OFF_MODE=on once the wording has been reviewed.' });
  out.push({ key: 'CONNECTION_LOST_EMAILS', label: 'Email a shop when its Google connection is lost', ok: null, detail: isOn(env, 'CONNECTION_LOST_EMAILS') ? 'ON. A shop whose Google connection stops working is emailed once, then once a week until it reconnects, at its own address only.' : 'Off. A lost connection shows on the shop\'s dashboard and here, and no email is sent. Read the email in this page first, apply migration 20261121090000_connection_lost_notice_marker, then set CONNECTION_LOST_EMAILS=on.' });
  out.push({ key: 'REVIEW_REQUESTS', label: 'Review requests (emails to a shop\'s customers, from a list the shop gives)', ok: null, detail: isOn(env, 'REVIEW_REQUESTS') ? 'ON. An operator can send a shop\'s review request to its customers, after a dry run and typing the count. Check the solicitor has seen the notes and the shop terms cover it.' : 'Off. An operator can upload a list and see a dry run; nothing can be sent.' });
  out.push({ key: 'SHOP_PHOTOS', label: 'Photos', ok: null, detail: isOn(env, 'SHOP_PHOTOS') ? `ON${isOn(env, 'SHOP_PHOTOS_TO_LISTING') ? ', and photos can be added to the listing itself' : ''}.` : 'Off.' });
  out.push({ key: 'RETENTION_VIEW', label: 'Retention view (which shops are drifting)', ok: null, detail: isOn(env, 'RETENTION_VIEW') ? 'ON. Admin can see it, and the app records when each shop last opened its dashboard.' : 'Off. Set RETENTION_VIEW=on to use it.' });
  out.push({ key: 'MONTHLY_REPORT_PLAIN_SUMMARY', label: 'Monthly report: "what we did, what changed" in words', ok: null, detail: isOn(env, 'MONTHLY_REPORT_PLAIN_SUMMARY') ? 'ON. The monthly report opens with a plain summary.' : 'Off. The monthly report is as it was.' });
  out.push({ key: 'TARKETT_CONSOLE_ENABLED', label: 'Tarkett console', ok: null, detail: isOn(env, 'TARKETT_CONSOLE_ENABLED') ? 'ON. Tarkett users can sign in and see per-shop figures. Check the privacy checklist was completed.' : 'Off.' });

  const parsed = parseLiveRequires(env.LIVE_REQUIRES);
  const rules = parsed.rules;
  const relaxed = (['matched', 'verified', 'access'] as const).filter((k) => !rules[k]);
  // Relaxing what counts as live changes what is billed, so it is a cross, not a note.
  out.push({ key: 'LIVE_REQUIRES', label: 'What counts as live', ok: parsed.problem || relaxed.length ? false : null, detail: parsed.problem ? parsed.problem : relaxed.length ? `RELAXED: a shop counts as live, and is counted on the statement, without ${relaxed.join(', ')}. Remove LIVE_REQUIRES unless that is intended.` : 'Connected, right listing, verified by Google, access not lost. It does not depend on what the shop has switched on: a live shop with nothing on is listed under Needs help.' });
  const b = billingSettingsFromEnv(env);
  // No statement is produced until the term is set, so a missing term is a cross.
  const noStatement = termProblem(b);
  out.push({ key: 'BILLING', label: 'Monthly statement', ok: noStatement ? false : null, detail: `${noStatement ? `${noStatement} ` : `The term is set. `}Price per shop ${b.pricePence === null ? 'not set (a statement shows counts only)' : 'set'}; monthly cap ${b.capPence === null ? 'not set' : 'set'}. The cap, and its credit line, apply only to months that end inside the term. A shop counts for a month if it is live on the month's last day.` });
  // The total ceiling: present or absent, never its value. Typed wrongly, or set without the term, it is a cross: no statement is produced.
  const ceilingSet = b.totalCeilingPence != null;
  out.push({ key: 'BILLING_TOTAL_CEILING', label: 'Total ceiling for the term', ok: b.totalCeilingInvalid || (ceilingSet && noStatement) ? false : null, detail:
    b.totalCeilingInvalid ? 'BILLING_TOTAL_CEILING_PENCE is set but is not a whole number of pence above nought, so no statement is produced. Correct it, or remove it.'
    : !ceilingSet ? 'Not set. Fees across the term have no total ceiling; only the monthly cap, if set, limits them.'
    : noStatement ? 'Set, but the term it belongs to is not, so no statement is produced. Set BILLING_TERM_START and BILLING_TERM_END.'
    : `Set. Fees across the term, after the monthly cap, stop at it: the term ends at BILLING_TERM_END or in the month the ceiling is reached, whichever comes first.${b.pricePence === null ? ' No price is set, so there is nothing for it to limit yet.' : ''}` });
  return out;
}

/**
 * One read per database change, to see that it has been applied. If a column
 * is missing the read fails, and that names the migration to apply.
 */
export const SCHEMA_PROBES: Array<{ migration: string; label: string; table: string; columns: string; onlyWhenOn?: string }> = [
  { migration: '20261114120000_create_change_log', label: 'Change log (undo)', table: 'change_log', columns: 'id, before_value, reverted_at' },
  { migration: '20261115100000_daily_metrics', label: 'Daily figures', table: 'daily_metrics', columns: 'profile_id, date, metric' },
  { migration: '20261115110000_retailer_ad_start_date', label: 'Ad start date', table: 'retailers', columns: 'ad_start_date' },
  { migration: '20261115120000_post_approval', label: 'Post approval', table: 'scheduled_posts', columns: 'approved_at' },
  { migration: '20261115130000_retailer_connection_status', label: 'Connection status', table: 'retailers', columns: 'connection_status, connection_detail, connection_checked_at' },
  { migration: '20261116090000_retailer_voice_profile', label: 'Shop voice', table: 'retailers', columns: 'voice_profile' },
  { migration: '20261116120000_profile_monthly_report_marker', label: 'Monthly report marker', table: 'profiles', columns: 'monthly_report_sent_for' },
  { migration: '20261117090000_connection_visibility', label: 'Why a shop has not connected', table: 'retailers', columns: 'connect_issue, connect_issue_at, invite_bounced_at, support_note, listing_confirmed_at' },
  { migration: '20261117090000_connection_visibility', label: 'Invite opened', table: 'retailer_invites', columns: 'opened_at' },
  { migration: '20261117100000_welcome_email_marker', label: 'Welcome email marker', table: 'users', columns: 'welcome_email_sent_at' },
  { migration: '20261117110000_ad_spend_and_live_months', label: 'Ad spend and first-live date', table: 'retailers', columns: 'ad_spend_pence, ad_end_date, first_live_on, exclude_from_count' },
  { migration: '20261117110000_ad_spend_and_live_months', label: 'Monthly count of live shops', table: 'live_months', columns: 'month, retailer_id, live_days' },
  { migration: '20261118090000_user_last_seen', label: 'When a shop last opened its dashboard', table: 'users', columns: 'last_seen_at' },
  { migration: '20261119100000_review_snapshot', label: 'Review totals per listing (network rating)', table: 'profiles', columns: 'review_rating, review_count, reviews_read, reviews_answered, review_snapshot_at' },
  { migration: '20261119090000_automation_mode', label: 'Hands-off or ask me first, and Pause', table: 'users', columns: 'automation_mode, automation_mode_chosen_at, automation_consent_at, automation_consent_version, automation_paused_at' },
  { migration: '20261121090000_connection_lost_notice_marker', label: 'Connection-lost email marker', table: 'users', columns: 'connection_lost_notice_at' },
  // Needed only once review requests are switched on: until then a missing table is a note, not a cross.
  { migration: '20261121100000_review_requests', label: 'Review requests: emails sent', table: 'review_requests', columns: 'id, retailer_id, email_hash, batch_id, status, created_at', onlyWhenOn: 'REVIEW_REQUESTS' },
  { migration: '20261121100000_review_requests', label: 'Review requests: who each shop has asked', table: 'review_request_history', columns: 'retailer_id, email_hash, first_asked_at', onlyWhenOn: 'REVIEW_REQUESTS' },
  { migration: '20261121100000_review_requests', label: 'Review requests: unsubscribed', table: 'review_request_suppressions', columns: 'email_hash, created_at, reason', onlyWhenOn: 'REVIEW_REQUESTS' },
];

/**
 * Migrations that add a database rule and no column, so a read cannot show
 * whether they have been applied. The launch check lists them to be confirmed
 * by hand instead of pretending to have checked.
 */
export const NOT_PROBEABLE: Array<{ migration: string; label: string }> = [
  { migration: '20261120090000_operator_rows_start_off', label: 'An account made through an operator account starts with posts and replies off' },
];

export interface ReadinessDb { from(table: string): any }

export async function schemaChecks(db: ReadinessDb, env: Env = process.env): Promise<Check[]> {
  const out: Check[] = [];
  for (const p of SCHEMA_PROBES) {
    try {
      const { error } = await db.from(p.table).select(p.columns).limit(1);
      // A table only a switched-off feature uses: missing is a note, not something to fix before inviting shops.
      const optional = !!p.onlyWhenOn && !isOn(env, p.onlyWhenOn);
      out.push({ key: `${p.table}:${p.columns}`, label: p.label, ok: !error ? true : optional ? null : false, detail: !error ? 'In place.' : optional ? `Not in the database yet. Needed only before ${p.onlyWhenOn}=on: apply migration ${p.migration} first.` : `Not in the database. Apply migration ${p.migration}.` });
    } catch (e) {
      out.push({ key: `${p.table}:${p.columns}`, label: p.label, ok: false, detail: `Could not check (${String((e as any)?.message).slice(0, 80)}).` });
    }
  }
  for (const m of NOT_PROBEABLE) out.push({ key: `rule:${m.migration}`, label: m.label, ok: null, detail: `This cannot be checked from here (it is a database rule, not a column). Confirm migration ${m.migration} was applied.` });
  return out;
}

/** Things about the shops themselves that will cause trouble on the day. */
export async function dataChecks(db: ReadinessDb, tenantId: string, now: Date = new Date()): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const { data: shops, error } = await db.from('retailers').select('id, place_id, user_id, delisted_at').eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
    const active = (shops || []).filter((s: any) => !s.delisted_at);
    const noPlace = active.filter((s: any) => !s.place_id).length;
    out.push({ key: 'shops', label: 'Shops on record', ok: null, detail: `${active.length} shop${active.length === 1 ? '' : 's'}, ${active.filter((s: any) => s.user_id).length} connected.` });
    out.push({ key: 'place_ids', label: 'Each shop has the Google listing we expect', ok: noPlace ? null : true, detail: noPlace ? `${noPlace} shop${noPlace === 1 ? ' has' : 's have'} no expected listing on record. Whatever listing ${noPlace === 1 ? 'it connects' : 'they connect'} will show as "Check listing" and will not count as live, or have anything done for it, until a person presses "This is right".` : 'All have one.' });
    const { data: last } = await db.from('profiles').select('metrics_synced_at').not('metrics_synced_at', 'is', null).order('metrics_synced_at', { ascending: false }).limit(1);
    const when = last?.[0]?.metrics_synced_at;
    const hours = when ? (now.getTime() - Date.parse(when)) / 3_600_000 : null;
    const anyConnected = active.some((s: any) => s.user_id);
    out.push({ key: 'jobs', label: 'Scheduled jobs are running', ok: !anyConnected ? null : hours !== null && hours < 26, detail: !anyConnected ? 'No shop is connected yet, so there is nothing to see. Check again after the first shop connects.' : hours === null ? 'The hourly figures job has never completed for any shop. Check the schedulers and CRON_SECRET.' : hours < 26 ? `The hourly figures job last did some work ${Math.max(1, Math.round(hours))} hour${Math.round(hours) === 1 ? '' : 's'} ago.` : `The hourly figures job last did any work ${Math.round(hours / 24)} days ago. Check the schedulers.` });
  } catch (e) {
    out.push({ key: 'shops', label: 'Shops on record', ok: false, detail: `Could not read the shops (${String((e as any)?.message).slice(0, 80)}).` });
  }
  return out;
}

export function summary(checks: Check[]): { ready: boolean; toFix: number } {
  const toFix = checks.filter((c) => c.ok === false).length;
  return { ready: toFix === 0, toFix };
}
