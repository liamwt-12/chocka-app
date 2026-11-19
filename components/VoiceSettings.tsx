'use client';

/**
 * "How your posts sound": a shop's own voice (lib/voice.ts), editable from
 * Settings. The same questions as onboarding (VoiceFields), saved through the
 * same route (/api/voice), so the same server-side checks apply: nothing here
 * validates, it only shows what the server said.
 *
 * Shown only when /api/voice says a shop is linked to this account, which means
 * a Stellar shop with a retailers row. A Chocka account, or any account the
 * route cannot place, sees nothing: the card renders null.
 *
 * It starts from the stored voice, changes nothing until Save, and the line
 * under the button says what happened.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import VoiceFields, { draftFromVoice, EMPTY_DRAFT, type VoiceDraft } from './VoiceFields';
import { voiceLastChangedLine as lastChangedLine } from '@/lib/voice';

const sans = "'DM Sans',sans-serif";
const C = { text: '#1A1A1A', mid: '#555', soft: '#8A8A8A', green: '#2D7A4F', red: '#D93025', border: 'rgba(0,0,0,0.12)' };
const btn: CSSProperties = { background: 'var(--brand-strong)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: sans };
const input: CSSProperties = { fontFamily: sans, fontSize: 16, padding: '10px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.text };
const fieldLabel: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 600, color: C.text, fontFamily: sans, marginBottom: 6 };
const hint: CSSProperties = { fontSize: 13, color: C.soft, fontFamily: sans, marginTop: 4, lineHeight: 1.4 };
const intro: CSSProperties = { fontSize: 14, color: C.mid, margin: '0 0 14px', fontFamily: sans, lineHeight: 1.5 };

type Result = { ok: boolean; message: string } | null;
const same = (a: VoiceDraft, b: VoiceDraft) => (Object.keys(a) as (keyof VoiceDraft)[]).every((k) => a[k].trim() === b[k].trim());

export default function VoiceSettings({ cardStyle, labelStyle }: { cardStyle: CSSProperties; labelStyle: CSSProperties }) {
  const [available, setAvailable] = useState(false);
  const [draft, setDraft] = useState<VoiceDraft>(EMPTY_DRAFT);
  const [saved, setSaved] = useState<VoiceDraft>(EMPTY_DRAFT);
  const [changed, setChanged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  useEffect(() => {
    fetch('/api/voice').then((r) => (r.ok ? r.json() : null)).then((v) => {
      if (!v?.available) return;
      const d = draftFromVoice(v.voice);
      setDraft(d); setSaved(d); setChanged(lastChangedLine(v.updatedBy, v.updatedAt)); setAvailable(true);
    }).catch(() => {});
  }, []);

  if (!available) return null;

  const unchanged = same(draft, saved);
  const save = async () => {
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: draft }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setResult({ ok: false, message: d.error || 'We could not save that. Please try again.' }); return; }
      // Show what the server kept (trimmed, de-duplicated), so the form matches what is stored.
      const next = draftFromVoice(d.voice);
      setDraft(next); setSaved(next); setChanged(lastChangedLine(d.updatedBy, d.updatedAt));
      const cleared = !Object.values(next).some((x) => x.trim());
      setResult({ ok: true, message: cleared ? 'Cleared. Your posts and replies will use our standard wording.' : 'Saved. Your next posts and replies will be written this way.' });
    } catch {
      setResult({ ok: false, message: 'We could not reach our server. Check your signal and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={cardStyle} id="voice">
      <div style={labelStyle}>How your posts sound</div>
      <p style={intro}>How we write your Google posts and your replies to good reviews. Every question is optional. Nothing changes until you press Save.</p>
      <VoiceFields value={draft} onChange={(v) => { setDraft(v); setResult(null); }} inputStyle={input} labelStyle={fieldLabel} hintStyle={hint} disabled={busy} />
      <button onClick={save} disabled={busy || unchanged} style={{ ...btn, marginTop: 14, opacity: busy || unchanged ? 0.5 : 1 }}>{busy ? 'Saving…' : 'Save how your posts sound'}</button>
      {result && <p role="status" style={{ fontSize: 14, fontFamily: sans, margin: '10px 0 0', color: result.ok ? C.green : C.red }}>{result.ok ? '✓ ' : ''}{result.message}</p>}
      {changed && !result && <p style={{ ...hint, marginTop: 10 }}>{changed}</p>}
      <p style={{ ...hint, marginTop: 10 }}>This is never used for replies to 1 to 3 star reviews.</p>
    </div>
  );
}
