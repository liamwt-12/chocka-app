'use client';

import { useEffect, useState } from 'react';

/**
 * A shop's photos, for a rep in /admin/pilot: generate the upload link, look at
 * what has come in, approve or reject each one. Talks to /api/admin/photos with
 * the same admin password as the rest of the page.
 */
type Photo = { id: string; createdAt: string; status: 'pending' | 'approved' | 'rejected'; width: number; height: number; bytes: number; useCount: number; lastUsedAt: string | null; onListing: boolean; url: string | null };

const C = { text: '#1A1A1A', mid: '#555', soft: '#999', green: '#2D7A4F', amber: '#B8860B', red: '#D93025' };
const btn: React.CSSProperties = { background: C.text, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const STATUS: Record<Photo['status'], [string, string]> = { pending: ['Waiting for a decision', C.amber], approved: ['Approved', C.green], rejected: ['Rejected, file deleted', C.red] };

export default function PhotoPanel({ shop, password, onClose, onChanged }: {
  shop: { id: string; name: string };
  password: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null);
  const [listingEnabled, setListingEnabled] = useState(false);
  const [newLink, setNewLink] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (payload: object) => {
    const res = await fetch('/api/admin/photos', { method: 'POST', headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
    return data;
  };

  const load = async () => {
    const d = await call({ action: 'list', retailerId: shop.id });
    setPhotos(d.photos); setLinkExpiresAt(d.linkExpiresAt); setListingEnabled(!!d.listingEnabled);
  };

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg('');
    try { const m = await fn(); await load(); onChanged(); if (m) setMsg(m); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  useEffect(() => { setNewLink(''); run(async () => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shop.id]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <strong style={{ fontSize: 14 }}>Photos for {shop.name}</strong>
        <button onClick={onClose} style={{ ...btn, background: '#888' }}>Close</button>
      </div>
      <p style={{ color: C.mid, fontSize: 12, margin: '0 0 12px' }}>
        Generate a link and pass it to the shop (nothing is sent), or open it yourself to add photos for them. Every photo has its hidden details removed, including where it was taken, and nothing is used on a post until you approve it here.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button disabled={busy} style={btn} onClick={() => run(async () => { const d = await call({ action: 'link', retailerId: shop.id }); setNewLink(d.link); })}>
          {linkExpiresAt ? 'Replace the upload link' : 'Generate an upload link'}
        </button>
        {linkExpiresAt && <button disabled={busy} style={{ ...btn, background: 'transparent', color: C.red }} onClick={() => run(async () => { await call({ action: 'revoke_link', retailerId: shop.id }); setNewLink(''); return 'Upload link cancelled.'; })}>Cancel the link</button>}
        <span style={{ fontSize: 12, color: C.soft }}>{linkExpiresAt ? `A link is active until ${linkExpiresAt.slice(0, 10)}. Replacing it cancels the old one.` : 'No active link.'}</span>
      </div>
      {newLink && (
        <div style={{ fontSize: 13, padding: 10, border: `2px solid ${C.green}`, borderRadius: 8, marginBottom: 10, wordBreak: 'break-all' }}>
          <strong>Copy this now. It cannot be shown again.</strong><br /><span style={{ fontFamily: "'DM Mono',monospace" }}>{newLink}</span>
        </div>
      )}
      {msg && <div style={{ fontSize: 13, color: C.mid, marginBottom: 10 }}>{msg}</div>}

      {photos.length === 0 ? (
        <div style={{ fontSize: 13, color: C.soft }}>No photos yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          {photos.map((p) => {
            const [label, colour] = STATUS[p.status];
            return (
              <div key={p.id} style={{ border: '1px solid #e5e2dc', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                {p.url
                  ? <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} /></a>
                  : <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.soft, fontSize: 12 }}>No file</div>}
                <div style={{ padding: 8, fontSize: 12 }}>
                  <div style={{ color: colour, fontWeight: 600 }}>{label}</div>
                  <div style={{ color: C.soft }}>{p.width} x {p.height}, added {p.createdAt.slice(0, 10)}{p.useCount ? `, on ${p.useCount} post${p.useCount === 1 ? '' : 's'}` : ''}{p.onListing ? ', on the listing' : ''}</div>
                  {p.status !== 'rejected' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {p.status === 'pending' && <button disabled={busy} style={{ ...btn, background: C.green }} onClick={() => run(async () => { await call({ action: 'approve', photoId: p.id }); })}>Approve</button>}
                      <button disabled={busy} style={{ ...btn, background: 'transparent', color: C.red, border: `1px solid ${C.red}` }} onClick={() => run(async () => { const d = await call({ action: 'reject', photoId: p.id }); return d.warning; })}>{p.status === 'approved' ? 'Remove' : 'Reject'}</button>
                      {listingEnabled && p.status === 'approved' && !p.onListing && <button disabled={busy} style={btn} onClick={() => run(async () => { await call({ action: 'to_listing', photoId: p.id }); return 'Added to the Google listing. It is in the change log and can be undone.'; })}>Add to Google listing</button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
