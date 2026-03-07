'use client';

import { useState, useEffect } from 'react';

const hd = "'Cabinet Grotesk', sans-serif";
const bd = "'Inter', system-ui, sans-serif";
const mono = "'DM Mono', monospace";
const C = {
  charcoal: '#2A2520', cream: '#F8F6F3', orange: '#D4622B', orangeLight: 'rgba(212,98,43,0.06)',
  gold: '#E7C36A', green: '#2D8B4E', greenLight: 'rgba(45,139,78,0.08)',
  red: '#D93025', grey: '#A09A93', text: '#5A554F', warmBg: '#F0EDE8',
  star: '#FBBC04', card: '#FAFAF8', border: 'rgba(0,0,0,0.07)',
};
const shadow = '0 2px 16px rgba(42,37,32,.04)';

export default function DashboardPage() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard').then(r => r.ok ? r.json() : Promise.reject()).then(data => { setD(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '6rem 0' }}><div style={{ width: 24, height: 24, border: `3px solid ${C.warmBg}`, borderTopColor: C.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>;
  if (!d) return <div style={{ textAlign: 'center', padding: '5rem 1rem' }}><p style={{ color: C.grey }}>Could not load dashboard</p><button onClick={() => window.location.reload()} style={{ color: C.orange, background: 'none', border: 'none', cursor: 'pointer', fontFamily: bd, fontWeight: 600, marginTop: 8 }}>Try again</button></div>;

  const p = d.profile;
  const g = d.google;
  const hasScore = p?.audit_score != null;
  const sc = (s: number) => s >= 76 ? C.green : s >= 56 ? C.gold : s >= 31 ? C.orange : C.red;
  const anim = (del: string) => ({ animation: `fadeUp 0.6s ease ${del} both` } as React.CSSProperties);
  const card: React.CSSProperties = { background: C.card, borderRadius: 16, padding: '14px 16px', marginBottom: 10, boxShadow: shadow };
  const label: React.CSSProperties = { fontFamily: bd, fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.grey, marginBottom: 8 };
  const bigNum: React.CSSProperties = { fontFamily: hd, fontWeight: 800, lineHeight: 1, margin: 0, letterSpacing: '-1px' };

  // Calculate estimated value from calls
  const estCalls = g?.metrics?.calls || 0;
  const avgJobValue = 180; // reasonable for tradespeople
  const estValue = estCalls * avgJobValue;
  const roi = estValue > 0 ? Math.round(estValue / 29) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16, ...anim('0s') }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ fontFamily: bd, fontWeight: 600, fontSize: 20, color: C.charcoal, margin: 0 }}>{p?.business_name || d.user.name}</h1>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, animation: 'pulse 2s infinite' }} />
        </div>
        {(p?.city || g?.profile?.primaryCategory) && <p style={{ fontFamily: bd, color: C.grey, fontSize: 13, margin: '2px 0 0' }}>{g?.profile?.primaryCategory || p?.category}{p?.city ? ` · ${p.city}` : ''}</p>}
        <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.85)} }`}</style>
      </div>

      {/* Score + Managed */}
      {hasScore && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10, ...anim('0.05s') }}>
          <div style={card}>
            <p style={label}>Profile Score</p>
            <p style={{ ...bigNum, color: sc(p.audit_score_after || p.audit_score), fontSize: 38 }}>{p.audit_score_after || p.audit_score}<span style={{ fontSize: 16, color: C.grey, fontWeight: 400 }}>/100</span></p>
            {p.audit_score_after && p.audit_score && <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600, color: C.green, background: C.greenLight, padding: '3px 8px', borderRadius: 20 }}>↑ +{p.audit_score_after - p.audit_score} from setup</span>}
          </div>
          <div style={card}>
            <p style={label}>Managed For</p>
            <p style={{ ...bigNum, color: C.charcoal, fontSize: 38 }}>{p.streak_weeks || 0}<span style={{ fontSize: 14, color: C.grey, fontWeight: 400 }}> wks</span></p>
            <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600, color: C.green, background: C.greenLight, padding: '3px 8px', borderRadius: 20 }}>0 tasks missed</span>
          </div>
        </div>
      )}

      {/* Estimated value banner */}
      {estCalls > 0 && (
        <div style={{ background: C.charcoal, borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, ...anim('0.1s') }}>
          <div>
            <p style={{ fontFamily: bd, fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Est. work generated</p>
            <p style={{ fontFamily: hd, fontSize: 28, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-1px' }}>£{estValue.toLocaleString()}</p>
            <p style={{ fontFamily: bd, fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '2px 0 0' }}>Based on {estCalls} calls × £{avgJobValue} avg job</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontFamily: hd, fontSize: 22, fontWeight: 800, color: '#7DFF9B', margin: 0 }}>{roi}×</p>
            <p style={{ fontFamily: bd, fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>return on £29/mo</p>
          </div>
        </div>
      )}

      {/* Google Stats */}
      {g?.metrics && (g.metrics.views + g.metrics.calls + g.metrics.directions + g.metrics.websiteClicks > 0) && (
        <div style={{ ...card, ...anim('0.15s') }}>
          <p style={label}>Google Stats · Last 28 days</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <StatCell label="Profile views" value={g.metrics.views.toLocaleString()} />
            <StatCell label="Calls" value={String(g.metrics.calls)} highlight />
            <StatCell label="Directions" value={String(g.metrics.directions)} />
            <StatCell label="Website clicks" value={String(g.metrics.websiteClicks)} />
            <StatCell label="Total actions" value={String(g.metrics.totalActions)} highlight />
            {g.reviews && <StatCell label="Star rating" value={String(g.reviews.avgRating)} star />}
          </div>
        </div>
      )}

      {/* This week */}
      {d.plan && (
        <div style={{ ...card, ...anim('0.2s') }}>
          <p style={label}>This Week</p>
          {d.plan.map((item: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.status === 'done' ? C.green : item.status === 'today' ? C.orange : item.status === 'ongoing' ? C.green : '#ddd', flexShrink: 0 }} />
                <span style={{ fontFamily: bd, fontSize: 13.5, color: item.status === 'done' ? C.grey : C.charcoal, textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>{item.action}</span>
              </div>
              <span style={{ fontFamily: bd, fontSize: 12, color: item.status === 'today' ? C.orange : C.grey }}>{item.day}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reviews */}
      {g?.reviews && g.reviews.total > 0 && (
        <div style={{ ...card, ...anim('0.25s') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <p style={{ ...label, margin: 0 }}>Reviews</p>
            {g.reviews.unreplied > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: C.orange, background: C.orangeLight, padding: '3px 8px', borderRadius: 20 }}>{g.reviews.unreplied} need reply</span>}
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
            <div><p style={{ fontFamily: bd, fontSize: 10, color: C.grey, margin: '0 0 2px' }}>Total</p><p style={{ fontFamily: hd, fontSize: 22, fontWeight: 800, color: C.charcoal, margin: 0 }}>{g.reviews.total}</p></div>
            <div><p style={{ fontFamily: bd, fontSize: 10, color: C.grey, margin: '0 0 2px' }}>Average</p><p style={{ fontFamily: hd, fontSize: 22, fontWeight: 800, color: C.charcoal, margin: 0 }}>{g.reviews.avgRating} <span style={{ color: C.star, fontSize: 16 }}>{'\u2605'}</span></p></div>
            <div><p style={{ fontFamily: bd, fontSize: 10, color: C.grey, margin: '0 0 2px' }}>Replied</p><p style={{ fontFamily: hd, fontSize: 22, fontWeight: 800, color: g.reviews.replied === g.reviews.total ? C.green : C.orange, margin: 0 }}>{g.reviews.replied}/{g.reviews.total}</p></div>
          </div>
          {/* Review cards */}
          {g.reviews.list?.slice(0, 5).map((r: any, i: number) => (
            <div key={i} style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontFamily: bd, fontWeight: 600, fontSize: 13, color: C.charcoal }}>{r.name}</span>
                  <span style={{ color: C.star, fontSize: 11 }}>{'\u2605'.repeat(r.rating)}<span style={{ color: '#E0DDD8' }}>{'\u2605'.repeat(5 - r.rating)}</span></span>
                </div>
                <span style={{ fontFamily: bd, fontSize: 11, color: C.grey }}>{timeAgo(r.date)}</span>
              </div>
              {r.comment && <p style={{ fontFamily: bd, fontSize: 12.5, color: C.text, margin: '2px 0 0', lineHeight: 1.45 }}>{r.comment.slice(0, 140)}{r.comment.length > 140 ? '...' : ''}</p>}
              {r.hasReply && <p style={{ fontFamily: bd, fontSize: 11, color: C.green, margin: '4px 0 0', fontWeight: 500 }}>✓ Replied</p>}
            </div>
          ))}
        </div>
      )}

      {/* Profile health */}
      {g?.profile && (
        <div style={{ ...card, ...anim('0.3s') }}>
          <p style={label}>Profile Health</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            <HI ok={g.profile.descriptionLength >= 100} label="Description" val={g.profile.descriptionLength > 0 ? 'Set ✓' : 'Missing'} />
            <HI ok={g.profile.hoursSet} label="Hours" val={g.profile.hoursSet ? 'Set ✓' : 'Not set'} />
            <HI ok={g.profile.servicesCount >= 3} label="Services" val={`${g.profile.servicesCount} listed`} />
            <HI ok={g.profile.categoriesCount >= 2} label="Categories" val={`${g.profile.categoriesCount} set`} />
            <HI ok={g.profile.hasPhone} label="Phone" val={g.profile.hasPhone ? 'Set ✓' : 'Missing'} />
            <HI ok={g.profile.hasWebsite} label="Website" val={g.profile.hasWebsite ? 'Set ✓' : 'Missing'} />
            <HI ok={(g.photos?.total || 0) >= 3} label="Photos" val={`${g.photos?.total || 0} up`} />
            <HI ok={!!g.posts?.lastPostDate} label="Last post" val={g.posts?.lastPostDate ? timeAgo(g.posts.lastPostDate) : 'Never'} />
          </div>
          {/* Alert for unanswered reviews */}
          {g.reviews?.unreplied > 0 && (
            <div style={{ background: 'rgba(231,195,106,0.1)', borderRadius: 12, padding: '11px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10 }}>
              <span style={{ fontSize: 14, marginTop: 1 }}>⚠️</span>
              <p style={{ fontFamily: bd, fontSize: 12, color: '#B8860B', lineHeight: 1.4, fontWeight: 500, margin: 0 }}>{g.reviews.unreplied} unanswered review{g.reviews.unreplied > 1 ? 's' : ''} — we'll handle {g.reviews.unreplied > 1 ? 'these' : 'this'} once review management is active.</p>
            </div>
          )}
        </div>
      )}

      {/* Activity feed */}
      {d.activity?.length > 0 && (
        <div style={{ ...card, ...anim('0.35s') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <p style={{ ...label, margin: 0 }}>Recent Activity</p>
          </div>
          {d.activity.slice(0, 6).map((a: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '6px 0' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, background: a.type === 'post' ? C.orangeLight : a.type === 'reply' ? C.greenLight : '#EEF2FF' }}>
                {a.type === 'post' ? '📝' : a.type === 'reply' ? '⭐' : '📊'}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: bd, fontSize: 13, fontWeight: 500, color: C.charcoal, margin: 0, lineHeight: 1.3 }}>{a.action}</p>
                <p style={{ fontFamily: bd, fontSize: 11, color: C.grey, margin: '2px 0 0' }}>{timeAgo(a.date)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Posts + Replies */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10, ...anim('0.4s') }}>
        <div style={card}>
          <p style={label}>Posts by us</p>
          <p style={{ ...bigNum, color: C.charcoal, fontSize: 38 }}>{p?.total_posts || 0}</p>
          <p style={{ fontFamily: bd, fontSize: 11, color: C.grey, margin: '2px 0 0' }}>since you joined</p>
        </div>
        <div style={card}>
          <p style={label}>Replies by us</p>
          <p style={{ ...bigNum, color: C.charcoal, fontSize: 38 }}>{p?.total_replies || 0}</p>
          <p style={{ fontFamily: bd, fontSize: 11, color: C.grey, margin: '2px 0 0' }}>reviews handled</p>
        </div>
      </div>

      {/* Next scheduled post */}
      {d.recentPosts?.find((x: any) => x.status === 'pending_approval' || x.status === 'pending') && (() => {
        const np = d.recentPosts.find((x: any) => x.status === 'pending_approval' || x.status === 'pending');
        return (
          <div style={{ ...card, borderLeft: `3px solid ${C.orange}`, ...anim('0.45s') }}>
            <p style={{ ...label, color: C.orange }}>Next post</p>
            <p style={{ fontFamily: bd, fontSize: 13, color: C.charcoal, lineHeight: 1.5, margin: '0 0 4px' }}>{np.content}</p>
            <p style={{ fontFamily: bd, fontSize: 11, color: C.grey, margin: 0 }}>{fmtDate(np.scheduled_for)}</p>
          </div>
        );
      })()}

      {/* Empty state */}
      {!g && d.recentPosts?.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '2rem', ...anim('0.2s') }}>
          <p style={{ fontFamily: hd, fontWeight: 700, fontSize: 15, color: C.charcoal, margin: '0 0 4px' }}>Your first post is on its way</p>
          <p style={{ fontFamily: bd, fontSize: 13, color: C.grey, margin: 0 }}>We will write and publish to your Google profile this week.</p>
        </div>
      )}

      {/* Refer a mate */}
      <div style={{ ...card, ...anim('0.5s') }}>
        <p style={{ fontFamily: bd, fontSize: 15, fontWeight: 600, color: C.charcoal, margin: '0 0 2px' }}>Refer a mate 👋</p>
        <p style={{ fontFamily: bd, fontSize: 12, color: C.grey, margin: '0 0 10px' }}>You both get a free month.</p>
        <RefCopy code={d.user.referral_code} />
      </div>

      <div style={{ height: 40 }} />
    </div>
  );
}

function StatCell({ label, value, highlight, star }: { label: string; value: string; highlight?: boolean; star?: boolean }) {
  return (
    <div style={{ background: '#F5F3EF', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
      <p style={{ fontFamily: "'Cabinet Grotesk', sans-serif", fontSize: 22, fontWeight: 800, lineHeight: 1, margin: 0, color: highlight ? '#D4622B' : '#2A2520' }}>
        {value}{star && <span style={{ color: '#FBBC04', fontSize: 14, marginLeft: 2 }}>{'\u2605'}</span>}
      </p>
      <p style={{ fontFamily: "'Inter', system-ui", fontSize: 10, color: '#A09A93', marginTop: 4, lineHeight: 1.3 }}>{label}</p>
    </div>
  );
}

function HI({ ok, label, val }: { ok: boolean; label: string; val: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontFamily: "'Inter', system-ui", fontSize: 13 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? '#2D8B4E' : '#E8A020', flexShrink: 0 }} />
      <span style={{ color: '#2A2520', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#A09A93' }}>{val}</span>
    </div>
  );
}

function RefCopy({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input readOnly value={`chocka.co.uk/ref/${code}`} style={{ flex: 1, background: '#F0EDE8', border: 'none', borderRadius: 10, padding: '9px 12px', fontFamily: "'Inter', system-ui", fontSize: 12, color: '#A09A93', outline: 'none' }} />
      <button onClick={() => { navigator.clipboard.writeText(`https://chocka.co.uk/ref/${code}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: '#2A2520', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontFamily: "'Inter', system-ui", fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>{copied ? 'Copied!' : 'Copy'}</button>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today at ${t}`;
  if (d.toDateString() === tmrw.toDateString()) return `Tomorrow at ${t}`;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ` at ${t}`;
}
