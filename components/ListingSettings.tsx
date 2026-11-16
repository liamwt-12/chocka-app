'use client';

/**
 * The parts of a shop's Google listing it can change from Settings: opening
 * hours, holiday hours and website.
 *
 * Each starts from what Google holds now (read fresh when the page opens), is
 * written only when the shop presses Save, and is then read back from Google.
 * The line under each Save button is what that check found: done, or not done
 * and why. Every change is recorded with what it replaced, like the rest.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import HoursEditor from './HoursEditor';
import { validateHoursDraft, type HoursDraft, type SpecialDay } from '@/lib/opening-hours';

const sans = "'DM Sans',sans-serif";
const C = { text: '#1A1A1A', mid: '#555', soft: '#8A8A8A', green: '#2D7A4F', red: '#D93025', border: 'rgba(0,0,0,0.12)', card2: '#F5F3EF' };
const btn: CSSProperties = { background: 'var(--brand-strong)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: sans };
const field: CSSProperties = { fontFamily: sans, fontSize: 16, padding: '10px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.text, boxSizing: 'border-box', minWidth: 0 };
const h3: CSSProperties = { fontSize: 16, fontWeight: 700, margin: '0 0 4px', fontFamily: sans, color: C.text };
const hint: CSSProperties = { fontSize: 14, color: C.mid, margin: '0 0 12px', fontFamily: sans, lineHeight: 1.5 };

type Result = { ok: boolean; message: string; nextStep?: string } | null;
const niceDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function save(body: Record<string, unknown>): Promise<Result> {
  try {
    const res = await fetch('/api/profile-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => null);
    if (d?.result) return d.result;
    return { ok: false, message: d?.code === 'google_disconnected' ? 'We have lost the connection to your Google account.' : 'We could not save that.', nextStep: d?.code === 'google_disconnected' ? 'Press Reconnect above, then try again.' : 'Please try again.' };
  } catch { return { ok: false, message: 'We could not reach our server.', nextStep: 'Check your signal and try again.' }; }
}

function Outcome({ r }: { r: Result }) {
  if (!r) return null;
  return <p role="status" style={{ fontSize: 14, fontFamily: sans, margin: '10px 0 0', color: r.ok ? C.green : C.red }}>{r.ok ? '✓ ' : ''}{r.message}{!r.ok && r.nextStep ? ` ${r.nextStep}` : ''}</p>;
}

export default function ListingSettings({ cardStyle, labelStyle }: { cardStyle: CSSProperties; labelStyle: CSSProperties }) {
  const [d, setD] = useState<any>(null);
  const [hours, setHours] = useState<HoursDraft | null>(null);
  const [days, setDays] = useState<SpecialDay[]>([]);
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState<Record<string, Result>>({});

  const load = () => fetch('/api/listing').then((r) => r.json()).then((j) => {
    setD(j);
    if (j.available) { setHours(j.hours.complex ? null : j.hours.draft); setDays(j.holidays.days); setSite(j.website || ''); }
  }).catch(() => setD({ available: false, why: 'We could not load your listing just now.' }));
  useEffect(() => { load(); }, []);

  const run = async (key: string, body: Record<string, unknown>) => { setBusy(key); const r = await save(body); setRes((x) => ({ ...x, [key]: r })); setBusy(''); };
  const hoursCheck = hours ? validateHoursDraft(hours) : null;
  const setDay = (i: number, patch: Partial<SpecialDay>) => setDays(days.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addDay = (date: string) => { if (date && !days.some((x) => x.date === date)) setDays([...days, { date, open: false, from: '', to: '' }].sort((a, b) => a.date.localeCompare(b.date))); };

  return (
    <div style={cardStyle} id="listing">
      <div style={labelStyle}>Your Google listing</div>
      {!d ? <p style={hint} aria-live="polite">Reading your listing from Google…</p> : !d.available ? <p style={hint}>{d.why}</p> : (
        <>
          {/* Opening hours */}
          <h3 style={h3}>Opening hours</h3>
          {d.hours.complex ? (
            <p style={hint}>Your hours on Google are more detailed than we can edit here (for example closed for lunch, or open late). Change them in Google, and they stay as you set them.</p>
          ) : hours && (
            <>
              <p style={hint}>{d.hours.daysSet ? 'These are the hours on your Google listing now.' : 'Your Google listing has no opening hours. Customers often check before setting off.'} We never guess them: they only change when you press Save.</p>
              <HoursEditor value={hours} onChange={(v) => { setHours(v); setRes((x) => ({ ...x, hours: null })); }} disabled={busy === 'hours'} />
              {!hoursCheck?.ok && hours.some((x) => x.open) && <p style={{ fontSize: 14, color: C.soft, fontFamily: sans, margin: '8px 0 0' }}>{(hoursCheck as any)?.error}</p>}
              <button onClick={() => run('hours', { step: 'hours', hours: (hoursCheck as any).value })} disabled={!hoursCheck?.ok || busy === 'hours'} style={{ ...btn, marginTop: 12, opacity: !hoursCheck?.ok || busy === 'hours' ? 0.5 : 1 }}>{busy === 'hours' ? 'Saving and checking…' : 'Save opening hours'}</button>
              <Outcome r={res.hours} />
            </>
          )}

          {/* Holiday hours */}
          <div id="holiday" style={{ borderTop: `1px solid ${C.border}`, margin: '20px 0 0', paddingTop: 18 }}>
            <h3 style={h3}>Holiday hours</h3>
            <p style={hint}>Days you are closed, or open different hours: bank holidays, Christmas, a week away. Without these, Google shows your normal hours on those days.</p>
            {d.holidays.complex && <p style={{ ...hint, color: C.soft }}>Your listing also has some holiday hours we cannot show here (several days in a row, or open all day). We leave those exactly as they are.</p>}
            {days.length === 0 && <p style={{ ...hint, color: C.soft, marginBottom: 8 }}>None set.</p>}
            {days.map((x, i) => (
              <div key={x.date} style={{ background: C.card2, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 15, fontFamily: sans }}>{niceDate(x.date)}</strong>
                  <button type="button" onClick={() => setDays(days.filter((_, j) => j !== i))} aria-label={`Remove ${niceDate(x.date)}`} style={{ background: 'none', border: 'none', color: C.mid, fontSize: 14, textDecoration: 'underline', cursor: 'pointer', fontFamily: sans }}>Remove</button>
                </div>
                <div style={{ display: 'flex', gap: 14, margin: '8px 0 0', fontFamily: sans, fontSize: 15 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={!x.open} onChange={() => setDay(i, { open: false })} style={{ width: 18, height: 18 }} /> Closed</label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={x.open} onChange={() => setDay(i, { open: true })} style={{ width: 18, height: 18 }} /> Open different hours</label>
                </div>
                {x.open && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center', marginTop: 8 }}>
                    <input type="time" value={x.from} onChange={(e) => setDay(i, { from: e.target.value })} style={field} aria-label={`${niceDate(x.date)} opens at`} />
                    <span style={{ fontSize: 13, color: C.soft, fontFamily: sans }}>to</span>
                    <input type="time" value={x.to} onChange={(e) => setDay(i, { to: e.target.value })} style={field} aria-label={`${niceDate(x.date)} closes at`} />
                  </div>
                )}
              </div>
            ))}
            {(d.bankHolidays || []).filter((h: any) => !days.some((x) => x.date === h.date)).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 10px' }}>
                {(d.bankHolidays as any[]).filter((h) => !days.some((x) => x.date === h.date)).slice(0, 6).map((h) => (
                  <button key={h.date} type="button" onClick={() => addDay(h.date)} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 20, padding: '8px 12px', fontSize: 14, fontFamily: sans, cursor: 'pointer', color: C.text }}>+ {h.name.replace(/ \(bank holiday\)$/, '')}, {niceDate(h.date).replace(/ \d{4}$/, '')}</button>
                ))}
              </div>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: sans, fontSize: 15, flexWrap: 'wrap' }}>Add another date
              <input type="date" min={d.today} onChange={(e) => { addDay(e.target.value); e.target.value = ''; }} style={field} aria-label="Add a date" />
            </label>
            <div><button onClick={() => run('holiday', { step: 'holidayHours', days })} disabled={busy === 'holiday'} style={{ ...btn, marginTop: 12, opacity: busy === 'holiday' ? 0.5 : 1 }}>{busy === 'holiday' ? 'Saving and checking…' : 'Save holiday hours'}</button></div>
            <Outcome r={res.holiday} />
          </div>

          {/* Website */}
          <div style={{ borderTop: `1px solid ${C.border}`, margin: '20px 0 0', paddingTop: 18 }}>
            <h3 style={h3}>Website</h3>
            <p style={hint}>{d.website ? 'This is the website on your Google listing.' : 'Your Google listing has no website. If you have one, type it here. If you do not, leave this empty.'}</p>
            <input type="url" inputMode="url" value={site} onChange={(e) => { setSite(e.target.value); setRes((x) => ({ ...x, website: null })); }} placeholder="www.yourshop.co.uk" style={{ ...field, width: '100%' }} aria-label="Website" />
            <div><button onClick={() => run('website', { step: 'website', url: site })} disabled={!site.trim() || busy === 'website' || site.trim() === (d.website || '')} style={{ ...btn, marginTop: 12, opacity: !site.trim() || busy === 'website' || site.trim() === (d.website || '') ? 0.5 : 1 }}>{busy === 'website' ? 'Saving and checking…' : 'Save website'}</button></div>
            <Outcome r={res.website} />
          </div>

          <p style={{ fontSize: 13, color: C.soft, fontFamily: sans, margin: '18px 0 0', lineHeight: 1.5 }}>We do not add photos, set the area you cover, or tick extra details such as card payments and wheelchair access. Those are quick to do in Google, under “Edit profile”.</p>
        </>
      )}
    </div>
  );
}
