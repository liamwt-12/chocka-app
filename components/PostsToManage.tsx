'use client';

/**
 * Posts the shop can act on, on its dashboard: approve, change the wording,
 * skip, or cancel one that is booked. See lib/post-actions.ts.
 *
 * A post waiting for approval does not go up until the shop presses Approve.
 * The time shown is when it would go up. Each button says what happened, and
 * what the server said is what is shown: nothing is assumed to have worked.
 */
import { useState, type CSSProperties } from 'react';

interface Post { id: string; content: string; scheduled_for: string; waiting: boolean }
const sans = "'DM Sans',sans-serif";
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' });

export default function PostsToManage({ posts: initial, cardStyle }: { posts: Post[]; cardStyle: CSSProperties }) {
  const [posts, setPosts] = useState<Post[]>(initial);
  const [editing, setEditing] = useState<string>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [gone, setGone] = useState<Array<{ id: string; text: string }>>([]);

  async function act(p: Post, action: 'approve' | 'skip' | 'cancel' | 'edit', content?: string) {
    setBusy(p.id);
    try {
      const res = await fetch('/api/posts/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, action, ...(content !== undefined ? { content } : {}) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) { setNote((n) => ({ ...n, [p.id]: { ok: false, text: d.error || 'We could not save that. Please try again.' } })); return; }
      setEditing('');
      if (d.post.status === 'cancelled') { setPosts((l) => l.filter((x) => x.id !== p.id)); setGone((g) => [...g, { id: p.id, text: d.message }]); return; }
      setPosts((l) => l.map((x) => (x.id === p.id ? { ...x, content: d.post.content, scheduled_for: d.post.scheduled_for, waiting: d.post.status === 'awaiting_approval' } : x)));
      setNote((n) => ({ ...n, [p.id]: { ok: true, text: d.message } }));
    } catch {
      setNote((n) => ({ ...n, [p.id]: { ok: false, text: 'We could not reach our server. Check your signal and try again.' } }));
    } finally { setBusy(''); }
  }

  if (!posts.length && !gone.length) return null;
  const b: CSSProperties = { border: 'none', borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: sans };
  const waitingCount = posts.filter((p) => p.waiting).length;
  return (
    <div style={{ ...cardStyle, border: waitingCount ? '2px solid var(--brand-strong)' : undefined }}>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: sans, color: '#1A1A1A' }}>{waitingCount ? `${waitingCount === 1 ? 'A post is' : `${waitingCount} posts are`} waiting for you` : 'Your next post'}</div>
      <p style={{ fontSize: 14, color: '#555', margin: '2px 0 10px', fontFamily: sans }}>{waitingCount ? 'It will not go up on Google until you press Approve.' : 'Booked to go up at the time shown. You can still stop it.'}</p>
      {posts.map((p) => (
        <div key={p.id} style={{ background: '#F5F3EF', borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: '#8A8A8A', fontFamily: sans, marginBottom: 6 }}>{p.waiting ? `Would go up ${when(p.scheduled_for)}` : `Goes up ${when(p.scheduled_for)}`}</div>
          {editing === p.id ? (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="Post wording" style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 16, lineHeight: 1.5, padding: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: '#1A1A1A' }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button disabled={busy === p.id} onClick={() => act(p, p.waiting ? 'approve' : 'edit', text)} style={{ ...b, background: 'var(--brand-strong)', color: '#fff' }}>{p.waiting ? 'Save and approve' : 'Save'}</button>
                <button disabled={busy === p.id} onClick={() => setEditing('')} style={{ ...b, background: 'transparent', color: '#555', textDecoration: 'underline' }}>Leave it as it was</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 12px', fontFamily: sans, color: '#1A1A1A', whiteSpace: 'pre-wrap' }}>{p.content}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {p.waiting && <button disabled={busy === p.id} onClick={() => act(p, 'approve')} style={{ ...b, background: 'var(--brand-strong)', color: '#fff' }}>Approve</button>}
                <button disabled={busy === p.id} onClick={() => { setEditing(p.id); setText(p.content); }} style={{ ...b, background: '#fff', color: '#1A1A1A', border: '1px solid rgba(0,0,0,0.15)' }}>Change the wording</button>
                <button disabled={busy === p.id} onClick={() => act(p, p.waiting ? 'skip' : 'cancel')} style={{ ...b, background: 'transparent', color: '#555', textDecoration: 'underline' }}>{p.waiting ? 'Skip this one' : 'Do not post this'}</button>
              </div>
            </>
          )}
          {note[p.id] && <p role="status" style={{ fontSize: 14, margin: '10px 0 0', fontFamily: sans, color: note[p.id].ok ? '#2D7A4F' : '#D93025' }}>{note[p.id].text}</p>}
        </div>
      ))}
      {gone.map((g) => <p key={g.id} role="status" style={{ fontSize: 14, color: '#555', margin: '4px 0 0', fontFamily: sans }}>{g.text}</p>)}
    </div>
  );
}
