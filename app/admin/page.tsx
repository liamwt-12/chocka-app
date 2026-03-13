'use client';

import { useState, useEffect } from 'react';

const V = { bg:'#F0EDE8',card:'#FAFAF8',card2:'#F5F3EF',orange:'#E8541A',orangeLight:'#FFF0EB',green:'#2D7A4F',greenLight:'#E8F5EE',amber:'#B8860B',amberLight:'#FFF8E6',red:'#D93025',redLight:'#FDECEA',text:'#1A1A1A',textMid:'#555',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const card: React.CSSProperties = { background:V.card, borderRadius:16, padding:16, boxShadow:V.shadow };
const lbl: React.CSSProperties = { fontFamily:sans, fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:V.textSoft, marginBottom:10 };

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin?password=${encodeURIComponent(password)}`);
      if (!res.ok) { setError('Wrong password'); setLoading(false); return; }
      const d = await res.json();
      setData(d);
      setAuthed(true);
    } catch {
      setError('Failed to load');
    }
    setLoading(false);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin?password=${encodeURIComponent(password)}`);
      const d = await res.json();
      setData(d);
    } catch {}
    setLoading(false);
  };

  if (!authed) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:V.bg, padding:'1.5rem' }}>
        <div style={{ width:'100%', maxWidth:340 }}>
          <div style={{ fontFamily:mono, fontSize:14, fontWeight:500, letterSpacing:'0.12em', color:V.orange, marginBottom:24 }}>CHOCKA ADMIN</div>
          <div style={{ ...card, padding:'24px' }}>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
              style={{ width:'100%', background:V.bg, border:'none', borderRadius:10, padding:'11px 14px', fontSize:14, fontFamily:sans, outline:'none', boxSizing:'border-box', marginBottom:10 }}
            />
            {error && <div style={{ fontSize:12, color:V.red, marginBottom:8, fontFamily:sans }}>{error}</div>}
            <button onClick={login} disabled={loading} style={{ width:'100%', background:V.text, color:'white', border:'none', borderRadius:10, padding:'12px', fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:sans }}>
              {loading ? 'Loading...' : 'Enter'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const s = data?.summary;
  const users = data?.users || [];

  return (
    <div style={{ minHeight:'100vh', background:V.bg, fontFamily:sans }}>
      {/* Nav */}
      <nav style={{ position:'sticky', top:0, zIndex:10, background:V.card, borderBottom:`1px solid ${V.border}`, padding:'14px 20px' }}>
        <div style={{ maxWidth:480, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontFamily:mono, fontSize:15, fontWeight:500, letterSpacing:'0.12em', color:V.orange }}>CHOCKA ADMIN</span>
          <button onClick={refresh} disabled={loading} style={{ background:V.card2, border:'none', borderRadius:8, padding:'6px 14px', fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:sans, color:V.textMid }}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </nav>

      <main style={{ maxWidth:480, margin:'0 auto', padding:'16px 16px 60px', display:'flex', flexDirection:'column', gap:12 }}>
        <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>

        {/* MRR Banner */}
        <div style={{ background:V.text, color:'white', borderRadius:16, padding:'18px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', animation:'fadeUp .4s ease both' }}>
          <div>
            <div style={{ fontSize:11, opacity:.4, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4, fontFamily:sans }}>Monthly Recurring Revenue</div>
            <div style={{ fontSize:36, fontWeight:700, fontFamily:mono, color:'#fff' }}>£{s?.mrr?.toLocaleString() || 0}</div>
            <div style={{ fontSize:11, opacity:.35, marginTop:2, fontFamily:sans }}>{s?.activeSubscribers || 0} active × £29/mo</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:22, fontWeight:600, fontFamily:mono, color:'#7DFF9B' }}>{s?.signupsThisMonth || 0}</div>
            <div style={{ fontSize:10, opacity:.4, textTransform:'uppercase', letterSpacing:'0.06em', fontFamily:sans }}>this month</div>
          </div>
        </div>

        {/* Key Stats */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, animation:'fadeUp .4s .05s ease both' }}>
          <Stat num={s?.totalSignups || 0} label="Total Signups" />
          <Stat num={s?.activeSubscribers || 0} label="Active Subscribers" hl />
          <Stat num={s?.churned || 0} label="Churned" warn={s?.churned > 0} />
          <Stat num={s?.totalReferrals || 0} label="Referrals Converted" />
        </div>

        {/* Automation Stats */}
        <div style={{ ...card, animation:'fadeUp .4s .1s ease both' }}>
          <div style={lbl}>Automation Activity</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div style={{ background:V.card2, borderRadius:12, padding:'12px', textAlign:'center' }}>
              <div style={{ fontSize:26, fontWeight:600, fontFamily:mono }}>{s?.totalPostsGenerated || 0}</div>
              <div style={{ fontSize:10, color:V.textSoft, marginTop:3 }}>Posts Generated</div>
            </div>
            <div style={{ background:V.card2, borderRadius:12, padding:'12px', textAlign:'center' }}>
              <div style={{ fontSize:26, fontWeight:600, fontFamily:mono, color:V.green }}>{s?.totalPostsPublished || 0}</div>
              <div style={{ fontSize:10, color:V.textSoft, marginTop:3 }}>Posts Published</div>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div style={{ ...card, animation:'fadeUp .4s .15s ease both' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <span style={lbl}>All Users</span>
            <span style={{ fontSize:11, color:V.textSoft, fontFamily:sans }}>{users.length} total</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {users.map((u: any, i: number) => (
              <UserRow key={i} user={u} />
            ))}
            {users.length === 0 && <div style={{ fontSize:13, color:V.textSoft, textAlign:'center', padding:'1rem' }}>No users yet</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ num, label, hl, warn }: { num: number; label: string; hl?: boolean; warn?: boolean }) {
  const col = warn ? '#D93025' : hl ? '#E8541A' : '#1A1A1A';
  return (
    <div style={{ background:'#FAFAF8', borderRadius:14, padding:'14px 16px', boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize:32, fontWeight:700, fontFamily:"'DM Mono',monospace", lineHeight:1, color:col }}>{num}</div>
      <div style={{ fontSize:10, color:'#999', marginTop:5, textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:"'DM Sans',sans-serif" }}>{label}</div>
    </div>
  );
}

function UserRow({ user }: { user: any }) {
  const [open, setOpen] = useState(false);
  const p = user.profile;
  const statusCol = user.subscription_status === 'active' ? '#2D7A4F' : user.subscription_status === 'cancelled' ? '#D93025' : '#B8860B';
  const statusBg = user.subscription_status === 'active' ? '#E8F5EE' : user.subscription_status === 'cancelled' ? '#FDECEA' : '#FFF8E6';
  const statusLabel = user.subscription_status || 'No plan';

  return (
    <div style={{ borderRadius:12, overflow:'hidden', border:'1px solid rgba(0,0,0,0.06)' }}>
      <div onClick={() => setOpen(!open)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 14px', cursor:'pointer', background:'#FAFAF8' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, fontFamily:"'DM Sans',sans-serif", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {p?.business_name || user.name || user.email}
          </div>
          <div style={{ fontSize:11, color:'#999', marginTop:1, fontFamily:"'DM Sans',sans-serif" }}>{user.email}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginLeft:10 }}>
          <span style={{ fontSize:10, fontWeight:600, padding:'3px 8px', borderRadius:20, background:statusBg, color:statusCol }}>{statusLabel}</span>
          <span style={{ fontSize:12, color:'#999' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding:'12px 14px', background:'#F5F3EF', borderTop:'1px solid rgba(0,0,0,0.05)', display:'flex', flexDirection:'column', gap:6 }}>
          <Row label="Trade" val={p?.category || '—'} />
          <Row label="Location" val={p?.city || p?.address?.split(',').slice(-2).join(',').trim() || '—'} />
          <Row label="Score Before" val={p?.audit_score != null ? `${p.audit_score}/100` : '—'} />
          <Row label="Score After" val={p?.audit_score_after != null ? `${p.audit_score_after}/100` : '—'} col={p?.audit_score_after > p?.audit_score ? '#2D7A4F' : undefined} />
          <Row label="Score Lift" val={p?.audit_score_after && p?.audit_score ? `+${p.audit_score_after - p.audit_score} pts` : '—'} col='#2D7A4F' />
          <Row label="Posts Written" val={String(p?.total_auto_posts || 0)} />
          <Row label="Replies Written" val={String(p?.total_auto_replies || 0)} />
          <Row label="Weeks Managed" val={String(p?.streak_weeks || 0)} />
          <Row label="Joined" val={new Date(user.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} />
          <Row label="Referred By" val={user.referred_by || '—'} />
          <div style={{ marginTop:4 }}>
            <a href={`mailto:${user.email}`} style={{ fontSize:12, color:'#E8541A', fontWeight:500, fontFamily:"'DM Sans',sans-serif", textDecoration:'none' }}>
              ✉ Email {user.name?.split(' ')[0] || 'them'} →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, val, col }: { label: string; val: string; col?: string }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, fontFamily:"'DM Sans',sans-serif" }}>
      <span style={{ color:'#999' }}>{label}</span>
      <span style={{ fontWeight:500, color: col || '#1A1A1A' }}>{val}</span>
    </div>
  );
}
