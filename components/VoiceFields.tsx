'use client';

import type { CSSProperties } from 'react';
import { TONE_LABELS, VOICE_LIMITS, type Tone } from '@/lib/voice';

/**
 * The voice questions, shared by onboarding (the shop answers) and /admin/pilot
 * (a rep answers for them). Lists are typed as comma-separated text and split by
 * the server (lib/voice.ts), which is also where every answer is validated:
 * nothing here is a check, only a form.
 */
export interface VoiceDraft {
  tone: string;
  about: string;
  specialities: string;
  signOff: string;
  wordsToUse: string;
  wordsToAvoid: string;
}

export const EMPTY_DRAFT: VoiceDraft = { tone: '', about: '', specialities: '', signOff: '', wordsToUse: '', wordsToAvoid: '' };

export function draftFromVoice(v: { tone: string | null; about: string | null; specialities: string[]; signOff: string | null; wordsToUse: string[]; wordsToAvoid: string[] } | null | undefined): VoiceDraft {
  if (!v) return { ...EMPTY_DRAFT };
  return {
    tone: v.tone || '',
    about: v.about || '',
    specialities: v.specialities.join(', '),
    signOff: v.signOff || '',
    wordsToUse: v.wordsToUse.join(', '),
    wordsToAvoid: v.wordsToAvoid.join(', '),
  };
}

export function draftIsEmpty(d: VoiceDraft): boolean {
  return !Object.values(d).some((x) => x.trim());
}

export default function VoiceFields({ value, onChange, inputStyle, labelStyle, hintStyle, accent = '#1A1A1A', disabled }: {
  value: VoiceDraft;
  onChange: (next: VoiceDraft) => void;
  inputStyle: CSSProperties;
  labelStyle: CSSProperties;
  hintStyle: CSSProperties;
  accent?: string;
  disabled?: boolean;
}) {
  const set = (k: keyof VoiceDraft) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const field: CSSProperties = { ...inputStyle, width: '100%', boxSizing: 'border-box' };
  const block: CSSProperties = { marginBottom: 14 };

  return (
    <div>
      <div style={block}>
        <div style={labelStyle}>How should it sound?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(Object.keys(TONE_LABELS) as Tone[]).map((t) => {
            const on = value.tone === t;
            return (
              <button key={t} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange({ ...value, tone: on ? '' : t })}
                style={{ border: `1px solid ${on ? accent : 'rgba(0,0,0,0.15)'}`, background: on ? accent : 'transparent', color: on ? '#fff' : 'inherit', borderRadius: 999, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                {TONE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={block}>
        <label style={labelStyle} htmlFor="voice-about">The shop in a sentence or two</label>
        <textarea id="voice-about" rows={3} maxLength={VOICE_LIMITS.about} disabled={disabled} value={value.about} onChange={set('about')}
          placeholder="Family-run flooring shop, fitting carpets and vinyl across the town since my dad started it." style={{ ...field, resize: 'vertical' }} />
      </div>

      <div style={block}>
        <label style={labelStyle} htmlFor="voice-specialities">What it is best known for</label>
        <input id="voice-specialities" disabled={disabled} value={value.specialities} onChange={set('specialities')} placeholder="Stair runners, luxury vinyl, same-week fitting" style={field} />
        <div style={hintStyle}>Separate with commas. Up to {VOICE_LIMITS.specialities}.</div>
      </div>

      <div style={block}>
        <label style={labelStyle} htmlFor="voice-signoff">How it signs off</label>
        <input id="voice-signoff" maxLength={VOICE_LIMITS.signOff} disabled={disabled} value={value.signOff} onChange={set('signOff')} placeholder="Dave and the team" style={field} />
      </div>

      <div style={block}>
        <label style={labelStyle} htmlFor="voice-use">Words it likes to use</label>
        <input id="voice-use" disabled={disabled} value={value.wordsToUse} onChange={set('wordsToUse')} placeholder="pop in, showroom, cuppa" style={field} />
      </div>

      <div style={{ marginBottom: 4 }}>
        <label style={labelStyle} htmlFor="voice-avoid">Words it would never use</label>
        <input id="voice-avoid" disabled={disabled} value={value.wordsToAvoid} onChange={set('wordsToAvoid')} placeholder="cheap, bargain, guys" style={field} />
        <div style={hintStyle}>No prices, phone numbers, web addresses or accreditations anywhere here: Google shows those elsewhere on the listing.</div>
      </div>
    </div>
  );
}
