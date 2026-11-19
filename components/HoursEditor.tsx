'use client';

/**
 * Seven days of opening hours for the shop to fill in. Used when a shop first
 * looks at what we could improve, and in Settings afterwards.
 *
 * It only ever shows what it was given and what the shop types. It has no
 * default times. "Copy to weekdays" exists because most shops keep the same
 * hours Monday to Friday and typing them five times on a phone is a chore.
 */
import type { CSSProperties } from 'react';
import { DAY_LABELS, type HoursDraft } from '@/lib/opening-hours';

const sans = "'DM Sans',sans-serif";
const border = 'rgba(0,0,0,0.12)';
const time: CSSProperties = { fontFamily: sans, fontSize: 16, padding: '8px 6px', borderRadius: 8, border: `1px solid ${border}`, background: '#fff', color: '#1A1A1A', width: '100%', minWidth: 0, boxSizing: 'border-box' };

export default function HoursEditor({ value, onChange, disabled }: { value: HoursDraft; onChange: (v: HoursDraft) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<HoursDraft[number]>) => onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const firstOpen = value.find((d) => d.open && d.from && d.to);
  const copyWeekdays = () => { if (firstOpen) onChange(value.map((d, i) => (i < 5 ? { ...d, open: true, from: firstOpen.from, to: firstOpen.to } : d))); };
  return (
    <div>
      {value.map((d, i) => (
        <div key={d.day} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: i ? `1px solid ${border}` : 'none' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontFamily: sans, cursor: disabled ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={d.open} disabled={disabled} onChange={(e) => set(i, { open: e.target.checked })} style={{ width: 20, height: 20 }} aria-label={`${DAY_LABELS[d.day]} open`} />
            {DAY_LABELS[d.day].slice(0, 3)}
          </label>
          {d.open ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
              <input type="time" value={d.from} disabled={disabled} onChange={(e) => set(i, { from: e.target.value })} style={time} aria-label={`${DAY_LABELS[d.day]} opens at`} />
              <span style={{ fontSize: 13, color: '#8A8A8A', fontFamily: sans }}>to</span>
              <input type="time" value={d.to} disabled={disabled} onChange={(e) => set(i, { to: e.target.value })} style={time} aria-label={`${DAY_LABELS[d.day]} closes at`} />
            </div>
          ) : <span style={{ fontSize: 14, color: '#8A8A8A', fontFamily: sans }}>Closed</span>}
        </div>
      ))}
      {firstOpen && !disabled && (
        <button type="button" onClick={copyWeekdays} style={{ marginTop: 8, background: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '8px 12px', fontSize: 14, fontFamily: sans, cursor: 'pointer', color: '#1A1A1A' }}>
          Use {firstOpen.from} to {firstOpen.to} for Monday to Friday
        </button>
      )}
    </div>
  );
}
