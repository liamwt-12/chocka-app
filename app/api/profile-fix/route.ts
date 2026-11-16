import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, isDeadGrant } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';
import {
  applyDescription, applyServices, applyCategories, applyHours, applyReply, queueLowStar, scheduleFirstPost,
  measureListing, plainProblem, STEPS, type FixContext, type FixStep, type StepResult,
} from '@/lib/listing-fixes';
import { manualGaps } from '@/lib/audit';

/**
 * One change to the shop's listing per request, checked against Google before
 * it is reported as done. See lib/listing-fixes.ts for why.
 *
 *   POST { step: 'description', text }
 *   POST { step: 'services', names: string[] }
 *   POST { step: 'categories', names: string[] }
 *   POST { step: 'hours', hours: DayHours[7] }          the shop's own times, confirmed on screen
 *   POST { step: 'reply', reviewId, text }               one reply the shop has read
 *   POST { step: 'lowStar' }                              queue holding replies for approval; posts nothing
 *   POST { step: 'firstPost', text }
 *   POST { step: 'finish' }                               re-score from Google; mark setup as done
 *
 * Every step is safe to send twice. Nothing is written that was not in the
 * request: there are no defaults.
 */
export async function POST(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated', code: 'not_authenticated' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const step = body?.step as FixStep | 'finish';
  if (step !== 'finish' && !STEPS.includes(step as FixStep)) {
    return NextResponse.json({ error: 'Unknown step', code: 'unknown_step' }, { status: 400 });
  }

  try {
    const { data: userData } = await supaAdmin.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', userId).single();
    const access = resolveAccess(userData);
    if (!access.ok) {
      console.warn('[profile-fix] no Google access for user', userData?.id, '—', access.reason);
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }
    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) return NextResponse.json({ error: 'No profile', code: 'no_profile' }, { status: 400 });

    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)));
    } catch (e) {
      // Google being busy is not a lost connection (lib/google.ts isDeadGrant).
      if (!isDeadGrant(e)) {
        const p = plainProblem({ status: 503, message: String((e as any)?.message) });
        return NextResponse.json({ result: { step, ok: false, message: p.message, nextStep: p.nextStep, retryable: true } });
      }
      await supaAdmin.from('users').update({ token_status: 'invalid', token_invalid_at: new Date().toISOString() }).eq('id', access.aadUserId);
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }

    const ctx: FixContext = { db: supaAdmin, accessToken, userId, profile };

    if (step === 'finish') {
      // Measured, not predicted. If Google cannot be read there is no number.
      let measured: Awaited<ReturnType<typeof measureListing>> | null = null;
      try { measured = await measureListing(ctx); } catch (e) { console.error('[profile-fix] could not re-score after changes:', String((e as any)?.message).slice(0, 200)); }
      if (measured) {
        const { error } = await supaAdmin.from('profiles').update({ audit_score_after: measured.audit.score }).eq('id', profile.id);
        if (error) console.error('[profile-fix] could not save the measured score:', error.message);
      }
      await supaAdmin.from('users').update({ onboarding_step: 'complete' }).eq('id', userId);
      return NextResponse.json({
        finished: true,
        scoreAtActivation: profile.audit_score ?? null,
        measured: measured ? { score: measured.audit.score, band: measured.audit.band, items: measured.audit.items, manual: manualGaps(measured.audit) } : null,
      });
    }

    let result: StepResult;
    switch (step) {
      case 'description': result = await applyDescription(ctx, body.text); break;
      case 'services': result = await applyServices(ctx, body.names); break;
      case 'categories': result = await applyCategories(ctx, body.names); break;
      case 'hours': result = await applyHours(ctx, body.hours); break;
      case 'reply': result = await applyReply(ctx, body.reviewId, body.text); break;
      case 'lowStar': result = await queueLowStar(ctx); break;
      case 'firstPost': result = await scheduleFirstPost(ctx, body.text); break;
      default: return NextResponse.json({ error: 'Unknown step' }, { status: 400 });
    }
    // Kept for support: what was tried and how it ended. No listing text.
    console.log(`[profile-fix] user ${userId} ${result.step}: ${result.ok ? 'done and checked' : `NOT done (${result.detail || result.message})`}`);
    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('Fix error:', error);
    const p = plainProblem(error);
    return NextResponse.json({ result: { step, ok: false, message: p.message, nextStep: p.nextStep, retryable: true, detail: p.detail } });
  }
}
