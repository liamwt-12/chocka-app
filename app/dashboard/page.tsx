'use client';

import { useState, useEffect } from 'react';

const T = {
  slate: '#1C2331',
  cream: '#F8F6F3',
  orange: '#D4622B',
  gold: '#E7C36A',
  green: '#2D8A56',
  red: '#C93B3B',
  amber: '#D49B2B',
  muted: '#7A8190',
  border: 'rgba(28,35,49,0.10)',
  subtle: 'rgba(28,35,49,0.06)',
  white: '#FFFFFF',
};

interface DashData {
  user: { name: string; referral_code: string; subscription_status: string; onboarding_step: string };
  profile: { business_name: string; category: string; city: string; streak_weeks: number; total_posts: number; total_replies: number; audit_score: number | null; audit_score_after: number | null } | null;
  recentPosts: Array<{ content: string; scheduled_for: string; status: string; published_at: string | null }>;
  recentReviews: Array<{ reviewer_name: string; rating: number; comment: string; reply_content: string | null; review_date: string }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError('Could not load dashboard'); setLoading(false); });
  }, []);

  const card: React.CSSProperties = { background: T.white, borderRadius: 12, padding: '1.2rem', marginBottom: '0.85rem', border: `1px solid ${T.border}` };
  const label: React.CSSProperties = { color: T.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' };
  const bigNum: React.CSSProperties = { fontSize: '1.8rem', fontWeight: 800, color: T.slate, letterSpacing: '-0.02em', lineHeight: 1 };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem 0' }}>
        <div style={{ width: 28, height: 28, border: `3px solid ${T.border}`, borderTopColor: T.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <p style={{ color: T.muted, fontSize: '0.9rem' }}>{error || 'Something went wrong'}</p>
        <button onClick={() => window.location.reload()} style={{ color: T.orange, fontSize: '0.85rem', marginTop: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Try again</button>
      </div>
    );
  }

  const p = data.profile;
  const scoreBefore = p?.audit_score;
  const scoreAfter = p?.audit_score_after;
  const hasScore = scoreBefore !== null && scoreBefore !== undefined;
  const scoreCol = (s: number) => s >= 76 ? T.green : s >= 56 ? T.amber : s >= 31 ? T.orange : T.red;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: T.slate, letterSpacing: '-0.02em', margin: 0 }}>
          {p?.business_name || data.user.name || 'Your business'}
        </h1>
        {p?.city && <p style={{ color: T.muted, fontSize: '0.85rem', margin: '0.15rem 0 0' }}>{p.category}{p.city ? ` \u00B7 ${p.city}` : ''}</p>}
      </div>

      {/* Score card */}
      {hasScore && (
        <div style={{ ...card, padding: '1.5rem', marginBottom: '1rem' }}>
          <p style={label}>Profile score</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
            {scoreAfter ? (
              <>
                <span style={{ ...bigNum, color: scoreCol(scoreAfter), fontSize: '2.2rem' }}>{scoreAfter}</span>
                <span style={{ color: T.muted, fontSize: '0.95rem' }}>/100</span>
                <span style={{ color: T.green, fontSize: '0.8rem', fontWeight: 600, marginLeft: '0.5rem' }}>
                  +{scoreAfter - (scoreBefore || 0)} from onboarding
                </span>
              </>
            ) : (
              <>
                <span style={{ ...bigNum, color: scoreCol(scoreBefore!), fontSize: '2.2rem' }}>{scoreBefore}</span>
                <span style={{ color: T.muted, fontSize: '0.95rem' }}>/100</span>
              </>
            )}
          </div>
          <div style={{ width: '100%', height: 5, background: T.subtle, borderRadius: 3, marginTop: '0.75rem', overflow: 'hidden' }}>
            <div style={{ width: `${scoreAfter || scoreBefore}%`, height: '100%', background: scoreCol(scoreAfter || scoreBefore!), borderRadius: 3, transition: 'width 1s ease' }} />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '1rem' }}>
        <div style={card}>
          <p style={label}>Posts published</p>
          <p style={bigNum}>{p?.total_posts || 0}</p>
        </div>
        <div style={card}>
          <p style={label}>Reviews replied</p>
          <p style={bigNum}>{p?.total_replies || 0}</p>
        </div>
      </div>

      {/* Upcoming / recent posts */}
      {data.recentPosts.length > 0 ? (
        <div style={{ ...card, padding: '1rem 1.2rem' }}>
          <p style={{ ...label, marginBottom: '0.6rem' }}>Posts</p>
          {data.recentPosts.map((post, i) => {
            const isPending = post.status === 'pending_approval' || post.status === 'pending';
            const isPublished = post.status === 'published';
            const date = new Date(post.published_at || post.scheduled_for);
            const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            return (
              <div key={i} style={{ padding: '0.6rem 0', borderBottom: i < data.recentPosts.length - 1 ? `1px solid ${T.subtle}` : 'none' }}>
                <p style={{ fontSize: '0.85rem', color: T.slate, lineHeight: '1.5', margin: '0 0 0.3rem' }}>{post.content}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.45rem', borderRadius: 4,
                    background: isPublished ? 'rgba(45,138,86,0.08)' : isPending ? 'rgba(212,155,43,0.08)' : 'rgba(201,59,59,0.08)',
                    color: isPublished ? T.green : isPending ? T.amber : T.red,
                  }}>{isPending ? 'Scheduled' : post.status}</span>
                  <span style={{ fontSize: '0.73rem', color: T.muted }}>{dateStr}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...card, textAlign: 'center', padding: '2rem 1.5rem' }}>
          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: T.slate, marginBottom: '0.3rem' }}>Your first post is on its way</p>
          <p style={{ fontSize: '0.83rem', color: T.muted }}>We will write and publish to your Google profile this week.</p>
        </div>
      )}

      {/* Recent reviews */}
      {data.recentReviews.length > 0 && (
        <div style={{ ...card, padding: '1rem 1.2rem' }}>
          <p style={{ ...label, marginBottom: '0.6rem' }}>Recent reviews</p>
          {data.recentReviews.map((rev, i) => (
            <div key={i} style={{ padding: '0.6rem 0', borderBottom: i < data.recentReviews.length - 1 ? `1px solid ${T.subtle}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: T.slate }}>{rev.reviewer_name}</span>
                <span style={{ color: T.gold, fontSize: '0.8rem' }}>{'\u2605'.repeat(rev.rating)}</span>
              </div>
              {rev.comment && <p style={{ fontSize: '0.83rem', color: T.muted, margin: '0.15rem 0 0.4rem', lineHeight: '1.5' }}>{rev.comment}</p>}
              {rev.reply_content && (
                <div style={{ background: 'rgba(212,98,43,0.04)', borderRadius: 8, padding: '0.6rem', borderLeft: `3px solid ${T.orange}` }}>
                  <p style={{ fontSize: '0.7rem', color: T.orange, fontWeight: 600, margin: '0 0 0.15rem' }}>Your reply</p>
                  <p style={{ fontSize: '0.83rem', color: T.slate, margin: 0, lineHeight: '1.5' }}>{rev.reply_content}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Referral card */}
      <ReferralBlock code={data.user.referral_code} />
    </div>
  );
}

function ReferralBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = `https://chocka.co.uk/ref/${code}`;
  const copy = () => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (!code) return null;

  return (
    <div style={{ background: 'rgba(212,98,43,0.05)', borderRadius: 12, padding: '1.2rem', marginTop: '0.5rem', border: `1px solid rgba(212,98,43,0.1)` }}>
      <p style={{ fontSize: '0.92rem', fontWeight: 600, color: T.slate, margin: '0 0 0.2rem' }}>Refer a mate</p>
      <p style={{ fontSize: '0.8rem', color: T.muted, margin: '0 0 0.75rem' }}>You both get a free month when they sign up.</p>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <div style={{ flex: 1, background: T.white, borderRadius: 8, padding: '0.55rem 0.75rem', fontSize: '0.8rem', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: `1px solid ${T.border}` }}>
          {link}
        </div>
        <button onClick={copy} style={{ background: T.slate, color: T.cream, border: 'none', padding: '0.55rem 0.85rem', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
