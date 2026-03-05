'use client';

import { useState, useEffect } from 'react';

const hd = "'Cabinet Grotesk', sans-serif";
const bd = "'Inter', system-ui, sans-serif";
const C = {
  charcoal: '#2A2520', cream: '#F8F6F3', orange: '#D4622B', gold: '#E7C36A',
  green: '#2D8B4E', red: '#D93025', grey: '#A09A93', text: '#5A554F',
  warmBg: '#F0EDE8', star: '#FBBC04',
};
const shadow = '0 2px 16px rgba(42,37,32,.04)';
const card: React.CSSProperties = { background: '#FFF', borderRadius: 24, padding: '1.2rem', marginBottom: '0.65rem', boxShadow: shadow };
const eye: React.CSSProperties = { fontFamily: hd, fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '2.5px', color: C.grey, margin: '0 0 0.55rem' };
const big: React.CSSProperties = { fontFamily: hd, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, margin: 0 };
const sm: React.CSSProperties = { fontFamily: hd, fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.5px', lineHeight: 1, margin: 0 };
const meta: React.CSSProperties = { fontFamily: bd, fontSize: '0.72rem', color: C.grey, margin: '0 0 0.12rem' };
const pill = (bg: string, color: string): React.CSSProperties => ({ display: 'inline-block', fontFamily: bd, fontSize: '0.65rem', fontWeight: 600, color, background: bg, padding: '2px 8px', borderRadius: 100 });

export default function DashboardPage() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard').then(r => r.ok ? r.json() : Promise.reject()).then(data => { setD(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '6rem 0' }}><div style={{ width: 24, height: 24, border: `3px solid ${C.warmBg}`, borderTopColor: C.orange, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>;
  if (!d) return <div style={{ textAlign: 'center', padding: '5rem 1rem' }}><p style={{ color: C.grey }}>Could not load dashboard</p><button onClick={() => window.location.reload()} style={{ color: C.orange, background: 'none', border: 'none', cursor: 'pointer', fontFamily: bd, fontWeight: 600, marginTop: '0.5rem' }}>Try again</button></div>;

  const p = d.profile;
  const g = d.google;
  const hasScore = p?.audit_score != null;
  const sc = (s: number) => s >= 76 ? C.green : s >= 56 ? C.gold : s >= 31 ? C.orange : C.red;
  const anim = (delay: string) => ({ animation: `fadeUp 0.8s ease ${delay} both` } as React.CSSProperties);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.2rem', ...anim('0s') }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1 style={{ fontFamily: hd, fontWeight: 800, fontSize: 'clamp(20px, 4vw, 26px)', color: C.charcoal, letterSpacing: '-1px', margin: 0 }}>{p?.business_name || d.user.name}</h1>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
        </div>
        {p?.city && <p style={{ fontFamily: bd, color: C.grey, fontSize: '0.8rem', margin: '0.1rem 0 0' }}>{p.category} · {p.city}</p>}
        {!p?.city && g?.profile?.primaryCategory && <p style={{ fontFamily: bd, color: C.grey, fontSize: '0.8rem', margin: '0.1rem 0 0' }}>{g.profile.primaryCategory}</p>}
      </div>

      {/* Score + Streak */}
      {hasScore && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', marginBottom: '0.65rem', ...anim('0.05s') }}>
          <div style={card}>
            <p style={eye}>Profile score</p>
            <p style={{ ...big, color: sc(p.audit_score_after || p.audit_score), fontSize: '2.4rem' }}>{p.audit_score_after || p.audit_score}<span style={{ fontSize: '0.8rem', fontWeight: 500, fontFamily: bd, color: C.grey, letterSpacing: 0 }}>/100</span></p>
            {p.audit_score_after && p.audit_score && <span style={{ ...pill('rgba(45,139,78,0.08)', C.green), marginTop: '0.3rem' }}>+{p.audit_score_after - p.audit_score} from setup</span>}
          </div>
          <div style={card}>
            <p style={eye}>Managed for</p>
            <p style={{ ...big, color: C.charcoal, fontSize: '2.4rem' }}>{p.streak_weeks || 0}<span style={{ fontSize: '0.8rem', fontWeight: 500, fontFamily: bd, color: C.grey, letterSpacing: 0 }}> wks</span></p>
            <span style={{ ...pill('rgba(45,139,78,0.08)', C.green), marginTop: '0.3rem' }}>0 missed</span>
          </div>
        </div>
      )}

      {/* This week plan */}
      {d.plan && (
        <div style={{ ...card, ...anim('0.1s') }}>
          <p style={eye}>This week</p>
          {d.plan.map((item: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.status === 'done' ? C.green : item.status === 'today' ? C.orange : item.status === 'ongoing' ? C.green : C.warmBg, flexShrink: 0 }} />
              <span style={{ fontFamily: bd, fontSize: '0.78rem', color: item.status === 'done' ? C.grey : C.charcoal, flex: 1, textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>{item.action}</span>
              <span style={{ fontFamily: hd, fontSize: '0.68rem', fontWeight: 700, color: item.status === 'today' ? C.orange : C.grey, letterSpacing: '0.5px' }}>{item.day}</span>
            </div>
          ))}
        </div>
      )}

      {/* Google metrics */}
      {g?.metrics && (g.metrics.views + g.metrics.searches + g.metrics.calls + g.metrics.directions + g.metrics.websiteClicks > 0) ? (
        <div style={{ ...card, ...anim('0.15s') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem' }}>
            <p style={{ ...eye, margin: 0 }}>This week on Google</p>
            <span style={pill('rgba(45,139,78,0.08)', C.green)}>Live</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem' }}>
            <MC label="Views" value={g.metrics.views + g.metrics.searches} />
            <MC label="Calls" value={g.metrics.calls} hl />
            <MC label="Directions" value={g.metrics.directions} />
            <MC label="Website" value={g.metrics.websiteClicks} />
            <MC label="Actions" value={g.metrics.totalActions} hl />
            <MC label="Searches" value={g.metrics.searches} />
          </div>
        </div>
      ) : g?.metrics ? (
        <div style={{ ...card, textAlign: 'center', padding: '1.2rem', ...anim('0.15s') }}>
          <p style={{ fontFamily: hd, fontWeight: 700, fontSize: '0.9rem', color: C.charcoal, margin: '0 0 0.15rem' }}>Google stats update weekly</p>
          <p style={{ fontFamily: bd, fontSize: '0.78rem', color: C.grey, margin: 0 }}>Views, calls, and directions will appear here.</p>
        </div>
      ) : null}

      {/* Reviews from Google */}
      {g?.reviews && g.reviews.total > 0 && (
        <div style={{ ...card, ...anim('0.2s') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem' }}>
            <p style={{ ...eye, margin: 0 }}>Reviews</p>
            {g.reviews.unreplied > 0 && <span style={pill('rgba(212,98,43,0.08)', C.orange)}>{g.reviews.unreplied} need reply</span>}
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.7rem' }}>
            <div><p style={meta}>Total</p><p style={sm}>{g.reviews.total}</p></div>
            <div><p style={meta}>Average</p><p style={sm}>{g.reviews.avgRating} <span style={{ color: C.star, fontSize: '0.85rem' }}>{'\u2605'}</span></p></div>
            <div><p style={meta}>Replied</p><p style={{ ...sm, color: g.reviews.replied === g.reviews.total ? C.green : C.orange }}>{g.reviews.replied}/{g.reviews.total}</p></div>
          </div>
          {/* Actual review cards */}
          {g.reviews.list?.slice(0, 3).map((r: any, i: number) => (
            <div key={i} style={{ padding: '0.5rem 0', borderTop: i > 0 ? '1px solid rgba(42,37,32,0.04)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.1rem' }}>
                <span style={{ fontFamily: bd, fontWeight: 600, fontSize: '0.78rem', color: C.charcoal }}>{r.name}</span>
                <span style={{ color: C.star, fontSize: '0.7rem' }}>{'\u2605'.repeat(r.rating)}<span style={{ color: C.warmBg }}>{'\u2605'.repeat(5 - r.rating)}</span></span>
                <span style={{ fontFamily: bd, fontSize: '0.65rem', color: C.grey, marginLeft: 'auto' }}>{timeAgo(r.date)}</span>
              </div>
              {r.comment && <p style={{ fontFamily: bd, fontSize: '0.78rem', color: C.text, margin: '0.1rem 0 0', lineHeight: 1.45 }}>{r.comment.slice(0, 120)}{r.comment.length > 120 ? '...' : ''}</p>}
              {r.hasReply && <p style={{ fontFamily: bd, fontSize: '0.7rem', color: C.green, margin: '0.2rem 0 0', fontWeight: 500 }}>✓ Replied</p>}
            </div>
          ))}
        </div>
      )}

      {/* Profile health */}
      {g?.profile && (
        <div style={{ ...card, ...anim('0.25s') }}>
          <p style={eye}>Profile health</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.15rem 0.75rem' }}>
            <HR ok={g.profile.descriptionLength >= 100} label="Description" detail={g.profile.descriptionLength > 0 ? `${g.profile.descriptionLength} chars` : 'Missing'} />
            <HR ok={g.profile.hoursSet} label="Hours" detail={g.profile.hoursSet ? 'Set' : 'Not set'} />
            <HR ok={g.profile.servicesCount >= 3} label="Services" detail={`${g.profile.servicesCount} listed`} />
            <HR ok={g.profile.categoriesCount >= 2} label="Categories" detail={`${g.profile.categoriesCount} set`} />
            <HR ok={g.profile.hasPhone} label="Phone" detail={g.profile.hasPhone ? 'Set' : 'Missing'} />
            <HR ok={g.profile.hasWebsite} label="Website" detail={g.profile.hasWebsite ? 'Set' : 'Missing'} />
            <HR ok={(g.photos?.total || 0) >= 3} label="Photos" detail={`${g.photos?.total || 0} uploaded`} />
            <HR ok={!!g.posts.lastPostDate} label="Last post" detail={g.posts.lastPostDate ? timeAgo(g.posts.lastPostDate) : 'Never'} />
          </div>
        </div>
      )}

      {/* Services snapshot */}
      {g?.profile?.serviceNames?.length > 0 && (
        <div style={{ ...card, ...anim('0.3s') }}>
          <p style={eye}>Services listed</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {g.profile.serviceNames.map((s: string, i: number) => (
              <span key={i} style={{ background: C.cream, borderRadius: 100, padding: '0.25rem 0.6rem', fontFamily: bd, fontSize: '0.72rem', color: C.text }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Our work */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', marginBottom: '0.65rem', ...anim('0.35s') }}>
        <div style={card}>
          <p style={eye}>Posts by us</p>
          <p style={{ ...big, color: C.charcoal, fontSize: '2rem' }}>{p?.total_posts || 0}</p>
        </div>
        <div style={card}>
          <p style={eye}>Replies by us</p>
          <p style={{ ...big, color: C.charcoal, fontSize: '2rem' }}>{p?.total_replies || 0}</p>
        </div>
      </div>

      {/* Next scheduled post */}
      {d.recentPosts?.find((x: any) => x.status === 'pending_approval' || x.status === 'pending') && (() => {
        const np = d.recentPosts.find((x: any) => x.status === 'pending_approval' || x.status === 'pending');
        return (
          <div style={{ ...card, borderLeft: `3px solid ${C.orange}`, ...anim('0.4s') }}>
            <p style={{ ...eye, color: C.orange }}>Next post</p>
            <p style={{ fontFamily: bd, fontSize: '0.82rem', color: C.charcoal, lineHeight: 1.5, margin: '0 0 0.25rem' }}>{np.content}</p>
            <p style={{ fontFamily: bd, fontSize: '0.68rem', color: C.grey, margin: 0 }}>{fmtDate(np.scheduled_for)}</p>
          </div>
        );
      })()}

      {/* Activity feed */}
      {d.activity?.length > 0 && (
        <div style={{ ...card, ...anim('0.45s') }}>
          <p style={eye}>Recent activity</p>
          {d.activity.slice(0, 6).map((a: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.3rem 0' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.type === 'post' ? C.green : a.type === 'reply' ? C.orange : C.gold, flexShrink: 0 }} />
              <span style={{ fontFamily: bd, fontSize: '0.78rem', color: C.charcoal, flex: 1 }}>{a.action}</span>
              <span style={{ fontFamily: bd, fontSize: '0.65rem', color: C.grey, flexShrink: 0 }}>{timeAgo(a.date)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Categories */}
      {g?.profile?.additionalCategories?.length > 0 && (
        <div style={{ ...card, ...anim('0.5s') }}>
          <p style={eye}>Categories</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            <span style={{ background: C.orange, color: '#FFF', borderRadius: 100, padding: '0.25rem 0.6rem', fontFamily: bd, fontSize: '0.72rem', fontWeight: 600 }}>{g.profile.primaryCategory}</span>
            {g.profile.additionalCategories.map((c: string, i: number) => (
              <span key={i} style={{ background: C.cream, borderRadius: 100, padding: '0.25rem 0.6rem', fontFamily: bd, fontSize: '0.72rem', color: C.text }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!g && d.recentPosts?.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '2rem 1.5rem', ...anim('0.2s') }}>
          <p style={{ fontFamily: hd, fontWeight: 700, fontSize: '0.95rem', color: C.charcoal, margin: '0 0 0.25rem' }}>Your first post is on its way</p>
          <p style={{ fontFamily: bd, fontSize: '0.8rem', color: C.grey, margin: 0, lineHeight: 1.5 }}>We will write and publish to your Google profile this week.</p>
        </div>
      )}

      {/* Referral */}
      <div style={{ background: 'rgba(212,98,43,0.04)', borderRadius: 24, padding: '1.1rem', marginTop: '0.3rem', boxShadow: shadow, ...anim('0.55s') }}>
        <p style={{ fontFamily: hd, fontWeight: 700, fontSize: '0.9rem', color: C.charcoal, margin: '0 0 0.12rem' }}>Refer a mate</p>
        <p style={{ fontFamily: bd, fontSize: '0.75rem', color: C.grey, margin: '0 0 0.55rem' }}>You both get a free month.</p>
        <RefCopy code={d.user.referral_code} />
      </div>
    </div>
  );
}

function MC({ label, value, hl }: { label: string; value: number; hl?: boolean }) {
  return <div><p style={meta}>{label}</p><p style={{ ...sm, color: hl ? C.orange : C.charcoal }}>{value}</p></div>;
}

function HR({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.22rem 0' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: ok ? C.green : C.gold, flexShrink: 0 }} />
      <span style={{ fontFamily: bd, fontSize: '0.75rem', color: C.charcoal, flex: 1 }}>{label}</span>
      <span style={{ fontFamily: bd, fontSize: '0.68rem', color: C.grey }}>{detail}</span>
    </div>
  );
}

function RefCopy({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const link = `https://chocka.co.uk/ref/${code}`;
  return (
    <div style={{ display: 'flex', gap: '0.3rem' }}>
      <div style={{ flex: 1, background: '#FFF', borderRadius: 100, padding: '0.45rem 0.7rem', fontFamily: bd, fontSize: '0.75rem', color: C.grey, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
      <button onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: C.charcoal, color: C.cream, border: 'none', padding: '0.45rem 0.9rem', borderRadius: 100, fontFamily: bd, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>{copied ? 'Copied!' : 'Copy'}</button>
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
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
