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
import { liveRulesFromEnv } from './shop-status';
import { billingSettingsFromEnv } from './billing';

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
  out.push({ key: 'SHOP_PHOTOS', label: 'Photos', ok: null, detail: isOn(env, 'SHOP_PHOTOS') ? `ON${isOn(env, 'SHOP_PHOTOS_TO_LISTING') ? ', and photos can be added to the listing itself' : ''}.` : 'Off.' });
  out.push({ key: 'TARKETT_CONSOLE_ENABLED', label: 'Tarkett console', ok: null, detail: isOn(env, 'TARKETT_CONSOLE_ENABLED') ? 'ON. Tarkett users can sign in and see per-shop figures. Check the privacy checklist was completed.' : 'Off.' });

  const rules = liveRulesFromEnv(env.LIVE_REQUIRES);
  const relaxed = (['matched', 'verified', 'access'] as const).filter((k) => !rules[k]);
  out.push({ key: 'LIVE_REQUIRES', label: 'What counts as live', ok: null, detail: relaxed.length ? `Relaxed: a shop counts as live without ${relaxed.join(', ')}.` : 'Connected, right listing, verified by Google, access not lost.' });
  const b = billingSettingsFromEnv(env);
  out.push({ key: 'BILLING', label: 'Monthly statement', ok: null, detail: `Price per shop ${b.pricePence === null ? 'not set (the statement shows counts only)' : 'set'}; cap ${b.capShops === null ? 'not set' : 'set'}; a shop counts after ${b.minLiveDays} day${b.minLiveDays === 1 ? '' : 's'} live in the month.` });
  return out;
}

/**
 * One read per database change, to see that it has been applied. If a column
 * is missing the read fails, and that names the migration to apply.
 */
export const SCHEMA_PROBES: Array<{ migration: string; label: string; table: string; columns: string }> = [
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
];

export interface ReadinessDb { from(table: string): any }

export async function schemaChecks(db: ReadinessDb): Promise<Check[]> {
  const out: Check[] = [];
  for (const p of SCHEMA_PROBES) {
    try {
      const { error } = await db.from(p.table).select(p.columns).limit(1);
      out.push({ key: `${p.table}:${p.columns}`, label: p.label, ok: !error, detail: error ? `Not in the database. Apply migration ${p.migration}.` : 'In place.' });
    } catch (e) {
      out.push({ key: `${p.table}:${p.columns}`, label: p.label, ok: false, detail: `Could not check (${String((e as any)?.message).slice(0, 80)}).` });
    }
  }
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
    out.push({ key: 'place_ids', label: 'Each shop has the Google listing we expect', ok: noPlace ? null : true, detail: noPlace ? `${noPlace} shop${noPlace === 1 ? ' has' : 's have'} no expected listing on record. Whatever listing ${noPlace === 1 ? 'it connects' : 'they connect'} will be accepted without being compared with anything, and will count as live. Add the expected listing first, or look at ${noPlace === 1 ? 'it' : 'each one'} by hand after it connects.` : 'All have one.' });
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
