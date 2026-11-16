'use client';

import { useEffect, useState } from 'react';

const sans = "'DM Sans',sans-serif";
const C = { bg: '#F0EDE8', card: '#FAFAF8', text: '#1A1A1A', mid: '#555', soft: '#999', green: '#2D7A4F', amber: '#B8860B', red: '#D93025' };
const card: React.CSSProperties = { background: C.card, borderRadius: 14, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 16 };
const th: React.CSSProperties = { padding: 6, textAlign: 'left', color: C.soft, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: 6, borderTop: '1px solid #eee', fontSize: 13 };
const STATE: Record<string, string> = { live: 'Live', connected_not_live: 'Connected, not live', invited: 'Invited', invite_expired: 'Link expired', not_invited: 'Not invited' };
const pct = (n: number | null) => (n === null ? '–' : `${n > 0 ? '+' : ''}${n}%`);
const bandColour = (b: string | null) => (b === 'Strong rise' || b === 'Rising' ? C.green : b === 'Falling' ? C.red : C.mid);

export default function ConsoleClient({ view }: { view: 'console' | 'league' }) {
  const [data, setData] = useState<any>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const res = await fetch('/api/console/data');
    if (res.status === 401) { setNeedLogin(true); return; }
    if (!res.ok) { setMsg('Could not load the console.'); return; }
    setData(await res.json());
  };
  useEffect(() => { load(); }, []);

  const requestLink = async () => {
    setMsg('');
    const res = await fetch('/api/console/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const d = await res.json().catch(() => ({}));
    setMsg(d.message || d.error || 'Something went wrong.');
  };
  const logout = async () => { await fetch('/api/console/logout', { method: 'POST' }); setData(null); setNeedLogin(true); };

  const wrap = (children: React.ReactNode) => (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 16px', fontFamily: sans, color: C.text }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>{children}</div>
    </div>
  );

  if (needLogin) return wrap(
    <div style={{ ...card, maxWidth: 380, margin: '10vh auto' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Stellar Local console</h1>
      <p style={{ fontSize: 13, color: C.mid, margin: '0 0 12px' }}>Enter your work email and we will send you a sign-in link.</p>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@tarkett.com" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: 'none', background: C.bg, fontSize: 14, marginBottom: 10 }} />
      <button onClick={requestLink} style={{ width: '100%', background: C.text, color: '#fff', border: 'none', borderRadius: 8, padding: 11, fontWeight: 600, cursor: 'pointer' }}>Email me a link</button>
      {msg && <p style={{ fontSize: 13, color: C.mid, marginTop: 10 }}>{msg}</p>}
    </div>,
  );
  if (!data) return wrap(<p style={{ color: C.mid }}>{msg || 'Loading…'}</p>);

  const nav = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
      <div>
        <h1 style={{ fontSize: 22, margin: 0 }}>{view === 'console' ? 'Your shops on Stellar Local' : 'Network league'}</h1>
        <div style={{ fontSize: 12, color: C.soft }}>Updated {new Date(data.generatedAt).toLocaleString('en-GB')}</div>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
        <a href="/console" style={{ color: view === 'console' ? C.text : C.mid, fontWeight: view === 'console' ? 700 : 400 }}>Shops</a>
        <a href="/console/league" style={{ color: view === 'league' ? C.text : C.mid, fontWeight: view === 'league' ? 700 : 400 }}>League</a>
        <button onClick={logout} style={{ background: 'none', border: 'none', color: C.mid, cursor: 'pointer', fontSize: 13 }}>Sign out</button>
      </div>
    </div>
  );

  if (view === 'league') return wrap(<>
    {nav}
    <div style={card}>
      <p style={{ fontSize: 13, color: C.mid, margin: '0 0 10px' }}>
        Ranked by how much each shop has improved since it joined: customer actions (calls, website clicks and direction requests) over the latest four weeks, compared with the four weeks before joining. Bigger shops do not win by being bigger. This shows change, not what caused it.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>#</th><th style={th}>Shop</th><th style={th}>Town</th><th style={th}>Improvement</th><th style={th}>Customer actions</th><th style={th}>Views</th></tr></thead>
        <tbody>{data.league.ranked.map((e: any) => (
          <tr key={e.retailerId}><td style={td}>{e.rank}</td><td style={td}>{e.name}</td><td style={{ ...td, color: C.mid }}>{e.town || ''}</td>
            <td style={{ ...td, color: bandColour(e.band), fontWeight: 600 }}>{e.band}</td><td style={td}>{pct(e.actionsChange)}</td><td style={td}>{pct(e.viewsChange)}</td></tr>
        ))}</tbody>
      </table>
      {data.league.ranked.length === 0 && <p style={{ fontSize: 13, color: C.mid }}>No shop has been connected long enough to rank yet.</p>}
    </div>
    {data.league.excluded.length > 0 && <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Not ranked yet</div>
      {data.league.excluded.map((e: any) => <div key={e.retailerId} style={{ fontSize: 13, color: C.mid, padding: '3px 0' }}>{e.name}: {e.reason}</div>)}
    </div>}
  </>);

  return wrap(<>
    {nav}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      {Object.entries(STATE).map(([k, label]) => <div key={k} style={{ ...card, marginBottom: 0, padding: '10px 14px', fontSize: 13 }}><strong>{data.counts[k] || 0}</strong> {label}</div>)}
    </div>
    <div style={{ ...card, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Shop</th><th style={th}>Town</th><th style={th}>Status</th><th style={th}>Google</th><th style={th}>Score at start</th><th style={th}>Posts (30 days)</th><th style={th}>Replies (30 days)</th><th style={th}>Since joining</th><th style={th}>Ads from</th><th style={th}>Ad spend</th><th style={th}>Change alongside the ads</th></tr></thead>
        <tbody>{data.shops.map((s: any) => (
          <tr key={s.retailerId}>
            <td style={td}>{s.name}</td><td style={{ ...td, color: C.mid }}>{s.town || ''}</td>
            <td style={td} title={s.statusNote ? `${s.statusNote.why} What helps: ${s.statusNote.action}` : ''}>{STATE[s.pilotState] || s.pilotState}{s.statusNote && <div style={{ fontSize: 12, color: C.mid }}>{s.statusNote.label}</div>}</td><td style={{ ...td, color: C.mid }}>{s.connection || '–'}</td>
            <td style={td}>{s.scoreAtActivation ?? '–'}</td><td style={td}>{s.postsLast30 ?? '–'}</td><td style={td}>{s.repliesLast30 ?? '–'}</td>
            <td style={{ ...td, color: bandColour(s.improvement) }}>{s.improvement ? (s.actionsChange !== null ? `${s.improvement} (${pct(s.actionsChange)} actions)` : s.improvement) : '–'}</td>
            <td style={td}>{s.adStartDate || '–'}</td>
            <td style={td}>{s.adSpend || '–'}</td>
            <td style={{ ...td, color: s.adChange?.flag ? '#B8860B' : undefined }} title={s.adChange?.detail || ''}>{s.adChange ? <><strong>{s.adChange.label}</strong><div style={{ fontSize: 12, color: C.mid }}>{s.adChange.detail}</div></> : '–'}</td>
          </tr>
        ))}</tbody>
      </table>
      <p style={{ fontSize: 12, color: C.soft, marginTop: 10 }}>Contact details, review text and anything about shops&apos; customers are not shown here. Scores are shown only for shops that have joined. “Change alongside the ads” compares customer actions (calls, website clicks, direction requests) in the four weeks before and after the ads started, against shops with no ads over the same weeks. It shows what changed, not what caused it.</p>
    </div>
  </>);
}
