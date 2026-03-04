'use client';

import { useState, useEffect } from 'react';

const T = {
  slate: '#1C2331', cream: '#F8F6F3', orange: '#D4622B', gold: '#E7C36A',
  green: '#2D8A56', red: '#C93B3B', amber: '#D49B2B', muted: '#7A8190',
  border: 'rgba(28,35,49,0.10)', subtle: 'rgba(28,35,49,0.06)', white: '#FFFFFF',
};

export default function DashboardPage() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setD(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const card = (mb?: string): React.CSSProperties => ({ background: T.white, borderRadius: 12, padding: '1.1rem', marginBottom: mb || '0.7rem', border: `1px solid ${T.border}` });
  const lbl: React.CSSProperties = { color: T.muted, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.2rem' };
  const num: React.CSSProperties = { fontSize: '1.5rem', fontWeight: 800, color: T.slate, letterSpacing: '-0.02em', lineHeight: 1, margin: 0 };
  const smNum: React.CSSProperties = { fontSize: '1.15rem', fontWeight: 700, color: T.slate, lineHeight: 1, margin: 0 };
  const dot = (c: string) => ({ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: c, marginRight: 6 } as React.CSSProperties);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem 0' }}>
      <div style={{ width: 28, height: 28, border: `3px solid ${T.border}`, borderTopColor: T.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!d) return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <p style={{ color: T.muted }}>Could not load dashboard</p>
      <button onClick={() => window.location.reload()} style={{ color: T.orange, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, marginTop: '0.5rem' }}>Try again</button>
    </div>
  );

  const p = d.profile;
  const g = d.google;
  const hasScore = p?.audit_score !== null && p?.audit_score !== undefined;
  const sc = (s: number) => s >= 76 ? T.green : s >= 56 ? T.amber : s >= 31 ? T.orange : T.red;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: T.slate, letterSpacing: '-0.02em', margin: 0 }}>
            {p?.business_name || d.user.name}
          </h1>
          <span style={{ ...dot(T.green), width: 8, height: 8, marginRight: 0 }} title="Managed" />
        </div>
        {p?.city && <p style={{ color: T.muted, fontSize: '0.83rem', margin: '0.1rem 0 0' }}>{p.category} &middot; {p.city}</p>}
      </div>

      {/* Score + streak row */}
      {hasScore && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.7rem' }}>
          <div style={card()}>
            <p style={lbl}>Profile score</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
              <p style={{ ...num, color: sc(p.audit_score_after || p.audit_score) }}>{p.audit_score_after || p.audit_score}</p>
              <span style={{ color: T.muted, fontSize: '0.75rem' }}>/100</span>
            </div>
            {p.audit_score_after && p.audit_score && (
              <p style={{ color: T.green, fontSize: '0.7rem', fontWeight: 600, margin: '0.25rem 0 0' }}>+{p.audit_score_after - p.audit_score} from setup</p>
            )}
          </div>
          <div style={card()}>
            <p style={lbl}>Managed for</p>
            <p style={num}>{p.streak_weeks || 0}<span style={{ fontSize: '0.75rem', fontWeight: 500, color: T.muted }}> weeks</span></p>
            <p style={{ color: T.green, fontSize: '0.7rem', fontWeight: 600, margin: '0.25rem 0 0' }}>0 missed</p>
          </div>
        </div>
      )}

      {/* Google live metrics */}
      {g?.metrics && (
        <div style={{ ...card(), padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <p style={{ ...lbl, margin: 0 }}>This week on Google</p>
            <span style={{ fontSize: '0.65rem', color: T.muted }}>Live</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Views</p>
              <p style={smNum}>{g.metrics.views + g.metrics.searches}</p>
            </div>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Calls</p>
              <p style={smNum}>{g.metrics.calls}</p>
            </div>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Directions</p>
              <p style={smNum}>{g.metrics.directions}</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Website clicks</p>
              <p style={smNum}>{g.metrics.websiteClicks}</p>
            </div>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Total actions</p>
              <p style={{ ...smNum, color: T.orange }}>{g.metrics.totalActions}</p>
            </div>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Searches</p>
              <p style={smNum}>{g.metrics.searches}</p>
            </div>
          </div>
        </div>
      )}

      {/* Reviews summary */}
      {g?.reviews && (
        <div style={{ ...card(), padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <p style={{ ...lbl, margin: 0 }}>Reviews</p>
            {g.reviews.unreplied > 0 && <span style={{ fontSize: '0.65rem', fontWeight: 600, color: T.orange, background: 'rgba(212,98,43,0.08)', padding: '0.15rem 0.4rem', borderRadius: 4 }}>{g.reviews.unreplied} need reply</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Total</p>
              <p style={smNum}>{g.reviews.total}</p>
            </div>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Average</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
                <p style={smNum}>{g.reviews.avgRating}</p>
                <span style={{ color: T.gold, fontSize: '0.75rem' }}>{'\u2605'}</span>
              </div>
            </div>
            <div>
              <p style={{ color: T.muted, fontSize: '0.7rem', margin: '0 0 0.15rem' }}>Replied</p>
              <p style={{ ...smNum, color: g.reviews.replied === g.reviews.total ? T.green : T.amber }}>{g.reviews.replied}/{g.reviews.total}</p>
            </div>
          </div>
        </div>
      )}

      {/* Profile health indicators */}
      {g?.profile && (
        <div style={{ ...card(), padding: '1rem' }}>
          <p style={{ ...lbl, marginBottom: '0.5rem' }}>Profile health</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
            <HealthRow ok={g.profile.descriptionLength >= 100} label="Description" detail={g.profile.descriptionLength > 0 ? `${g.profile.descriptionLength} chars` : 'Missing'} />
            <HealthRow ok={g.profile.hoursSet} label="Hours" detail={g.profile.hoursSet ? 'Set' : 'Not set'} />
            <HealthRow ok={g.profile.servicesCount >= 3} label="Services" detail={`${g.profile.servicesCount} listed`} />
            <HealthRow ok={g.profile.categoriesCount >= 2} label="Categories" detail={`${g.profile.categoriesCount} set`} />
            <HealthRow ok={g.profile.hasPhone} label="Phone" detail={g.profile.hasPhone ? 'Set' : 'Missing'} />
            <HealthRow ok={g.profile.hasWebsite} label="Website" detail={g.profile.hasWebsite ? 'Set' : 'Missing'} />
            <HealthRow ok={(g.photos || 0) >= 3} label="Photos" detail={`${g.photos || 0} uploaded`} />
            <HealthRow ok={!!g.posts.lastPostDate} label="Last post" detail={g.posts.lastPostDate ? timeAgo(g.posts.lastPostDate) : 'Never'} />
          </div>
        </div>
      )}

      {/* Our work stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.7rem' }}>
        <div style={card()}>
          <p style={lbl}>Posts by us</p>
          <p style={num}>{p?.total_posts || 0}</p>
        </div>
        <div style={card()}>
          <p style={lbl}>Replies by us</p>
          <p style={num}>{p?.total_replies || 0}</p>
        </div>
      </div>

      {/* Next scheduled post */}
      {d.recentPosts?.find((p: any) => p.status === 'pending_approval' || p.status === 'pending') && (
        <div style={{ ...card(), borderLeft: `3px solid ${T.orange}` }}>
          <p style={{ ...lbl, marginBottom: '0.35rem' }}>Next post scheduled</p>
          <p style={{ fontSize: '0.85rem', color: T.slate, lineHeight: 1.5, margin: '0 0 0.3rem' }}>
            {d.recentPosts.find((p: any) => p.status === 'pending_approval' || p.status === 'pending').content}
          </p>
          <p style={{ fontSize: '0.7rem', color: T.muted, margin: 0 }}>
            {formatDate(d.recentPosts.find((p: any) => p.status === 'pending_approval' || p.status === 'pending').scheduled_for)}
          </p>
        </div>
      )}

      {/* Activity feed */}
      {d.activity?.length > 0 && (
        <div style={{ ...card(), padding: '1rem' }}>
          <p style={{ ...lbl, marginBottom: '0.5rem' }}>Recent activity</p>
          {d.activity.slice(0, 6).map((a: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0', borderBottom: i < Math.min(d.activity.length, 6) - 1 ? `1px solid ${T.subtle}` : 'none' }}>
              <span style={dot(a.type === 'post' ? T.green : a.type === 'reply' ? T.orange : T.amber)} />
              <span style={{ fontSize: '0.8rem', color: T.slate, flex: 1 }}>{a.action}</span>
              <span style={{ fontSize: '0.68rem', color: T.muted, flexShrink: 0 }}>{timeAgo(a.date)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent reviews with replies */}
      {d.recentReviews?.length > 0 && (
        <div style={{ ...card(), padding: '1rem' }}>
          <p style={{ ...lbl, marginBottom: '0.5rem' }}>Latest reviews</p>
          {d.recentReviews.slice(0, 4).map((r: any, i: number) => (
            <div key={i} style={{ padding: '0.5rem 0', borderBottom: i < Math.min(d.recentReviews.length, 4) - 1 ? `1px solid ${T.subtle}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.15rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.8rem', color: T.slate }}>{r.reviewer_name}</span>
                <span style={{ color: T.gold, fontSize: '0.75rem' }}>{'\u2605'.repeat(r.rating)}</span>
              </div>
              {r.comment && <p style={{ fontSize: '0.8rem', color: T.muted, margin: '0.1rem 0 0.3rem', lineHeight: 1.4 }}>{r.comment}</p>}
              {r.reply_content && (
                <div style={{ background: 'rgba(212,98,43,0.04)', borderRadius: 6, padding: '0.45rem 0.6rem', borderLeft: `2px solid ${T.orange}` }}>
                  <p style={{ fontSize: '0.68rem', color: T.orange, fontWeight: 600, margin: '0 0 0.1rem' }}>Our reply</p>
                  <p style={{ fontSize: '0.78rem', color: T.slate, margin: 0, lineHeight: 1.4 }}>{r.reply_content}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state if no Google data */}
      {!g && d.recentPosts?.length === 0 && (
        <div style={{ ...card('1rem'), textAlign: 'center', padding: '2rem 1.5rem' }}>
          <p style={{ fontSize: '0.92rem', fontWeight: 600, color: T.slate, margin: '0 0 0.3rem' }}>Your first post is on its way</p>
          <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0 }}>We will write and publish to your Google profile this week. Your stats will appear here once we get started.</p>
        </div>
      )}

      {/* Referral */}
      <RefBlock code={d.user.referral_code} />
    </div>
  );
}

function HealthRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#2D8A56' : '#D49B2B', flexShrink: 0 }} />
      <span style={{ fontSize: '0.78rem', color: '#1C2331', flex: 1 }}>{label}</span>
      <span style={{ fontSize: '0.7rem', color: '#7A8190' }}>{detail}</span>
    </div>
  );
}

function RefBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const link = `https://chocka.co.uk/ref/${code}`;
  return (
    <div style={{ background: 'rgba(212,98,43,0.05)', borderRadius: 12, padding: '1rem', marginTop: '0.3rem', border: '1px solid rgba(212,98,43,0.1)' }}>
      <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1C2331', margin: '0 0 0.15rem' }}>Refer a mate</p>
      <p style={{ fontSize: '0.78rem', color: '#7A8190', margin: '0 0 0.6rem' }}>You both get a free month.</p>
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        <div style={{ flex: 1, background: '#FFFFFF', borderRadius: 8, padding: '0.5rem 0.65rem', fontSize: '0.78rem', color: '#7A8190', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid rgba(28,35,49,0.10)' }}>{link}</div>
        <button onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: '#1C2331', color: '#F8F6F3', border: 'none', padding: '0.5rem 0.75rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>{copied ? 'Copied!' : 'Copy'}</button>
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return `Today at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ` at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
