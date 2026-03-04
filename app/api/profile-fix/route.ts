import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supaAdmin } from '@/lib/supabase';
import { refreshAccessToken, updateLocation, replyToReview, getReviews, parseStarRating } from '@/lib/google';
import { generateReviewReply } from '@/lib/ai';

export async function POST(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await request.json();
    const { description, services, categories, hours, replyToReviews, firstPost } = body;

    const { data: userData } = await supaAdmin.from('users').select('id, google_refresh_token').eq('id', userId).single();
    if (!userData?.google_refresh_token) return NextResponse.json({ error: 'Google not connected' }, { status: 400 });

    const { data: profile } = await supaAdmin.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 400 });

    const accessToken = await refreshAccessToken(userData.google_refresh_token);
    const locName = profile.google_location_name;
    console.log('[profile-fix] Token refreshed OK, location:', locName);
    console.log('[profile-fix] Fix request body:', JSON.stringify(body).slice(0, 300));
    const results: Array<{ step: string; success: boolean; detail?: string }> = [];

    // 1. Description
    if (description) {
      try {
        await updateLocation(accessToken, locName, 'profile', { profile: { description } });
        results.push({ step: 'description', success: true });
      } catch (e: any) { results.push({ step: 'description', success: false, detail: e.message }); }
    }

    // 2. Services
    if (services?.length) {
      try {
        const serviceItems = services.map((name: string) => ({
          freeFormServiceItem: { category: profile.category || '', label: { displayName: name, languageCode: 'en' } },
        }));
        await updateLocation(accessToken, locName, 'serviceItems', { serviceItems });
        results.push({ step: 'services', success: true });
      } catch (e: any) { results.push({ step: 'services', success: false, detail: e.message }); }
    }

    // 3. Categories
    if (categories?.length) {
      try {
        await updateLocation(accessToken, locName, 'categories', {
          categories: { primaryCategory: { displayName: profile.category || '' }, additionalCategories: categories.map((n: string) => ({ displayName: n })) },
        });
        results.push({ step: 'categories', success: true });
      } catch (e: any) { results.push({ step: 'categories', success: false, detail: e.message }); }
    }

    // 4. Hours
    if (hours) {
      try {
        await updateLocation(accessToken, locName, 'regularHours', { regularHours: hours });
        results.push({ step: 'hours', success: true });
      } catch (e: any) { results.push({ step: 'hours', success: false, detail: e.message }); }
    }

    // 5. Review replies
    if (replyToReviews) {
      try {
        const revData = await getReviews(accessToken, locName);
        const unrep = (revData.reviews || []).filter((r: any) => !r.reviewReply);
        let count = 0;
        for (const rev of unrep) {
          try {
            const rating = parseStarRating(rev.starRating);
            const rName = rev.reviewer?.displayName || 'Customer';
            const reply = await generateReviewReply({ businessName: profile.business_name, category: profile.category || '', reviewerName: rName, rating, comment: rev.comment || '' });
            await replyToReview(accessToken, rev.name, reply);
            await supaAdmin.from('reviews').upsert({ profile_id: profile.id, google_review_id: rev.reviewId || rev.name, reviewer_name: rName, rating, comment: rev.comment || '', review_date: rev.createTime }, { onConflict: 'google_review_id' });
            count++;
          } catch { /* continue */ }
        }
        results.push({ step: 'reviews', success: true, detail: `${count}/${unrep.length} replied` });
      } catch (e: any) { results.push({ step: 'reviews', success: false, detail: e.message }); }
    }

    // 6. First post
    if (firstPost) {
      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        await supaAdmin.from('scheduled_posts').insert({ profile_id: profile.id, content: firstPost, scheduled_for: tomorrow.toISOString(), status: 'pending_approval' });
        results.push({ step: 'firstPost', success: true });
      } catch (e: any) { results.push({ step: 'firstPost', success: false, detail: e.message }); }
    }

    await supaAdmin.from('users').update({ onboarding_step: 'complete' }).eq('id', userId);
    console.log('[profile-fix] Results:', JSON.stringify(results));
    return NextResponse.json({ results, totalFixes: results.length, successfulFixes: results.filter(r => r.success).length });
  } catch (error: any) {
    console.error('Fix error:', error);
    return NextResponse.json({ error: error.message || 'Fix failed' }, { status: 500 });
  }
}
