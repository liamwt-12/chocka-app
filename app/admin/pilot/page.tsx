'use client';

import { useState, useMemo } from 'react';

// Pilot admin: add a retailer, generate invite links (never sends), see who is live.
// Behind ADMIN_PASSWORD, like /admin. Links are shown once: only their hash is stored.

const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const C = { bg: '#F0EDE8', card: '#FAFAF8', text: '#1A1A1A', mid: '#555', soft: '#999', green: '#2D7A4F', greenL: '#E8F5EE', amber: '#B8860B', amberL: '#FFF8E6', red: '#D93025', redL: '#FDECEA' };
const card: React.CSSProperties = { background: C.card, borderRadius: 14, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 16 };
const input: React.CSSProperties = { background: C.bg, border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: sans, outline: 'none', boxSizing: 'border-box' };
const btn: React.CSSProperties = { background: C.text, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: sans };

const STATE_LABEL: Record<string, [string, string, string]> = {
  live: ['Live', C.green, C.greenL],
  connected_not_live: ['Connected, not live', C.amber, C.amberL],
  invited: ['Link issued', C.mid, '#EEE'],
  invite_expired: ['Link expired', C.red, C.redL],
  not_invited: ['Not invited', C.soft, '#F5F3EF'],
};

type Row = { id: string; name: string; town: string | null; contactEmail: string | null; source: string; state: string; detail: string; joinedAt: string | null; delisted: boolean };
type Minted = { retailerId: string; name?: string; ok: boolean; link?: string; expiresAt?: string; error?: string };

export default function PilotAdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [minted, setMinted] = useState<Minted[]>([]);
  const [form, setForm] = useState({ name: '', town: '', contactEmail: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (payload: object) => {
    const res = await fetch('/api/admin/pilot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
    return data;
  };

  const load = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await call({ action: 'list' });
      setRows(d.retailers); setCounts(d.counts); setAuthed(true);
    } catch (e: any) { setMsg(e.message === 'Unauthorized' ? 'Wrong password' : e.message); }
    setBusy(false);
  };

  const add = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await call({ action: 'add', ...form });
      setMsg(`Added ${d.added.name}.`); setForm({ name: '', town: '', contactEmail: '' });
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  const invite = async () => {
    if (!selected.size) return;
    setBusy(true); setMsg('');
    try {
      const d = await call({ action: 'invite', retailerIds: Array.from(selected) });
      setMinted(d.results); setSelected(new Set());
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  const revoke = async (id: string) => {
    setBusy(true); setMsg('');
    try { const d = await call({ action: 'revoke', retailerId: id }); setMsg(`Revoked ${d.revoked} link(s).`); await load(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  const downloadCsv = () => {
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['shop,link,expires', ...minted.filter((m) => m.ok).map((m) => [esc(m.name || ''), esc(m.link || ''), esc((m.expiresAt || '').slice(0, 10))].join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `stellar-invite-links-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const visible = useMemo(() => rows.filter((r) =>
    (!stateFilter || r.state === stateFilter) &&
    (!filter || `${r.name} ${r.town ?? ''}`.toLowerCase().includes(filter.toLowerCase()))), [rows, filter, stateFilter]);

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 16 }}>
        <div style={{ width: '100%', maxWidth: 340, ...card }}>
          <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: '0.1em', marginBottom: 14 }}>PILOT ADMIN</div>
          <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} style={{ ...input, width: '100%', marginBottom: 10 }} />
          {msg && <div style={{ color: C.red, fontSize: 12, marginBottom: 8, fontFamily: sans }}>{msg}</div>}
          <button onClick={load} disabled={busy} style={{ ...btn, width: '100%' }}>{busy ? 'Loading…' : 'Enter'}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 16px', fontFamily: sans, color: C.text }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Stellar pilot</h1>
        <p style={{ color: C.mid, fontSize: 13, margin: '0 0 16px' }}>
          Links are generated here and never sent. Tarkett or the rep passes each one to the shop. See docs/rep-guide.md.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {Object.entries(STATE_LABEL).map(([k, [label, fg, bg]]) => (
            <button key={k} onClick={() => setStateFilter(stateFilter === k ? '' : k)} style={{ background: bg, color: fg, border: stateFilter === k ? `2px solid ${fg}` : '2px solid transparent', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: sans }}>
              {label}: {counts[k] || 0}
            </button>
          ))}
        </div>

        {msg && <div style={{ ...card, padding: 12, fontSize: 13 }}>{msg}</div>}

        {minted.length > 0 && (
          <div style={{ ...card, border: `2px solid ${C.green}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>New links: copy them now. They cannot be shown again.</strong>
              <span style={{ display: 'flex', gap: 8 }}>
                <button onClick={downloadCsv} style={btn}>Download CSV</button>
                <button onClick={() => setMinted([])} style={{ ...btn, background: '#888' }}>Done</button>
              </span>
            </div>
            {minted.map((m) => (
              <div key={m.retailerId} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid #eee', wordBreak: 'break-all' }}>
                <strong>{m.name || m.retailerId}</strong>{' '}
                {m.ok
                  ? <><span style={{ fontFamily: mono }}>{m.link}</span> <span style={{ color: C.soft }}>(until {m.expiresAt?.slice(0, 10)})</span></>
                  : <span style={{ color: C.red }}>{m.error}</span>}
              </div>
            ))}
          </div>
        )}

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add a shop Tarkett has given you</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input placeholder="Shop name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...input, flex: '2 1 200px' }} />
            <input placeholder="Town" value={form.town} onChange={(e) => setForm({ ...form, town: e.target.value })} style={{ ...input, flex: '1 1 120px' }} />
            <input placeholder="Contact email (optional)" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} style={{ ...input, flex: '2 1 200px' }} />
            <button onClick={add} disabled={busy || !form.name.trim()} style={btn}>Add</button>
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input placeholder="Search shop or town" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...input, flex: '1 1 200px' }} />
            <button onClick={invite} disabled={busy || !selected.size} style={btn}>Generate links for {selected.size} selected</button>
            <button onClick={load} disabled={busy} style={{ ...btn, background: '#888' }}>Refresh</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.soft, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: 6 }}></th><th style={{ padding: 6 }}>Shop</th><th style={{ padding: 6 }}>Town</th><th style={{ padding: 6 }}>Status</th><th style={{ padding: 6 }}>Detail</th><th style={{ padding: 6 }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const [label, fg, bg] = STATE_LABEL[r.state] || [r.state, C.mid, '#eee'];
                  const canInvite = r.state === 'not_invited' || r.state === 'invite_expired';
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: 6 }}>
                        <input type="checkbox" disabled={!canInvite} checked={selected.has(r.id)} onChange={(e) => {
                          const next = new Set(selected); e.target.checked ? next.add(r.id) : next.delete(r.id); setSelected(next);
                        }} />
                      </td>
                      <td style={{ padding: 6 }}>{r.name}{r.source === 'admin' && <span style={{ color: C.soft }}> (added)</span>}{r.delisted && <span style={{ color: C.red }}> (delisted)</span>}</td>
                      <td style={{ padding: 6, color: C.mid }}>{r.town || ''}</td>
                      <td style={{ padding: 6 }}><span style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span></td>
                      <td style={{ padding: 6, color: C.mid }}>{r.detail}{r.joinedAt ? `, joined ${r.joinedAt.slice(0, 10)}` : ''}</td>
                      <td style={{ padding: 6 }}>{r.state === 'invited' && <button onClick={() => revoke(r.id)} disabled={busy} style={{ ...btn, background: 'transparent', color: C.red, padding: '2px 6px' }}>Revoke</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
