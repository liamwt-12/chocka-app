import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken, getReviews, parseStarRating, isDeadGrant } from '@/lib/google';
import { generateReviewReply } from '@/lib/ai';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';
import { loadVoiceForUser } from '@/lib/voice';
import { reviewsNeedingReply } from '@/lib/listing-fixes';

/** Drafts written per request. Small, so no request runs long however many reviews a shop has. */
const BATCH = 3;

/**
 * Draft replies for the shop to READ before anything is posted.
 *
 *   POST { have: string[] }   review ids the page already holds drafts for
 *
 * Returns up to three more drafts and how many are left, so the page asks again
 * until there are none. Writes nothing to Google. A reply is only ever posted
 * by /api/profile-fix { step: 'reply' }, with the exact text the shop saw.
 */
export async function POST(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  let have: string[] = [];
  try { const b = await request.json(); if (Array.isArray(b?.have)) have = b.have.filter((x: unknown) => typeof x === 'string').slice(0, 200); } catch {}

  try {
    const { data: user } = await supabaseAdmin.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', userId).single();
    const access = resolveAccess(user);
    if (!access.ok) return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    const { data: profile } = await supabaseAdmin.from('profiles').select('id, business_name, category, google_location_name, google_account_id').eq('user_id', userId).single();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 400 });

    let token: string;
    try { token = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId))); }
    catch (e) { return NextResponse.json({ drafts: [], remaining: 0, total: 0, problem: isDeadGrant(e) ? 'We have lost the connection to your Google account.' : 'Google did not answer just now. Try again in a minute.' }); }

    const data = await getReviews(token, profile.google_location_name, profile.google_account_id || undefined);
    const { list, total } = reviewsNeedingReply(data.reviews || [], parseStarRating);
    const todo = list.filter((r: any) => !have.includes(r.reviewId || r.name));
    const voice = await loadVoiceForUser(supabaseAdmin, userId);

    const drafts = (await Promise.all(todo.slice(0, BATCH).map(async (r: any) => {
      const rating = parseStarRating(r.starRating);
      const name = r.reviewer?.displayName || 'Customer';
      try {
        const text = await generateReviewReply({ businessName: profile.business_name, category: profile.category || '', reviewerName: name, rating, comment: r.comment || '', voice });
        return { reviewId: r.reviewId || r.name, reviewerName: name, rating, comment: r.comment || '', date: r.createTime, text };
      } catch (e) {
        // No draft means nothing to post for this one. It is handed back empty
        // so the page stops asking for it and can say so.
        console.warn('[reply-drafts] could not draft a reply:', String((e as any)?.message).slice(0, 160));
        return { reviewId: r.reviewId || r.name, reviewerName: name, rating, comment: r.comment || '', date: r.createTime, text: '' };
      }
    })));

    return NextResponse.json({ drafts, remaining: Math.max(0, todo.length - drafts.length), offered: list.length, total });
  } catch (e: any) {
    console.error('[reply-drafts]', String(e?.message).slice(0, 300));
    return NextResponse.json({ drafts: [], remaining: 0, total: 0, problem: 'We could not read your reviews just now. Try again in a minute.' });
  }
}
