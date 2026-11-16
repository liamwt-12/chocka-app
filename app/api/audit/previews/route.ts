import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, getLocationFull, getGoogleUpdated, getAttributes, getMedia, getReviews, getLocalPosts, parseStarRating } from '@/lib/google';
import { generateDescription, generateServices, generatePost, suggestCategories } from '@/lib/ai';
import { scoreProfile } from '@/lib/audit';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess, MANAGER_EMBED } from '@/lib/managed-access';
import { getSessionUserId } from '@/lib/session';
import { ONBOARDING_REPLY_CAP } from '@/lib/review-intake';
import { aiReplyAllowed } from '@/lib/safe-automation';
import { loadVoiceForUser } from '@/lib/voice';


function getSeason(): string {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

export async function POST(request: NextRequest) {
  try {
    const userId = getSessionUserId(request);
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userData } = await supaAdmin.from('users').select(`id, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}`).eq('id', userId).single();
    // A managed retailer (Route 1) legitimately has no token of their own — the
    // credential belongs to the operator account managing their listing — so the
    // question is "is there access", not "is there a token on this row".
    const access = resolveAccess(userData);
    if (!access.ok) {
      console.warn('[audit/previews] no Google access for user', userData?.id, '—', access.reason);
      return NextResponse.json({ error: 'Google not connected', code: 'google_disconnected' }, { status: 400 });
    }

    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 400 });

    const accessToken = await refreshAccessToken(
      decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)),
    );
    const locName = profile.google_location_name;
    const acctId = profile.google_account_id;

    // Fetch GBP data to determine what previews are needed
    const [location, googleUpdated, attributes, media, reviews, posts] = await Promise.all([
      getLocationFull(accessToken, locName),
      getGoogleUpdated(accessToken, locName).catch(() => null),
      getAttributes(accessToken, locName).catch(() => ({ attributes: [] })),
      getMedia(accessToken, locName, acctId).catch(() => ({ mediaItems: [] })),
      getReviews(accessToken, locName, acctId).catch(() => ({ reviews: [] })),
      getLocalPosts(accessToken, locName, acctId).catch(() => ({ localPosts: [] })),
    ]);

    const audit = scoreProfile({ location, attributes, media, reviews, posts, googleUpdated });

    const city = location.storefrontAddress?.locality || '';
    const primaryCat = location.categories?.primaryCategory?.displayName || profile.category || '';
    const existDesc = location.profile?.description || '';
    const existSvcs = (location.serviceItems || []).map((s: any) => s.freeFormServiceItem?.label?.displayName || s.structuredServiceItem?.description || '').filter(Boolean);

    // The shop's voice, if the onboarding questions have been answered by now.
    const voice = await loadVoiceForUser(supaAdmin, userId);

    // A first post is not offered again while one is already booked or waiting
    // for the shop: looking at the suggestions twice must not book two.
    const { data: inHand } = await supaAdmin.from('scheduled_posts').select('id').eq('profile_id', profile.id).in('status', ['pending_approval', 'awaiting_approval']).limit(1);
    const postInHand = !!inHand?.length;

    // Generate all applicable previews — each individually catch-wrapped
    const [description, servicesList, firstPost, catSuggestions] = await Promise.all([
      audit.fixes.some(f => f.key === 'description')
        ? generateDescription({ businessName: profile.business_name, category: primaryCat, city, existingDescription: existDesc }).catch(() => null)
        : null,
      audit.fixes.some(f => f.key === 'services')
        ? generateServices({ businessName: profile.business_name, category: primaryCat, existingServices: existSvcs }).catch(() => null)
        : null,
      audit.fixes.some(f => f.key === 'firstPost') && !postInHand
        ? generatePost({ businessName: profile.business_name, category: primaryCat, city, month: new Date().toLocaleString('en-GB', { month: 'long' }), season: getSeason(), recentPosts: [], voice }).catch(() => null)
        : null,
      audit.fixes.some(f => f.key === 'categories')
        ? suggestCategories({ primaryCategory: primaryCat, businessName: profile.business_name }).catch(() => null)
        : null,
    ]);

    // Review replies are drafted separately, a few at a time, so the shop can
    // read every one before it is posted (app/api/onboarding/reply-drafts).
    // This only says how many there are.
    const unreplied = (reviews.reviews || []).filter((r: any) => !r.reviewReply && aiReplyAllowed(parseStarRating(r.starRating)));
    const lowStarUnreplied = (reviews.reviews || []).filter((r: any) => !r.reviewReply && !aiReplyAllowed(parseStarRating(r.starRating))).length;
    const reviewPreview = unreplied.length > 0 ? { totalUnreplied: Math.min(unreplied.length, ONBOARDING_REPLY_CAP), totalFound: unreplied.length } : null;

    // Which suggestions were wanted and could not be written. Without this the
    // screen cannot tell "your listing needs nothing" from "we could not write
    // anything just now", and used to say the first when it meant the second.
    const wanted: Array<[string, unknown]> = [['description', description], ['services', servicesList], ['firstPost', firstPost], ['categories', catSuggestions]];
    const failed = wanted.filter(([key, value]) => audit.fixes.some((f) => f.key === key) && !(key === 'firstPost' && postInHand) && (value === null || (Array.isArray(value) && value.length === 0))).map(([key]) => key);

    return NextResponse.json({
      previews: { description, services: servicesList, firstPost, categories: catSuggestions, reviewPreview, lowStarUnreplied },
      failed,
    });
  } catch (error: any) {
    console.error('Preview generation error:', error);
    // Never 500 — return empty previews so the UI degrades gracefully
    return NextResponse.json({
      previews: { description: null, services: null, firstPost: null, categories: null, reviewPreview: null },
      failed: ['description', 'services', 'firstPost', 'categories'],
      problem: 'We could not read your listing just now.',
    });
  }
}
