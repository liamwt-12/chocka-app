'use client';

/**
 * "You're connected."
 *
 * The end of the part a shop has to do: one link, one press, Google, and here.
 * Everything below the confirmation is optional and can be done now, later
 * from the dashboard, or never:
 *   - see what we could improve on the listing (nothing changes unless ticked)
 *   - choose whether we write posts or reply to good reviews (both off)
 *
 * No mobile number is asked for. Texts are off, and a shop with only a landline
 * used to be unable to finish at all.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/lib/tenant-context';

const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const barlow = "'Barlow Condensed',sans-serif";
const C = { bg: '#F0EDE8', card: '#FAFAF8', card2: '#F5F3EF', text: '#1A1A1A', mid: '#555', soft: '#8A8A8A', green: '#2D7A4F', greenL: '#E8F5EE', amberL: '#FFF8E6', amber: '#B8860B', border: 'rgba(0,0,0,0.1)' };
const card: React.CSSProperties = { background: C.card, borderRadius: 16, padding: 18, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 14 };
const btn: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'center', background: 'var(--brand-strong)', color: '#fff', border: 'none', borderRadius: 10, padding: '15px 20px', fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: sans, textDecoration: 'none', boxSizing: 'border-box' };

export default function ConnectedPage() {
  const tenant = useTenant();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [posts, setPosts] = useState(false);
  const [replies, setReplies] = useState(false);
  const [saving, setSaving] = useState('');
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    fetch('/api/connected').then(async (r) => {
      if (r.status === 401) { router.replace('/login'); return; }
      const j = await r.json();
      if (!r.ok) { setFailed(true); return; }
      // No listing bound yet (several listings, none chosen): go and choose.
      if (!j.connected) { router.replace('/onboarding?select=1'); return; }
      setD(j); setPosts(j.choices.posts); setReplies(j.choices.replies);
    }).catch(() => setFailed(true));
  }, [router]);

  // Saved the moment it is pressed, so there is no "continue" to forget.
  async function choose(field: 'auto_post_enabled' | 'auto_reply_enabled', value: boolean) {
    setSaving(field); setSaveErr('');
    const set = field === 'auto_post_enabled' ? setPosts : setReplies;
    set(value);
    try {
      const res = await fetch('/api/account/delete', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) });
      if (!res.ok) throw new Error();
    } catch { set(!value); setSaveErr('We could not save that. Please try again.'); }
    setSaving('');
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: C.bg, fontFamily: sans, color: C.text, display: 'flex', justifyContent: 'center' };
  const box: React.CSSProperties = { width: '100%', maxWidth: 480, padding: '2.2rem 1.1rem 3rem' };
  const logo = <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 14, letterSpacing: '0.12em', color: 'var(--brand-strong)' }}>{tenant.wordmark}</div>;

  if (failed) return <div style={wrap}><div style={box}>{logo}<div style={{ ...card, marginTop: 20 }}><p style={{ fontSize: 16, margin: '0 0 14px' }}>You are connected, but we could not load this page just now.</p><a href="/dashboard" style={btn}>Go to my dashboard</a></div></div></div>;
  if (!d) return <div style={wrap}><div style={box}>{logo}<p style={{ color: C.soft, marginTop: 24 }} aria-live="polite">One moment…</p></div></div>;

  return (
    <div style={wrap}><div style={box}>
      {logo}
      <div style={{ ...card, marginTop: 18, background: C.greenL, border: `1px solid ${C.green}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: '50%', background: C.green, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>✓</span>
          <h1 style={{ fontFamily: barlow, fontSize: 32, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1, margin: 0 }}>You&apos;re connected</h1>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 14 }}>{d.shop.name}</div>
        {d.shop.address && <div style={{ fontSize: 15, color: C.mid }}>{d.shop.address}</div>}
        <p style={{ fontSize: 15, color: C.text, margin: '12px 0 0' }}>That is all we needed. <strong>Nothing has been changed on your Google listing.</strong></p>
        {d.wrongAccountPath && <a href={d.wrongAccountPath} style={{ display: 'inline-block', marginTop: 10, fontSize: 14, color: C.mid, textDecoration: 'underline' }}>This is not my shop</a>}
      </div>

      {d.note && (
        <div style={{ ...card, background: C.amberL, borderLeft: `4px solid ${C.amber}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{d.note.title}</div>
          <p style={{ fontSize: 15, color: C.mid, margin: '0 0 6px' }}>{d.note.message}</p>
          <p style={{ fontSize: 15, color: C.mid, margin: 0 }}>{d.note.nextStep}</p>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>See what we could improve</div>
        <p style={{ fontSize: 15, color: C.mid, margin: '0 0 14px' }}>We look at your listing and suggest changes: your description, services, opening hours, replies to reviews. You read each one and tick what you want. Takes about two minutes.</p>
        <a href="/onboarding" style={btn}>Look at my listing</a>
      </div>

      <div style={card}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Want us to keep it up to date?</div>
        <p style={{ fontSize: 15, color: C.mid, margin: '0 0 12px' }}>Both are off. Turn on what you want. You can change either at any time in Settings.</p>
        {([
          { field: 'auto_post_enabled' as const, on: posts, title: 'Write a short post each week', desc: 'You approve your first three before they go up. After that we send you each one first and you can stop it.' },
          { field: 'auto_reply_enabled' as const, on: replies, title: 'Reply to good reviews', desc: 'We reply to 4 and 5 star reviews. Anything lower always comes to you first.' },
        ]).map((o) => (
          <button key={o.field} type="button" role="switch" aria-checked={o.on} disabled={saving === o.field} onClick={() => choose(o.field, !o.on)}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left', background: C.card2, border: `2px solid ${o.on ? 'var(--brand-strong)' : C.border}`, borderRadius: 12, padding: '13px 14px', marginBottom: 8, cursor: 'pointer', fontFamily: sans }}>
            <span aria-hidden="true" style={{ width: 46, height: 26, borderRadius: 13, background: o.on ? 'var(--brand-strong)' : '#C9C5BD', position: 'relative', flexShrink: 0, marginTop: 2 }}>
              <span style={{ position: 'absolute', top: 3, left: o.on ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </span>
            <span>
              <span style={{ display: 'block', fontSize: 16, fontWeight: 600, color: C.text }}>{o.title} <span style={{ fontWeight: 400, color: C.soft }}>({o.on ? 'on' : 'off'})</span></span>
              <span style={{ display: 'block', fontSize: 14, color: C.mid, marginTop: 2 }}>{o.desc}</span>
            </span>
          </button>
        ))}
        {saveErr && <p role="alert" style={{ fontSize: 14, color: '#D93025', margin: '4px 0 0' }}>{saveErr}</p>}
      </div>

      <a href="/dashboard" style={{ ...btn, background: 'transparent', color: C.text, border: `1px solid ${C.border}` }}>Done for now</a>
      <p style={{ fontSize: 14, color: C.soft, textAlign: 'center', margin: '16px 0 0' }}>
        It&apos;s free{tenant.fundedBy ? `: ${tenant.brandName} is paid for by ${tenant.fundedBy}` : ''}. You stay the owner of your listing and can remove us at any time.<br />
        Questions? <a href={`mailto:${tenant.supportEmail}`} style={{ color: C.mid }}>{tenant.supportEmail}</a>
      </p>
    </div></div>
  );
}
