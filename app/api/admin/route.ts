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
      .select('id, email, name, subscription_status, created_at, referred_by, referral_code')
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

    const active = enriched.filter(u => u.subscription_status === 'active');
    const mrr = active.length * 29;
    const signupsThisMonth = enriched.filter(u => {
      const d = new Date(u.created_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const churned = enriched.filter(u => u.subscription_status === 'cancelled').length;

    return NextResponse.json({
      summary: {
        totalSignups: enriched.length,
        activeSubscribers: active.length,
        mrr,
        churned,
        signupsThisMonth,
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
