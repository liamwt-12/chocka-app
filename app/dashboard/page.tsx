'use client';

import { useState, useEffect } from 'react';
import StatsCard from '@/components/StatsCard';
import ReferralCard from '@/components/ReferralCard';

interface DashboardData {
  user: {
    name: string;
    referral_code: string;
    subscription_status: string;
  };
  profile: {
    business_name: string;
    streak_weeks: number;
    total_auto_posts: number;
    total_auto_replies: number;
  };
  stats: {
    views: number;
    views_change: string;
    calls: number;
  };
  recentPosts: Array<{ content: string; published_at: string; status: string }>;
  recentReviews: Array<{
    reviewer_name: string;
    rating: number;
    comment: string;
    reply_content?: string;
    review_date: string;
  }>;
  referralCount: number;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: fetch from API
    // For now, show empty state
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-gray-200 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  // Empty state for new users
  if (!data) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-charcoal">Welcome to Chocka</h1>
          <p className="text-gray-400 text-sm mt-1">We&apos;re getting started — your first post goes out this week.</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <StatsCard label="Posts published" value="0" icon="📝" />
          <StatsCard label="Reviews replied" value="0" icon="⭐" />
          <StatsCard label="Views this week" value="—" icon="👀" />
          <StatsCard label="Calls this week" value="—" icon="📞" />
        </div>

        <div className="bg-white rounded-2xl border-2 border-gray-100 p-8 text-center mb-8">
          <div className="text-4xl mb-4">🚀</div>
          <h3 className="font-bold text-charcoal text-lg mb-2">Your first post is on its way</h3>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            We&apos;ll write and post to your Google profile this week. You&apos;ll get an email to preview it,
            and a text when it goes live. Sit tight.
          </p>
        </div>

        <ReferralCard referralCode="LOADING" referralCount={0} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-charcoal">{data.profile.business_name}</h1>
        {data.profile.streak_weeks > 0 && (
          <p className="text-sm text-brand font-semibold mt-1">
            🔥 {data.profile.streak_weeks} week streak
          </p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <StatsCard label="Posts published" value={data.profile.total_auto_posts} icon="📝" />
        <StatsCard label="Reviews replied" value={data.profile.total_auto_replies} icon="⭐" />
        <StatsCard label="Views this week" value={data.stats.views.toLocaleString()} change={data.stats.views_change} icon="👀" />
        <StatsCard label="Calls this week" value={data.stats.calls} icon="📞" />
      </div>

      {/* Recent posts */}
      {data.recentPosts.length > 0 && (
        <div className="mb-8">
          <h2 className="font-bold text-charcoal text-lg mb-4">Recent posts</h2>
          <div className="space-y-3">
            {data.recentPosts.map((post, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-sm text-charcoal leading-relaxed">{post.content}</p>
                <div className="flex items-center gap-2 mt-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    post.status === 'published' ? 'bg-green-50 text-green-600' :
                    post.status === 'cancelled' ? 'bg-red-50 text-red-500' :
                    'bg-yellow-50 text-yellow-600'
                  }`}>{post.status}</span>
                  <span className="text-xs text-gray-300">
                    {new Date(post.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent reviews */}
      {data.recentReviews.length > 0 && (
        <div className="mb-8">
          <h2 className="font-bold text-charcoal text-lg mb-4">Recent reviews</h2>
          <div className="space-y-3">
            {data.recentReviews.map((review, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-sm text-charcoal">{review.reviewer_name}</span>
                  <span className="text-sm">{'⭐'.repeat(review.rating)}</span>
                </div>
                {review.comment && (
                  <p className="text-sm text-gray-500 leading-relaxed mb-3">{review.comment}</p>
                )}
                {review.reply_content && (
                  <div className="bg-brand-light rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Your reply</p>
                    <p className="text-sm text-charcoal leading-relaxed">{review.reply_content}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Referral card */}
      <ReferralCard referralCode={data.user.referral_code} referralCount={data.referralCount} />
    </div>
  );
}
