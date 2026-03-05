'use client';

import { useState, useEffect } from 'react';

const hd = "'Cabinet Grotesk', sans-serif";
const bd = "'Inter', system-ui, sans-serif";
const C = {
  charcoal: '#2A2520', cream: '#F8F6F3', orange: '#D4622B', gold: '#E7C36A',
  green: '#2D8B4E', red: '#D93025', grey: '#A09A93', text: '#5A554F',
  warmBg: '#F0EDE8', shadow: 'rgba(42,37,32,.04)', shadowLg: 'rgba(42,37,32,.1)',
  googleStar: '#FBBC04',
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

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6rem 0' }}>
      <div style={{ width: 24, height: 24, border: `3px solid ${C.warmBg}`, borderTopColor: C.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  if (!d) return (
    <div style={{ textAlign: 'center', padding: '5rem 1rem' }}>
      <p style={{ color: C.grey, fontFamily: bd }}>Could not load dashboard</p>
      <button onClick={() => window.location.reload()} style={{ color: C.orange, background: 'none', border: 'none', cursor: 'pointer', fontFamily: bd, fontWeight: 600, marginTop: '0.5rem', fontSize: '0.85rem' }}>Try again</button>
    </div>
  );

  const p = d.profile;
  const g = d.google;
  const hasScore = p?.audit_score !== null && p?.audit_score !== undefined;
  const sc = (s: number) => s >= 76 ? C.green : s >= 56 ? C.gold : s >= 31 ? C.orange : C.red;

  const card: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: 24, padding: '1.25rem 1.2rem',
    marginBottom: '0.75rem', boxShadow: `0 2px 16px ${C.shadow}`,
  };
  const eyebrow: React.CSSProperties = {
    fontFamily: hd, fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase',
    letterSpacing: '2.5px', color: C.grey, margin: '0 0 0.6rem',
  };
  const statNum: React.CSSProperties = {
    fontFamily: hd, fontWeight: 800, fontSize: '2rem', color: C.charcoal,
    letterSpacing: '-1px', lineHeight: 1, margin: 0,
  };
  const smStat: React.CSSProperties = {
    fontFamily: hd, fontWeight: 800, fontSize: '1.25rem', color: C.charcoal,
    letterSpacing: '-0.5px', lineHeight: 1, margin: 0,
  };
  const metaText: React.CSSProperties = { fontFamily: bd, fontSize: '0.75rem', color: C.grey, margin: '0 0 0.15rem' };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', animation: 'fadeUp 0.8s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1 style={{ fontFamily: hd, fontWeight: 800, fontSize: 'clamp(22px, 4vw, 28px)', color: C.charcoal, letterSpacing: '-1px', margin: 0 }}>
            {p?.business_name || d.user.name}
          </h1>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, flexShrink: 0 }} title="Managed by Chocka" />
        </div>
        {p?.city && <p style={{ fontFamily: bd, color: C.grey, fontSize: '0.83rem', margin: '0.15rem 0 0' }}>{p.category}{p.city ? ` · ${p.city}` : ''}</p>}
      </div>

      {/* Score + Streak */}
      {hasScore && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.75rem', animation: 'fadeUp 0.8s ease 0.1s both' }}>
          <div style={card}>
            <p style={eyebrow}>Profile score</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
              <p style={{ ...statNum, color: sc(p.audit_score_after || p.audit_score), fontSize: '2.5rem' }}>{p.audit_score_after || p.audit_score}</p>
              <span style={{ fontFamily: bd, color: C.grey, fontSize: '0.8rem' }}>/100</span>
            </div>
            {p.audit_score_after && p.audit_score && (
              <span style={{ display: 'inline-block', marginTop: '0.35rem', fontFamily: bd, fontSize: '0.7rem', fontWeight: 600, color: C.green, background: 'rgba(45,139,78,0.08)', padding: '2px 8px', borderRadius: 100 }}>+{p.audit_score_after - p.audit_score} from setup</span>
            )}
          </div>
          <div style={card}>
            <p style={eyebrow}>Managed for</p>
            <p style={statNum}>{p.streak_weeks || 0}<span style={{ fontSize: '0.85rem', fontWeight: 500, fontFamily: bd, color: C.grey, letterSpacing: 0 }}> weeks</span></p>
            <span style={{ display: 'inline-block', marginTop: '0.35rem', fontFamily: bd, fontSize: '0.7rem', fontWeight: 600, color: C.green, background: 'rgba(45,139,78,0.08)', padding: '2px 8px', borderRadius: 100 }}>0 missed</span>
          </div>
        </div>
      )}

      {/* Google Live Metrics */}
      {g?.metrics && (g.metrics.views + g.metrics.searches + g.metrics.calls + g.metrics.directions + g.metrics.websiteClicks > 0) && (
        <div style={{ ...card, animation: 'fadeUp 0.8s ease 0.15s both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
            <p style={eyebrow}>This week on Google</p>
            <span style={{ fontFamily: bd, fontSize: '0.6rem', fontWeight: 600, color: C.green, background: 'rgba(45,139,78,0.08)', padding: '2px 8px', borderRadius: 100 }}>Live</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            <MetricCell label="Views" value={g.metrics.views + g.metrics.searches} />
            <MetricCell label="Calls" value={g.metrics.calls} highlight />
            <MetricCell label="Directions" value={g.metrics.directions} />
            <MetricCell label="Website" value={g.metrics.websiteClicks} />
            <MetricCell label="Total actions" value={g.metrics.totalActions} highlight />
            <MetricCell label="Searches" value={g.metrics.searches} />
          </div>
        </div>
      )}

      {/* If metrics are zero, show a softer message */}
      {g?.metrics && (g.metrics.views + g.metrics.searches + g.metrics.calls + g.metrics.directions + g.metrics.websiteClicks === 0) && (
        <div style={{ ...card, textAlign: 'center', padding: '1.5rem', animation: 'fadeUp 0.8s ease 0.15s both' }}>
          <p style={{ fontFamily: hd, fontWeight: 700, fontSize: '0.95rem', color: C.charcoal, margin: '0 0 0.2rem' }}>Google stats update weekly</p>
          <p style={{ fontFamily: bd, fontSize: '0.8rem', color: C.grey, margin: 0 }}>Your views, calls, and directions will appear here as data comes in.</p>
        </div>
      )}

      {/* Reviews */}
      {g?.reviews && g.reviews.total > 0 && (
        <div style={{ ...card, animation: 'fadeUp 0.8s ease 0.2s both' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
            <p style={eyebrow}>Reviews</p>
            {g.reviews.unreplied > 0 && <span style={{ fontFamily: bd, fontSize: '0.65rem', fontWeight: 600, color: C.orange, background: 'rgba(212,98,43,0.08)', padding: '2px 8px', borderRadius: 100 }}>{g.reviews.unreplied} need reply</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            <div>
              <p style={metaText}>Total</p>
              <p style={smStat}>{g.reviews.total}</p>
            </div>
            <div>
              <p style={metaText}>Average</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
                <p style={smStat}>{g.reviews.avgRating}</p>
                <span style={{ color: C.googleStar, fontSize: '0.85rem' }}>{'\u2605'}</span>
              </div>
            </div>
            <div>
              <p style={metaText}>Replied</p>
              <p style={{ ...smStat, color: g.reviews.replied === g.reviews.total ? C.green : C.orange }}>{g.reviews.replied}/{g.reviews.total}</p>
            </div>
          </div>
        </div>
      )}

      {/* Profile Health */}
      {g?.profile && (
        <div style={{ ...card, animation: 'fadeUp 0.8s ease 0.25s both' }}>
          <p style={eyebrow}>Profile health</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 1rem' }}>
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

      {/* Our work */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.75rem', animation: 'fadeUp 0.8s ease 0.3s both' }}>
        <div style={card}>
          <p style={eyebrow}>Posts by us</p>
          <p style={statNum}>{p?.total_posts || 0}</p>
        </div>
        <div style={card}>
          <p style={eyebrow}>Replies by us</p>
          <p style={statNum}>{p?.total_replies || 0}</p>
        </div>
      </div>

      {/* Next scheduled post */}
      {d.recentPosts?.find((x: any) => x.status === 'pending_approval' || x.status === 'pending') && (
        <div style={{ ...card, borderLeft: `3px solid ${C.orange}`, animation: 'fadeUp 0.8s ease 0.35s both' }}>
          <p style={{ ...eyebrow, color: C.orange }}>Next post</p>
          <p style={{ fontFamily: bd, fontSize: '0.85rem', color: C.charcoal, lineHeight: 1.55, margin: '0 0 0.3rem' }}>
            {d.recentPosts.find((x: any) => x.status === 'pending_approval' || x.status === 'pending').content}
          </p>
          <p style={{ fontFamily: bd, fontSize: '0.7rem', color: C.grey, margin: 0 }}>
            {formatDate(d.recentPosts.find((x: any) => x.status === 'pending_approval' || x.status === 'pending').scheduled_for)}
          </p>
        </div>
      )}

      {/* Activity feed */}
      {d.activity?.length > 0 && (
        <div style={{ ...card, animation: 'fadeUp 0.8s ease 0.4s both' }}>
          <p style={eyebrow}>Recent activity</p>
          {d.activity.slice(0, 6).map((a: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.type === 'post' ? C.green : a.type === 'reply' ? C.orange : C.gold, flexShrink: 0 }} />
              <span style={{ fontFamily: bd, fontSize: '0.8rem', color: C.charcoal, flex: 1 }}>{a.action}</span>
              <span style={{ fontFamily: bd, fontSize: '0.68rem', color: C.grey, flexShrink: 0 }}>{timeAgo(a.date)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Latest reviews */}
      {d.recentReviews?.length > 0 && (
        <div style={{ ...card, animation: 'fadeUp 0.8s ease 0.45s both' }}>
          <p style={eyebrow}>Latest reviews</p>
          {d.recentReviews.slice(0, 4).map((r: any, i: number) => (
            <div key={i} style={{ padding: '0.5rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.1rem' }}>
                <span style={{ fontFamily: bd, fontWeight: 600, fontSize: '0.8rem', color: C.charcoal }}>{r.reviewer_name}</span>
                <span style={{ color: C.googleStar, fontSize: '0.75rem' }}>{'\u2605'.repeat(r.rating)}</span>
              </div>
              {r.comment && <p style={{ fontFamily: bd, fontSize: '0.8rem', color: C.text, margin: '0.1rem 0 0.35rem', lineHeight: 1.5 }}>{r.comment}</p>}
              {r.reply_content && (
                <div style={{ background: 'rgba(212,98,43,0.04)', borderRadius: 16, padding: '0.5rem 0.7rem', borderLeft: `2px solid ${C.orange}` }}>
                  <p style={{ fontFamily: hd, fontSize: '0.65rem', fontWeight: 700, color: C.orange, letterSpacing: '1.5px', textTransform: 'uppercase' as const, margin: '0 0 0.1rem' }}>Our reply</p>
                  <p style={{ fontFamily: bd, fontSize: '0.78rem', color: C.charcoal, margin: 0, lineHeight: 1.5 }}>{r.reply_content}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!g && d.recentPosts?.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '2.5rem 1.5rem', animation: 'fadeUp 0.8s ease 0.2s both' }}>
          <p style={{ fontFamily: hd, fontWeight: 700, fontSize: '1rem', color: C.charcoal, margin: '0 0 0.3rem' }}>Your first post is on its way</p>
          <p style={{ fontFamily: bd, fontSize: '0.83rem', color: C.grey, margin: 0, lineHeight: 1.5 }}>We will write and publish to your Google profile this week. Your stats will appear here once we get started.</p>
        </div>
      )}

      {/* Referral */}
      <RefBlock code={d.user.referral_code} />
    </div>
  );
}

function MetricCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p style={{ fontFamily: "'Inter', system-ui", fontSize: '0.7rem', color: '#A09A93', margin: '0 0 0.15rem' }}>{label}</p>
      <p style={{ fontFamily: "'Cabinet Grotesk', sans-serif", fontWeight: 800, fontSize: '1.25rem', color: highlight ? '#D4622B' : '#2A2520', letterSpacing: '-0.5px', lineHeight: 1, margin: 0 }}>{value}</p>
    </div>
  );
}

function HealthRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#2D8B4E' : '#E7C36A', flexShrink: 0 }} />
      <span style={{ fontFamily: "'Inter', system-ui", fontSize: '0.78rem', color: '#2A2520', flex: 1 }}>{label}</span>
      <span style={{ fontFamily: "'Inter', system-ui", fontSize: '0.7rem', color: '#A09A93' }}>{detail}</span>
    </div>
  );
}

function RefBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const link = `https://chocka.co.uk/ref/${code}`;
  return (
    <div style={{ background: 'rgba(212,98,43,0.04)', borderRadius: 24, padding: '1.2rem', marginTop: '0.5rem', boxShadow: '0 2px 16px rgba(42,37,32,.04)', animation: 'fadeUp 0.8s ease 0.5s both' }}>
      <p style={{ fontFamily: "'Cabinet Grotesk', sans-serif", fontWeight: 700, fontSize: '0.95rem', color: '#2A2520', margin: '0 0 0.15rem' }}>Refer a mate</p>
      <p style={{ fontFamily: "'Inter', system-ui", fontSize: '0.78rem', color: '#A09A93', margin: '0 0 0.65rem' }}>You both get a free month.</p>
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        <div style={{ flex: 1, background: '#FFFFFF', borderRadius: 100, padding: '0.5rem 0.75rem', fontFamily: "'Inter', system-ui", fontSize: '0.78rem', color: '#A09A93', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
        <button onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: '#2A2520', color: '#F8F6F3', border: 'none', padding: '0.5rem 1rem', borderRadius: 100, fontFamily: "'Inter', system-ui", fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>{copied ? 'Copied!' : 'Copy'}</button>
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
