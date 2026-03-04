import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Recent posts
    const { data: posts } = await supabaseAdmin
      .from('scheduled_posts')
      .select('content, scheduled_for, status, published_at')
      .eq('profile_id', profile?.id)
      .order('scheduled_for', { ascending: false })
      .limit(5);

    // Recent reviews
    const { data: reviews } = await supabaseAdmin
      .from('reviews')
      .select('reviewer_name, rating, comment, reply_content, review_date')
      .eq('profile_id', profile?.id)
      .order('review_date', { ascending: false })
      .limit(5);

    // Count totals
    const { count: totalPosts } = await supabaseAdmin
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile?.id)
      .eq('status', 'published');

    const { count: totalReplies } = await supabaseAdmin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile?.id)
      .not('reply_content', 'is', null);

    return NextResponse.json({
      user: {
        name: user.name,
        email: user.email,
        referral_code: user.referral_code,
        subscription_status: user.subscription_status,
        onboarding_step: user.onboarding_step,
      },
      profile: profile ? {
        business_name: profile.business_name,
        category: profile.category,
        city: profile.city,
        streak_weeks: profile.streak_weeks || 0,
        total_posts: totalPosts || 0,
        total_replies: totalReplies || 0,
        audit_score: profile.audit_score || null,
        audit_score_after: profile.audit_score_after || null,
      } : null,
      recentPosts: posts || [],
      recentReviews: reviews || [],
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: error.message || 'Failed to load dashboard' }, { status: 500 });
  }
}
