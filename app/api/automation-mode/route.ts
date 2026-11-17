import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/session';
import { getTenantBySlug } from '@/lib/tenant';
import { automationHeld } from '@/lib/shop-status';
import { AWAITING_APPROVAL, PUBLISHABLE, holdingReply } from '@/lib/safe-automation';
import {
  handsOffEnabled, planChoice, describeMode, offeredFirst,
  HANDS_OFF_WORDING, ASK_FIRST_WORDING, HANDS_OFF_WORDING_VERSION,
} from '@/lib/automation-mode';

/**
 * The shop's one choice about how we work, and its Pause button.
 *
 * GET   what the choice screen shows: the wording (from one place, so what is
 *       stored as agreed is what was on the screen), which option is offered
 *       first, and where the shop stands now.
 * POST  { mode: 'hands_off', wordingVersion }   the shop's permission, recorded
 *       { mode: 'ask_first' }                   back to asking first
 *       { paused: true | false }                Pause, or Resume
 *
 * Everything here is the signed-in shop acting on its own account. Nothing in
 * this route writes to Google or sends anything.
 */
const MODE_COLUMNS = 'id, auto_post_enabled, auto_reply_enabled, automation_mode, automation_mode_chosen_at, automation_consent_at, automation_consent_version, automation_paused_at, retailers ( connection_status, listing_confirmed_at )';

/** Every listing row for the account. Usually one; never assume so. */
async function profileIdsOf(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('profiles').select('id').eq('user_id', userId);
  if (error) throw new Error(`could not read the listing: ${error.message}`);
  return (data || []).map((p: any) => p.id);
}

export async function GET(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const tenant = getTenantBySlug(request.headers.get('x-tenant-slug'));
  const { data: user, error } = await supabaseAdmin.from('users').select(MODE_COLUMNS).eq('id', userId).single();
  if (error || !user) return NextResponse.json({ error: 'Could not load' }, { status: 500 });
  const fill = (s: string) => s.replace('{brand}', tenant.brandName);
  return NextResponse.json({
    enabled: handsOffEnabled(),
    ...describeMode(user),
    held: !!automationHeld((user as any).retailers),
    offeredFirst: offeredFirst(tenant.defaultAutomationMode),
    wordingVersion: HANDS_OFF_WORDING_VERSION,
    handsOff: { ...HANDS_OFF_WORDING, permission: fill(HANDS_OFF_WORDING.permission), holdingReply: holdingReply(null) },
    askFirst: ASK_FIRST_WORDING,
    switches: { posts: !!(user as any).auto_post_enabled, replies: !!(user as any).auto_reply_enabled },
  });
}

export async function POST(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const now = new Date();

  try {
    // Pause and Resume work whether or not the hands-off switch is on: a shop
    // that wants everything stopped must always be able to stop it.
    if (typeof body?.paused === 'boolean') {
      const { error } = await supabaseAdmin.from('users')
        .update({ automation_paused_at: body.paused ? now.toISOString() : null, updated_at: now.toISOString() }).eq('id', userId);
      if (error) throw new Error(error.message);
      // A post already booked is dropped when the shop pauses, so nothing old
      // goes up the moment it resumes, weeks later. (The publisher also checks
      // for a pause itself, in case one is booked in the same second.)
      let dropped = 0;
      const ids = await profileIdsOf(userId);
      if (ids.length) {
        // Pausing drops what is booked. Resuming drops anything booked whose
        // time passed during the pause (one approved by hand while paused,
        // or written in the same moment as the pause): nothing old goes up
        // the moment the shop resumes.
        const q = supabaseAdmin.from('scheduled_posts').update({ status: 'cancelled' }).in('profile_id', ids).eq('status', PUBLISHABLE);
        const { data: rows, error: dropError } = await (body.paused ? q : q.lte('scheduled_for', now.toISOString())).select('id');
        if (dropError) throw new Error(`could not drop booked posts: ${dropError.message}`);
        dropped = body.paused ? rows?.length || 0 : 0;
      }
      return NextResponse.json({ ok: true, paused: body.paused, dropped, message: body.paused
        ? `Paused. Nothing will be posted or replied to until you press Resume.${dropped ? ' The post that was booked will not go up.' : ''}`
        : 'Resumed. Your next post will be written on Friday.' });
    }

    const { data: current, error: currentError } = await supabaseAdmin.from('users').select('automation_mode').eq('id', userId).single();
    if (currentError) throw new Error(currentError.message);
    const wasMode: string | null = (current as any)?.automation_mode ?? null;
    const plan = planChoice({ mode: body?.mode, wordingVersion: body?.wordingVersion, currentMode: wasMode }, now);
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
    // Permission to post unattended is not recorded on a session that could
    // have been forged: while the old unsigned cookie is still accepted, the
    // hands-off choice is refused.
    if (body?.mode === 'hands_off' && (process.env.SESSION_ACCEPT_LEGACY_COOKIE || '').trim().toLowerCase() !== 'false') {
      return NextResponse.json({ error: 'This is not available yet.' }, { status: 409 });
    }
    const { error } = await supabaseAdmin.from('users').update(plan.update).eq('id', userId);
    if (error) throw new Error(error.message);

    // Posts that were waiting for approval when the shop chose hands-off: the
    // ones still to come are booked (they show on the dashboard and can be
    // stopped). One whose date has passed is dropped, not published late: a
    // post written for a week that has gone is not what the shop agreed to.
    let booked = 0;
    const ids = await profileIdsOf(userId);
    if (plan.update.automation_mode === 'hands_off' && ids.length) {
      // Booked WITHOUT an approval date: these were never approved one by
      // one, and that is how they are told apart if the shop later changes
      // its mind (below) or hands-off is switched off (the publisher).
      const { data: bookedRows, error: bookError } = await supabaseAdmin.from('scheduled_posts')
        .update({ status: PUBLISHABLE })
        .in('profile_id', ids).eq('status', AWAITING_APPROVAL).gt('scheduled_for', now.toISOString()).select('id');
      if (bookError) throw new Error(`could not book waiting posts: ${bookError.message}`);
      booked = bookedRows?.length || 0;
      const { error: staleError } = await supabaseAdmin.from('scheduled_posts')
        .update({ status: 'cancelled' })
        .in('profile_id', ids).eq('status', AWAITING_APPROVAL).lte('scheduled_for', now.toISOString());
      if (staleError) throw new Error(`could not drop out-of-date waiting posts: ${staleError.message}`);
    }
    // Leaving hands-off: a post that was booked without the shop approving it
    // itself goes back to waiting for the shop.
    if (plan.update.automation_mode === 'ask_first' && wasMode === 'hands_off' && ids.length) {
      const { error: backError } = await supabaseAdmin.from('scheduled_posts')
        .update({ status: AWAITING_APPROVAL })
        .in('profile_id', ids).eq('status', PUBLISHABLE).is('approved_at', null);
      if (backError) throw new Error(`could not put booked posts back to waiting: ${backError.message}`);
    }
    const { data: user } = await supabaseAdmin.from('users').select(MODE_COLUMNS).eq('id', userId).single();
    return NextResponse.json({ ok: true, ...describeMode(user), held: !!automationHeld((user as any)?.retailers), booked });
  } catch (e: any) {
    console.error('[automation-mode]', String(e?.message).slice(0, 200));
    return NextResponse.json({ error: 'We could not save that. Please try again.' }, { status: 500 });
  }
}
