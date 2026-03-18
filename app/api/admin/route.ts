import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'chocka-admin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // All users
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, email, name, subscription_status, created_at, referred_by, referral_code, utm_source, utm_medium, utm_campaign')
      .order('created_at', { ascending: false });

    // All profiles
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('user_id, business_name, category, city, audit_score, audit_score_after, streak_weeks, total_auto_posts, total_auto_replies, created_at');

    // Posts generated
    const { count: totalPosts } = await supabaseAdmin
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true });

    // Posts published
    const { count: publishedPosts } = await supabaseAdmin
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published');

    // Referrals
    const { count: totalReferrals } = await supabaseAdmin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed');

    // Merge users with profiles
    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
    const enriched = (users || []).map(u => ({
      ...u,
      profile: profileMap.get(u.id) || null,
    }));

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const active = enriched.filter(u => u.subscription_status === 'active');
    const churned = enriched.filter(u => u.subscription_status === 'cancelled');
    const mrr = active.length * 29;

    const signupsThisMonth = enriched.filter(u => {
      const d = new Date(u.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    const signupsThisWeek = enriched.filter(u => {
      return new Date(u.created_at) >= startOfWeek;
    }).length;

    const lastSignup = enriched.length > 0 ? enriched[0].created_at : null;

    const conversionRate = enriched.length > 0
      ? Math.round((active.length / enriched.length) * 100)
      : 0;

    // UTM breakdown — how many signups came from cold email
    const utmBreakdown = enriched.reduce((acc: Record<string, number>, u) => {
      const source = u.utm_campaign || u.utm_source || 'direct';
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});

    // Average profile score lift
    const withScores = enriched.filter(u =>
      u.profile?.audit_score != null && u.profile?.audit_score_after != null
    );
    const avgScoreLift = withScores.length > 0
      ? Math.round(withScores.reduce((sum, u) => sum + (u.profile!.audit_score_after - u.profile!.audit_score), 0) / withScores.length)
      : 0;

    return NextResponse.json({
      summary: {
        totalSignups: enriched.length,
        activeSubscribers: active.length,
        mrr,
        churned: churned.length,
        signupsThisMonth,
        signupsThisWeek,
        lastSignup,
        conversionRate,
        utmBreakdown,
        avgScoreLift,
        totalPostsGenerated: totalPosts || 0,
        totalPostsPublished: publishedPosts || 0,
        totalReferrals: totalReferrals || 0,
      },
      users: enriched,
    });

  } catch (err) {
    console.error('Admin API error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
