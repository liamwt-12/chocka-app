'use client';

import { useEffect, useState } from 'react';
import { useTenant } from '@/lib/tenant-context';

// The photo upload link (lib/shop-photos.ts). No sign-in: the link is for one
// shop and can only add photos. Each photo is shrunk in the browser first (which
// also drops its metadata), then checked and cleaned again by the server, which
// is the check that counts. Nothing uploaded is used until a rep approves it.

const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const C = { bg: '#F0EDE8', card: '#FAFAF8', text: '#1A1A1A', mid: '#555', soft: '#999', green: '#2D7A4F', red: '#D93025', border: 'rgba(0,0,0,0.08)' };
const MAX_SIDE = 2048;

type Item = { name: string; state: 'waiting' | 'sending' | 'done' | 'failed'; error?: string };

/** Redraw the photo no larger than 2048px as a JPEG. Falls back to the original file if the browser cannot. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return blob || file;
  } catch {
    return file;
  }
}

export default function PhotoUploadPage({ params }: { params: { token: string } }) {
  const tenant = useTenant();
  const [shop, setShop] = useState<{ name: string; town: string | null } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [problem, setProblem] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/photos/upload?token=${encodeURIComponent(params.token)}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => { if (ok) { setShop(d.shop); setRemaining(d.remaining); } else setProblem(d.error || 'This link is not valid any more. Ask your rep for a new one.'); })
      .catch(() => setProblem('We could not check this link. Please try again in a moment.'));
  }, [params.token]);

  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    const chosen = Array.from(files).slice(0, Math.max(0, remaining));
    if (!chosen.length) return;
    setBusy(true);
    const start = items.length;
    setItems((prev) => [...prev, ...chosen.map((f): Item => ({ name: f.name, state: 'waiting' }))]);
    const mark = (i: number, patch: Partial<Item>) => setItems((prev) => prev.map((it, idx) => (idx === start + i ? { ...it, ...patch } : it)));

    // One at a time: a phone on a shop's wifi does better with a queue than a burst.
    for (let i = 0; i < chosen.length; i++) {
      mark(i, { state: 'sending' });
      try {
        const form = new FormData();
        form.append('token', params.token);
        form.append('photo', await shrink(chosen[i]), 'photo.jpg');
        const res = await fetch('/api/photos/upload', { method: 'POST', body: form });
        const d = await res.json().catch(() => ({}));
        if (res.ok) { mark(i, { state: 'done' }); setRemaining((n) => Math.max(0, n - 1)); }
        else mark(i, { state: 'failed', error: d.error || 'That photo could not be saved.' });
      } catch {
        mark(i, { state: 'failed', error: 'The connection dropped. Please try that photo again.' });
      }
    }
    setBusy(false);
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: sans, display: 'flex', justifyContent: 'center' };
  const box: React.CSSProperties = { width: '100%', maxWidth: 460, padding: '2rem 1.25rem' };
  const card: React.CSSProperties = { background: C.card, borderRadius: 16, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 12 };
  const done = items.filter((i) => i.state === 'done').length;

  return (
    <div style={wrap}>
      <div style={box}>
        <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 14, letterSpacing: '0.12em' }}>{tenant.wordmark}</div>
        {problem ? (
          <div style={{ ...card, marginTop: 20 }}><p style={{ fontSize: 14, color: C.mid, margin: 0 }}>{problem}</p></div>
        ) : !shop ? (
          <p style={{ fontSize: 14, color: C.soft, marginTop: 20 }}>Checking your link…</p>
        ) : (
          <>
            <h1 style={{ fontSize: 24, lineHeight: 1.15, margin: '14px 0 6px' }}>Photos of your work</h1>
            <p style={{ fontSize: 14, color: C.mid, margin: '0 0 16px' }}>For <strong>{shop.name}</strong>{shop.town ? `, ${shop.town}` : ''}. We use them on your Google posts once they have been checked.</p>

            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Good photos</div>
              <ul style={{ fontSize: 13, color: C.mid, margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Finished jobs, your showroom, your team at work.</li>
                <li>Photos you took, or have permission to use.</li>
                <li>No customers&apos; faces, house numbers or number plates.</li>
              </ul>
              <p style={{ fontSize: 12, color: C.soft, margin: '10px 0 0' }}>We remove the hidden details phones add to photos, including where each one was taken, before anything is saved.</p>
            </div>

            {remaining > 0 ? (
              <label style={{ display: 'block', background: C.text, color: '#fff', borderRadius: 8, padding: '14px 28px', fontSize: 15, fontWeight: 600, textAlign: 'center', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, marginBottom: 12 }}>
                {busy ? 'Uploading…' : items.length ? 'Add more photos' : 'Choose photos'}
                <input type="file" accept="image/jpeg,image/png" multiple disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
              </label>
            ) : (
              <div style={card}><p style={{ fontSize: 14, color: C.mid, margin: 0 }}>That&apos;s as many photos as we can take for now. Thank you.</p></div>
            )}

            {items.length > 0 && (
              <div style={card}>
                {items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 13 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                    <span style={{ flexShrink: 0, textAlign: 'right', maxWidth: '60%', color: it.state === 'done' ? C.green : it.state === 'failed' ? C.red : C.soft }}>
                      {it.state === 'done' ? 'Saved' : it.state === 'failed' ? it.error : it.state === 'sending' ? 'Uploading…' : 'Waiting'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {done > 0 && !busy && <p style={{ fontSize: 13, color: C.mid, textAlign: 'center' }}>{done} photo{done === 1 ? '' : 's'} saved. We&apos;ll check {done === 1 ? 'it' : 'them'} before anything is used. You can close this page.</p>}
          </>
        )}
      </div>
    </div>
  );
}
