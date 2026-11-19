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

export default function ConsoleClient({ view }: { view: 'console' | 'league' | 'summary' }) {
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
        <h1 style={{ fontSize: 22, margin: 0 }}>{view === 'console' ? 'Your shops on Stellar Local' : view === 'league' ? 'Network league' : `The network in ${data.summary?.monthLabel || 'the last month'}`}</h1>
        <div style={{ fontSize: 12, color: C.soft }}>Updated {new Date(data.generatedAt).toLocaleString('en-GB')}</div>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
        <a href="/console/summary" style={{ color: view === 'summary' ? C.text : C.mid, fontWeight: view === 'summary' ? 700 : 400 }}>Monthly summary</a>
        <a href="/console" style={{ color: view === 'console' ? C.text : C.mid, fontWeight: view === 'console' ? 700 : 400 }}>Shops</a>
        <a href="/console/league" style={{ color: view === 'league' ? C.text : C.mid, fontWeight: view === 'league' ? 700 : 400 }}>League</a>
        <button onClick={logout} style={{ background: 'none', border: 'none', color: C.mid, cursor: 'pointer', fontSize: 13 }}>Sign out</button>
      </div>
    </div>
  );

  if (view === 'summary') {
    const s = data.summary;
    const big: React.CSSProperties = { fontSize: 30, fontWeight: 700, lineHeight: 1.1 };
    const tile: React.CSSProperties = { ...card, marginBottom: 0, flex: '1 1 150px' };
    const num = (n: number) => n.toLocaleString('en-GB');
    return wrap(<>
      {nav}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={tile}><div style={{ ...big, color: C.green }}>{s.shops.live}</div><div style={{ fontSize: 13, color: C.mid }}>shops live, of {s.shops.total}</div></div>
        <div style={tile}><div style={{ ...big, color: s.shops.liveQuiet ? C.amber : C.text }}>{s.shops.liveQuiet}</div><div style={{ fontSize: 13, color: C.mid }}>of those, with nothing switched on</div></div>
        <div style={tile}><div style={{ ...big, color: s.shops.connectedNotLive ? C.amber : C.text }}>{s.shops.connectedNotLive}</div><div style={{ fontSize: 13, color: C.mid }}>connected, not live yet</div></div>
        <div style={tile}><div style={big}>{s.shops.invited}</div><div style={{ fontSize: 13, color: C.mid }}>invited, not connected</div></div>
        <div style={tile}><div style={big}>{s.shops.notInvited}</div><div style={{ fontSize: 13, color: C.mid }}>not invited yet</div></div>
      </div>

      <p style={{ fontSize: 13, color: C.mid, margin: '-6px 0 16px' }}>A shop is live when it is connected to the right listing, Google has verified that listing, and our access to it works. A live shop with posts and review replies both off (or paused) is counted separately, and is named on the Shops page.</p>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>What customers did, across the network</div>
        <p style={{ fontSize: 13, color: C.mid, margin: '0 0 10px' }}>{s.totals.note}</p>
        {s.totals.lines.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}></th><th style={th}>All shops, {s.monthLabel}</th><th style={th}>Shops with both months: {s.monthLabel}</th><th style={th}>{s.totals.basis === 'last_year' ? `Same shops, ${s.totals.beforeLabel}` : 'The month before'}</th><th style={th}>Change per day</th></tr></thead>
            <tbody>{s.totals.lines.map((l: any) => (
              <tr key={l.label}><td style={td}>{l.label}</td><td style={{ ...td, fontWeight: 700 }}>{num(l.thisMonth)}</td><td style={td}>{l.sameShopsThisMonth === null ? '–' : num(l.sameShopsThisMonth)}</td><td style={td}>{l.before === null ? '–' : num(l.before)}</td><td style={{ ...td, color: l.change === null ? C.mid : l.change > 0 ? C.green : l.change < 0 ? C.red : C.mid }}>{pct(l.change)}</td></tr>
            ))}</tbody>
          </table>
        )}
        <p style={{ fontSize: 12, color: C.soft, margin: '10px 0 0' }}>These are Google&apos;s own figures for each listing, added up. They show what happened, not what caused it.</p>
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Reviews, across the network</div>
        <p style={{ fontSize: 13, color: C.mid, margin: '0 0 10px' }}>{s.reviews.note}</p>
        {(s.reviews.rating !== null || s.reviews.shareAnswered !== null) && (
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {s.reviews.rating !== null && <div><div style={big}>{s.reviews.rating.toFixed(1)} <span style={{ fontSize: 16, fontWeight: 400, color: C.mid }}>out of 5</span></div><div style={{ fontSize: 13, color: C.mid }}>network rating, from {num(s.reviews.totalReviews)} reviews</div></div>}
            {s.reviews.shareAnswered !== null && <div><div style={big}>{s.reviews.shareAnswered}%</div><div style={{ fontSize: 13, color: C.mid }}>of reviews have a reply from the shop</div></div>}
          </div>
        )}
        <p style={{ fontSize: 12, color: C.soft, margin: '10px 0 0' }}>Live shops only. Google&apos;s own rating and review count for each listing, added up. No review text and no single shop&apos;s figures are shown.</p>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: '1 1 300px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Against the same weeks last year</div>
          <p style={{ fontSize: 13, color: C.mid, margin: '0 0 10px' }}>Customer actions (calls, website clicks, direction requests) in the latest four weeks, against each shop&apos;s own figures for the same four weeks a year ago, so the time of year is not counted as a change.</p>
          {[['Rising', s.improvement.rising, C.green], ['Steady', s.improvement.steady, C.mid], ['Falling', s.improvement.falling, C.red], ['Too early, or no figures from last year', s.improvement.tooEarly, C.soft]].map(([label, n, colour]: any) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #eee', fontSize: 14 }}><span style={{ color: colour, fontWeight: 600 }}>{label}</span><span>{n} shop{n === 1 ? '' : 's'}</span></div>
          ))}
          {s.improvement.medianActionsChange !== null && <p style={{ fontSize: 13, color: C.mid, margin: '10px 0 0' }}>The middle shop is at <strong style={{ color: C.text }}>{pct(s.improvement.medianActionsChange)}</strong>.</p>}
        </div>
        <div style={{ ...card, flex: '1 1 300px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Most improved</div>
          {s.topMovers.length === 0 ? <p style={{ fontSize: 13, color: C.mid, margin: 0 }}>No shop can be ranked yet: each needs four full weeks since joining, and figures from the same weeks last year.</p> : s.topMovers.map((m: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid #eee', fontSize: 14 }}><span>{i + 1}. {m.name}{m.town ? <span style={{ color: C.soft }}>, {m.town}</span> : null}</span><span style={{ color: bandColour(m.band), fontWeight: 600, whiteSpace: 'nowrap' }}>{m.band} ({pct(m.actionsChange)})</span></div>
          ))}
          <p style={{ fontSize: 12, margin: '10px 0 0' }}><a href="/console/league" style={{ color: C.mid }}>See the full league</a></p>
        </div>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Change alongside your ads</div>
        {s.ads.shops.length === 0 ? <p style={{ fontSize: 13, color: C.mid, margin: '4px 0 0' }}>No ad dates have been entered for any shop yet.</p> : (<>
          <p style={{ fontSize: 13, color: C.mid, margin: '0 0 10px' }}>{s.ads.shops.length} shop{s.ads.shops.length === 1 ? '' : 's'} with ads{s.ads.withSpend ? `, ${s.ads.withSpend} with a spend entered` : ''}: <strong style={{ color: C.green }}>{s.ads.clearRise} clear rise</strong>, <strong style={{ color: s.ads.noClearChange ? C.amber : C.text }}>{s.ads.noClearChange} no clear change or a fall</strong>, {s.ads.tooEarlyOrFew} too early or too few to say.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Shop</th><th style={th}>Ads from</th><th style={th}>Spend</th><th style={th}>Alongside the ads</th></tr></thead>
            <tbody>{s.ads.shops.map((a: any, i: number) => (
              <tr key={i}><td style={td}>{a.name}{a.town ? <span style={{ color: C.soft }}>, {a.town}</span> : null}</td><td style={td}>{a.from}</td><td style={td}>{a.spend || '–'}</td><td style={{ ...td, color: a.flag ? C.amber : undefined }}><strong>{a.label}</strong><div style={{ fontSize: 12, color: C.mid }}>{a.detail}</div></td></tr>
            ))}</tbody>
          </table>
          <p style={{ fontSize: 12, color: C.soft, margin: '10px 0 0' }}>The four weeks after the ads started against the same four weeks last year (or the four weeks before, where a row says the listing has nothing from last year), set against shops with no ads measured the same way. A shop is marked when money was spent and there is no clear change. It shows what changed, not what caused it.</p>
        </>)}
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Shops not live yet: {s.notLive.total}</div>
        {s.notLive.total === 0 ? <p style={{ fontSize: 13, color: C.mid, margin: '4px 0 0' }}>Every invited shop is live.</p> : (<>
          <p style={{ fontSize: 13, color: C.mid, margin: '0 0 8px' }}>By reason. Some only need time. The Shops page says which shops, and what would help.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{s.notLive.byReason.map((r: any) => <span key={r.label} style={{ background: '#EEE', borderRadius: 999, padding: '5px 11px', fontSize: 13, fontWeight: 600 }}>{r.label}: {r.count}</span>)}</div>
        </>)}
      </div>
      <p style={{ fontSize: 12, color: C.soft }}>Contact details, review text and anything about shops&apos; customers are not shown anywhere in this console.</p>
    </>);
  }

  if (view === 'league') return wrap(<>
    {nav}
    <div style={card}>
      <p style={{ fontSize: 13, color: C.mid, margin: '0 0 10px' }}>
        Ranked by how much each shop has improved on last year: customer actions (calls, website clicks and direction requests) over the latest four weeks, compared with the same four weeks a year ago, so the time of year is not counted as a change. Bigger shops do not win by being bigger. This shows change, not what caused it.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>#</th><th style={th}>Shop</th><th style={th}>Town</th><th style={th}>Improvement</th><th style={th}>Customer actions</th><th style={th}>Views</th></tr></thead>
        <tbody>{data.league.ranked.map((e: any) => (
          <tr key={e.retailerId}><td style={td}>{e.rank}</td><td style={td}>{e.name}</td><td style={{ ...td, color: C.mid }}>{e.town || ''}</td>
            <td style={{ ...td, color: bandColour(e.band), fontWeight: 600 }}>{e.band}</td><td style={td}>{pct(e.actionsChange)}</td><td style={td}>{pct(e.viewsChange)}</td></tr>
        ))}</tbody>
      </table>
      {data.league.ranked.length === 0 && <p style={{ fontSize: 13, color: C.mid }}>No shop can be ranked yet: each needs four full weeks since joining, and figures from the same weeks last year.</p>}
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
        <thead><tr><th style={th}>Shop</th><th style={th}>Town</th><th style={th}>Status</th><th style={th}>Google</th><th style={th}>Score at start</th><th style={th}>Posts (30 days)</th><th style={th}>Replies (30 days)</th><th style={th}>Against last year</th><th style={th}>Ads from</th><th style={th}>Ad spend</th><th style={th}>Change alongside the ads</th></tr></thead>
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
      <p style={{ fontSize: 12, color: C.soft, marginTop: 10 }}>Contact details, review text and anything about shops&apos; customers are not shown here. Scores are shown only for shops that have joined. “Change alongside the ads” compares customer actions (calls, website clicks, direction requests) in the four weeks after the ads started with the same four weeks last year (or the four weeks before, where it says so), against shops with no ads measured the same way. It shows what changed, not what caused it.</p>
    </div>
  </>);
}
