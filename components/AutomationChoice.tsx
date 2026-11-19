'use client';

/**
 * "How would you like us to work?" The shop's one choice: Hands-off or Ask me
 * first (lib/automation-mode.ts), and its Pause button.
 *
 * Used on the "you're connected" page (the choice) and in Settings (where the
 * shop sees which it chose, can change it, and can pause everything).
 *
 * The wording comes from the server with its version, and the version is sent
 * back with the choice, so what is stored as agreed is what was on the screen.
 * Nothing is chosen for the shop and nothing is ticked in advance: there are
 * two buttons, and the choice is made by pressing one.
 *
 * While HANDS_OFF_MODE is off this renders `children` (what the page showed
 * before) and nothing else.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

type Mode = 'hands_off' | 'ask_first';
interface State {
  enabled: boolean; mode: Mode; label: string; chosen: boolean; paused: boolean; held: boolean;
  permissionOn: string | null; offeredFirst: Mode; wordingVersion: string;
  handsOff: { title: string; summary: string; points: string[]; permission: string; button: string; holdingReply: string };
  askFirst: { title: string; summary: string; points: string[]; button: string };
}
const sans = "'DM Sans',sans-serif";
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

export default function AutomationChoice({ variant, cardStyle, children, onChanged }: { variant: 'onboarding' | 'settings'; cardStyle: CSSProperties; children?: ReactNode; onChanged?: () => void }) {
  const [s, setS] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/automation-mode').then(async (r) => {
      if (!r.ok) throw new Error();
      setS(await r.json());
    }).catch(() => setFailed(true));
  }, []);

  async function post(body: Record<string, unknown>): Promise<any | null> {
    setBusy(true); setNote(null);
    try {
      const res = await fetch('/api/automation-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setNote({ ok: false, text: j.error || 'We could not save that. Please try again.' }); return null; }
      return j;
    } catch { setNote({ ok: false, text: 'We could not reach our server. Check your signal and try again.' }); return null; } finally { setBusy(false); }
  }
  async function choose(mode: Mode) {
    if (!s) return;
    const j = await post(mode === 'hands_off' ? { mode, wordingVersion: s.wordingVersion } : { mode });
    if (!j) return;
    setS({ ...s, mode: j.mode, label: j.label, chosen: j.chosen, paused: j.paused, held: j.held, permissionOn: j.permissionOn });
    setChanging(false);
    setNote({ ok: true, text: j.mode === 'hands_off' ? 'Hands-off is on. Thank you.' : 'Saved. Posts and replies are off until you turn on the ones you want.' });
    onChanged?.();
  }
  async function pause(paused: boolean) {
    if (!s) return;
    const j = await post({ paused });
    if (!j) return;
    setS({ ...s, paused: j.paused }); setNote({ ok: true, text: j.message }); onChanged?.();
  }

  // Off, or could not be loaded: the page as it was. Never a broken card.
  if (failed || !s) return <>{failed ? children : null}</>;
  // Switch off, but the shop is paused: it must still be able to resume.
  if (!s.enabled && s.paused) return (
    <>
      <div style={cardStyle}>
        <div style={{ fontSize: 17, fontWeight: 700, fontFamily: sans, color: '#1A1A1A' }}>Paused</div>
        <p style={{ fontSize: 15, color: '#555', margin: '2px 0 12px', fontFamily: sans }}>Nothing is being posted or replied to. Press Resume when you are ready.</p>
        <button type="button" disabled={busy} onClick={() => pause(false)} style={{ border: 'none', borderRadius: 10, padding: '13px 18px', fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: sans, background: '#2D7A4F', color: '#fff' }}>Resume</button>
        {note && <p role="status" style={{ fontSize: 14, margin: '10px 0 0', fontFamily: sans, color: note.ok ? '#2D7A4F' : '#D93025' }}>{note.text}</p>}
      </div>
      {children}
    </>
  );
  if (!s.enabled) return <>{children}</>;

  const C = { text: '#1A1A1A', mid: '#555', soft: '#8A8A8A', card2: '#F5F3EF', border: 'rgba(0,0,0,0.1)', green: '#2D7A4F', red: '#D93025', amberL: '#FFF8E6', amber: '#B8860B' };
  const b: CSSProperties = { border: 'none', borderRadius: 10, padding: '13px 18px', fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: sans };
  const link: CSSProperties = { ...b, background: 'transparent', color: C.mid, textDecoration: 'underline', padding: '10px 4px', fontWeight: 500, fontSize: 15 };
  const status = note && <p role="status" style={{ fontSize: 14, margin: '10px 0 0', fontFamily: sans, color: note.ok ? C.green : C.red }}>{note.text}</p>;

  // Two buttons, and nothing chosen until one is pressed: no option is ticked
  // or selected in advance. Hands-off is the large one; where the brand
  // recommends it, it says so. Pressing a button is the choice, and is what is
  // recorded, with the time and the version of the wording shown here.
  const points = (items: string[]) => <ul style={{ margin: '8px 0 0', paddingLeft: 22, fontSize: 14, lineHeight: 1.5, color: C.mid, fontFamily: sans }}>{items.map((p) => <li key={p}>{p}</li>)}</ul>;
  const chooser = (
    <>
      <div style={{ background: C.card2, border: `2px solid var(--brand-strong)`, borderRadius: 12, padding: '14px 14px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: sans }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{s.handsOff.title}</span>
          {s.offeredFirst === 'hands_off' && <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#fff', background: 'var(--brand-strong)', borderRadius: 999, padding: '3px 9px' }}>Recommended</span>}
        </div>
        <p style={{ fontSize: 15, color: C.mid, margin: '4px 0 0', fontFamily: sans }}>{s.handsOff.summary}</p>
        {points(s.handsOff.points)}
        <p style={{ fontSize: 13, color: C.soft, margin: '8px 0 0', fontFamily: sans }}>The reply to a 1, 2 or 3 star review reads: &ldquo;{s.handsOff.holdingReply}&rdquo;</p>
        <p style={{ fontSize: 14, color: C.text, margin: '10px 0 12px', fontFamily: sans }}>{s.handsOff.permission}</p>
        <button type="button" disabled={busy} onClick={() => choose('hands_off')} style={{ ...b, display: 'block', width: '100%', padding: '17px 18px', fontSize: 18, background: 'var(--brand-strong)', color: '#fff', opacity: busy ? 0.6 : 1 }}>{s.handsOff.button}</button>
      </div>
      <div style={{ padding: '2px 2px 0' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: sans }}>{s.askFirst.title}</div>
        <p style={{ fontSize: 14, color: C.mid, margin: '2px 0 0', fontFamily: sans }}>{s.askFirst.summary}</p>
        {points(s.askFirst.points)}
        <button type="button" disabled={busy} onClick={() => choose('ask_first')} style={{ ...b, marginTop: 10, padding: '9px 14px', fontSize: 14, background: '#fff', color: C.text, border: `1px solid ${C.border}`, opacity: busy ? 0.6 : 1 }}>{s.askFirst.button}</button>
      </div>
      <p style={{ fontSize: 13, color: C.soft, margin: '12px 0 0', fontFamily: sans }}>You can change this, or pause everything, at any time in Settings.</p>
    </>
  );

  const heldNote = s.held && s.mode === 'hands_off' && (
    <p style={{ fontSize: 14, color: C.mid, background: C.amberL, borderLeft: `4px solid ${C.amber}`, borderRadius: 8, padding: '8px 10px', margin: '10px 0 0', fontFamily: sans }}>We will start once your listing has been checked. Until then nothing is posted or replied to.</p>
  );
  const pauseRow = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
      {s.paused
        ? <button type="button" disabled={busy} onClick={() => pause(false)} style={{ ...b, background: C.green, color: '#fff' }}>Resume</button>
        : <button type="button" disabled={busy} onClick={() => pause(true)} style={{ ...b, background: '#fff', color: C.text, border: `1px solid ${C.border}` }}>Pause everything</button>}
      {!changing && <button type="button" disabled={busy} onClick={() => { setChanging(true); setNote(null); }} style={link}>Change how we work</button>}
    </div>
  );
  const current = (
    <>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: sans, color: C.text }}>{s.paused ? 'Paused' : s.label}</div>
      <p style={{ fontSize: 15, color: C.mid, margin: '2px 0 0', fontFamily: sans }}>
        {s.paused ? 'Nothing is being posted or replied to. Press Resume when you are ready.'
          : s.mode === 'hands_off' ? `${s.handsOff.summary}${s.permissionOn ? ` You chose this on ${day(s.permissionOn)}.` : ''}`
          : s.askFirst.summary}
      </p>
      {!s.paused && s.mode === 'hands_off' && <p style={{ fontSize: 14, color: C.mid, margin: '6px 0 0', fontFamily: sans }}>To undo something we have posted or replied, use the list of changes{variant === 'settings' ? ' above' : ' in Settings'}.</p>}
      {heldNote}
      {pauseRow}
    </>
  );

  // The choice has not been made yet (onboarding), or the shop asked to change it.
  if (changing || (variant === 'onboarding' && !s.chosen)) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: sans, color: C.text }}>How would you like us to work?</div>
        <p style={{ fontSize: 15, color: C.mid, margin: '0 0 12px', fontFamily: sans }}>Choose one. Nothing has been posted or changed yet.</p>
        {chooser}
        {changing && <button type="button" disabled={busy} onClick={() => { setChanging(false); setNote(null); }} style={link}>Leave it as it is</button>}
        {status}
      </div>
    );
  }
  return (
    <>
      <div style={cardStyle}>
        {variant === 'settings' && <div style={{ fontFamily: sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#999', marginBottom: 12 }}>How we work</div>}
        {current}
        {status}
      </div>
      {/* Ask me first: the two switches, exactly as before. */}
      {s.mode === 'ask_first' && variant === 'onboarding' ? children : null}
    </>
  );
}
