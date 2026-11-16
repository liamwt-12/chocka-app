'use client';

/**
 * "What we have changed on your listing": every change, what it was, what it
 * became, and an Undo. For the shop, in Settings. See app/api/changes/route.ts.
 */
import { useEffect, useState, type CSSProperties } from 'react';

interface Change { id: string; when: string; what: string; before: string; after: string; source: string; undone: boolean; canUndo: boolean; whyNot: string | null }
const sans = "'DM Sans',sans-serif";

export default function ChangesList({ cardStyle, labelStyle, supportEmail }: { cardStyle: CSSProperties; labelStyle: CSSProperties; supportEmail: string }) {
  const [list, setList] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState('');
  const [note, setNote] = useState<Record<string, { ok: boolean; text: string }>>({});
  const load = () => fetch('/api/changes').then((r) => r.json()).then((d) => setList(d.changes || [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  async function undo(c: Change) {
    setBusy(c.id); setAsking('');
    try {
      const res = await fetch('/api/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeId: c.id }) });
      const d = await res.json().catch(() => ({}));
      setNote((n) => ({ ...n, [c.id]: d.undo ? { ok: d.undo.ok, text: d.undo.message } : { ok: false, text: d.error || 'We could not do that. Please try again.' } }));
      if (d.undo?.ok) await load();
    } catch { setNote((n) => ({ ...n, [c.id]: { ok: false, text: 'We could not reach our server. Please try again.' } })); }
    setBusy('');
  }

  const shown = (list || []).filter((c) => c.source !== 'revert');
  return (
    <div style={cardStyle} id="changes">
      <div style={labelStyle}>What we have changed on your listing</div>
      {list === null ? <p style={{ fontSize: 14, color: '#8A8A8A', fontFamily: sans, margin: 0 }}>Loading…</p> : shown.length === 0 ? (
        <p style={{ fontSize: 14, color: '#555', fontFamily: sans, margin: 0 }}>Nothing. We have not changed anything on your Google listing.</p>
      ) : (
        <>
          <p style={{ fontSize: 14, color: '#555', fontFamily: sans, margin: '0 0 8px', lineHeight: 1.5 }}>Every change, newest first. You can put any of them back yourself.</p>
          {shown.map((c) => (
            <div key={c.id} style={{ borderTop: '1px solid rgba(0,0,0,0.09)', padding: '12px 0', fontFamily: sans }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15, color: '#1A1A1A' }}>{c.what}</strong>
                <span style={{ fontSize: 13, color: '#8A8A8A' }}>{new Date(c.when).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
              <div style={{ fontSize: 14, color: '#555', marginTop: 4 }}><span style={{ color: '#8A8A8A' }}>Before:</span> {c.before}</div>
              <div style={{ fontSize: 14, color: '#555', marginTop: 2 }}><span style={{ color: '#8A8A8A' }}>Now:</span> {c.undone ? <em>put back</em> : c.after}</div>
              {c.undone ? null : c.canUndo ? (
                asking === c.id ? (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, color: '#1A1A1A' }}>Put this back to how it was?</span>
                    <button disabled={busy === c.id} onClick={() => undo(c)} style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 8, padding: '9px 14px', background: '#1A1A1A', color: '#fff', cursor: 'pointer' }}>{busy === c.id ? 'Putting it back…' : 'Yes, put it back'}</button>
                    <button disabled={busy === c.id} onClick={() => setAsking('')} style={{ fontFamily: sans, fontSize: 14, border: 'none', background: 'none', color: '#555', textDecoration: 'underline', cursor: 'pointer' }}>No, leave it</button>
                  </div>
                ) : <button onClick={() => setAsking(c.id)} style={{ marginTop: 8, fontFamily: sans, fontSize: 14, fontWeight: 600, border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, padding: '8px 14px', background: '#fff', color: '#1A1A1A', cursor: 'pointer' }}>Undo this</button>
              ) : <div style={{ fontSize: 13, color: '#8A8A8A', marginTop: 6 }}>{c.whyNot} <a href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Please put back: ${c.what}`)}`} style={{ color: '#555' }}>Ask us to look at it</a>.</div>}
              {note[c.id] && <p role="status" style={{ fontSize: 14, margin: '8px 0 0', color: note[c.id].ok ? '#2D7A4F' : '#D93025' }}>{note[c.id].text}{!note[c.id].ok && <> <a href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Please put back: ${c.what}`)}`} style={{ color: '#555' }}>Ask us to do it</a>.</>}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
