'use client';

import { useState, useMemo } from 'react';
import PhotoPanel from '@/components/admin/PhotoPanel';
import VoiceFields, { draftFromVoice, EMPTY_DRAFT, type VoiceDraft } from '@/components/VoiceFields';

// Pilot admin: add a retailer, generate invite links (never sends), see who is live.
// Behind ADMIN_PASSWORD, like /admin. Links are shown once: only their hash is stored.

const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const C = { bg: '#F0EDE8', card: '#FAFAF8', text: '#1A1A1A', mid: '#555', soft: '#999', green: '#2D7A4F', greenL: '#E8F5EE', amber: '#B8860B', amberL: '#FFF8E6', red: '#D93025', redL: '#FDECEA' };
const card: React.CSSProperties = { background: C.card, borderRadius: 14, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 16 };
const input: React.CSSProperties = { background: C.bg, border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: sans, outline: 'none', boxSizing: 'border-box' };
const btn: React.CSSProperties = { background: C.text, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: sans };

const STATE_LABEL: Record<string, [string, string, string]> = {
  live: ['Live', C.green, C.greenL],
  connected_not_live: ['Connected, not live', C.amber, C.amberL],
  invited: ['Link issued', C.mid, '#EEE'],
  invite_expired: ['Link expired', C.red, C.redL],
  not_invited: ['Not invited', C.soft, '#F5F3EF'],
};

type Help = { key: string; label: string; live: boolean; needsHelp: boolean; severity: number; why: string; action: string; since: string | null; buttons: string[] };
type Change = { id: string; when: string; what: string; before: string; after: string; source: string; status: string; undone: boolean; canUndo: boolean; whyNot: string | null };
type Row = { help: Help; note: string | null; adSpendPence: number | null; adEndDate: string | null; firstLiveOn: string | null; excludedFromCount: boolean; id: string; name: string; town: string | null; contactEmail: string | null; source: string; state: string; detail: string; joinedAt: string | null; delisted: boolean; adStartDate: string | null; connection: { status: string; label: string; detail: string | null; checkedAt: string | null; nextStep: string | null } | null; voice: Voice | null; voiceUpdatedAt: string | null; voiceUpdatedBy: string | null; photos: { pending: number; approved: number } | null; review: { link: string; cardPath: string; source: 'connected' | 'baseline' } | null };
type Voice = { tone: string | null; about: string | null; specialities: string[]; signOff: string | null; wordsToUse: string[]; wordsToAvoid: string[] };
type Minted = { retailerId: string; name?: string; ok: boolean; link?: string; expiresAt?: string; error?: string };

export default function PilotAdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [minted, setMinted] = useState<Minted[]>([]);
  const [form, setForm] = useState({ name: '', town: '', contactEmail: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Voice editor: which shop is open, and what has been typed so far.
  const [voiceFor, setVoiceFor] = useState<Row | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft>(EMPTY_DRAFT);
  // Photos: only shown when the server says SHOP_PHOTOS is on.
  const [photosEnabled, setPhotosEnabled] = useState(false);
  const [photosFor, setPhotosFor] = useState<Row | null>(null);

  const call = async (payload: object) => {
    const res = await fetch('/api/admin/pilot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
    return data;
  };

  const load = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await call({ action: 'list' });
      setRows(d.retailers); setCounts(d.counts); setPhotosEnabled(!!d.photosEnabled); setAuthed(true);
    } catch (e: any) { setMsg(e.message === 'Unauthorized' ? 'Wrong password' : e.message); }
    setBusy(false);
  };

  const add = async () => {
    setBusy(true); setMsg('');
    try {
      const d = await call({ action: 'add', ...form });
      setMsg(`Added ${d.added.name}.`); setForm({ name: '', town: '', contactEmail: '' });
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  // Links for any number of shops in one go. The server makes at most 25 per
  // request (so no request runs long); this sends as many requests as it takes
  // and gathers the results into one list and one download. If a request fails
  // partway, the links already made are still shown, and pressing again only
  // makes the ones still missing: a shop with a valid link is never given a second.
  const CHUNK = 25;
  const inviteIds = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true); setMsg('');
    const all: Minted[] = [];
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        setMsg(`Making links: ${Math.min(i + CHUNK, ids.length)} of ${ids.length}…`);
        const d = await call({ action: 'invite', retailerIds: ids.slice(i, i + CHUNK) });
        all.push(...d.results);
        setMinted([...all]);
      }
      const made = all.filter((m) => m.ok).length;
      setMsg(`${made} link${made === 1 ? '' : 's'} made. Nothing has been sent: download the list and pass it to Tarkett.`);
    } catch (e: any) { setMsg(`${e.message}. ${all.filter((m) => m.ok).length} link(s) were made before that and are listed below; press again to make the rest.`); }
    setSelected(new Set());
    await load().catch(() => {});
    setBusy(false);
  };
  const invite = () => inviteIds(Array.from(selected));
  const withoutLink = useMemo(() => rows.filter((r) => (r.state === 'not_invited' || r.state === 'invite_expired') && !r.delisted), [rows]);

  const revoke = async (id: string) => {
    setBusy(true); setMsg('');
    try { const d = await call({ action: 'revoke', retailerId: id }); setMsg(`Revoked ${d.revoked} link(s).`); await load(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  const setAdStart = async (id: string, date: string) => {
    setBusy(true); setMsg('');
    try { await call({ action: 'set_ad_start', retailerId: id, date: date || null }); setMsg(date ? `Ad start date set to ${date}.` : 'Ad start date cleared.'); await load(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  // Needs-help actions. Each asks first where it removes or changes something.
  const act = async (payload: object, done: string) => {
    setBusy(true); setMsg('');
    try { const d = await call(payload); setMsg(done); if ((d as any).results) setMinted((d as any).results); await load(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  const resetShop = (r: Row) => {
    if (!window.confirm(`Reset the connection for ${r.name}?\n\nThis removes the account that connected, hands the Google permission back, and lets the shop use its link again. Its posts and review history with us are removed with the account. The shop's Google listing is not touched.`)) return;
    act({ action: 'reset_connection', retailerId: r.id }, `Connection reset for ${r.name}. Its link works again, unless it says "Not invited" below: then make a new one.`);
  };
  const newLink = async (r: Row) => {
    setBusy(true); setMsg('');
    try {
      // A link that is still valid has to be withdrawn before a new one is made.
      if (r.state === 'invited') await call({ action: 'revoke', retailerId: r.id });
      const d = await call({ action: 'invite', retailerIds: [r.id] });
      setMinted(d.results); await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  const editNote = (r: Row) => {
    const note = window.prompt(`Note for ${r.name} (who you spoke to, what was agreed). Leave empty to clear.`, r.note || '');
    if (note === null) return;
    act({ action: 'set_note', retailerId: r.id, note }, 'Note saved.');
  };
  const SEV: Record<number, [string, string]> = { 1: [C.red, C.redL], 2: [C.amber, C.amberL], 3: [C.mid, '#EEE'] };
  const waiting = (since: string | null) => { if (!since) return ''; const n = Math.floor((Date.now() - Date.parse(since)) / 86_400_000); return n <= 0 ? 'today' : n === 1 ? '1 day' : `${n} days`; };
  const helpRows = useMemo(() => rows.filter((r) => r.help?.needsHelp).sort((a, b) => a.help.severity - b.help.severity || (a.help.since || '9').localeCompare(b.help.since || '9')), [rows]);
  const [helpFilter, setHelpFilter] = useState('');
  const helpKinds = useMemo(() => { const m = new Map<string, number>(); for (const r of helpRows) m.set(r.help.label, (m.get(r.help.label) || 0) + 1); return Array.from(m.entries()); }, [helpRows]);

  // Ad spend, beside the ad start date. Admin and Tarkett only: never shown to the shop.
  const setAdSpend = (r: Row, spend: string) => act({ action: 'set_ad_spend', retailerId: r.id, spend }, spend ? `Ad spend for ${r.name} saved.` : `Ad spend for ${r.name} cleared.`);
  const setAdEnd = (r: Row, endDate: string) => act({ action: 'set_ad_spend', retailerId: r.id, spend: r.adSpendPence === null ? '' : String(r.adSpendPence / 100), endDate: endDate || null }, endDate ? `Ad end date for ${r.name} set to ${endDate}.` : `Ad end date for ${r.name} cleared.`);

  // Monthly statement: live shops by name, with the cap and credit worked out.
  const [stMonth, setStMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
  const [statement, setStatement] = useState<any>(null);
  const [stCsv, setStCsv] = useState('');
  const loadStatement = async () => {
    setBusy(true); setMsg('');
    try { const d = await call({ action: 'statement', month: stMonth }); setStatement(d.statement); setStCsv(d.csv); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  const downloadStatement = () => {
    const url = URL.createObjectURL(new Blob([stCsv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `stellar-live-shops-${statement.month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const money = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // What we have changed on one shop's listing, with an Undo for each.
  const [changesFor, setChangesFor] = useState<Row | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [changesNote, setChangesNote] = useState('');
  const openChanges = async (r: Row) => {
    setBusy(true); setMsg(''); setChangesNote('');
    try { const d = await call({ action: 'changes', retailerId: r.id }); setChanges(d.changes); setChangesNote(d.note || ''); setChangesFor(r); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  const undo = async (c: Change, evenIfChangedSince = false) => {
    if (!changesFor) return;
    if (!evenIfChangedSince && !window.confirm(`Undo this change for ${changesFor.name}?\n\n${c.what}\nNow: ${c.after}\nWill go back to: ${c.before}\n\nThis writes to the shop's live Google listing.`)) return;
    setBusy(true); setChangesNote('');
    try {
      const d = await call({ action: 'undo_change', retailerId: changesFor.id, changeId: c.id, evenIfChangedSince });
      setChangesNote(d.undo.message);
      if (!d.undo.ok && /changed again since/.test(d.undo.message) && window.confirm(`${d.undo.message}\n\nUndo it anyway? The later change will be lost.`)) { setBusy(false); return undo(c, true); }
      const again = await call({ action: 'changes', retailerId: changesFor.id }); setChanges(again.changes);
    } catch (e: any) { setChangesNote(e.message); }
    setBusy(false);
  };

  const openVoice = (r: Row) => { setVoiceFor(r); setVoiceDraft(draftFromVoice(r.voice)); setMsg(''); };

  const saveVoice = async () => {
    if (!voiceFor) return;
    setBusy(true); setMsg('');
    try {
      await call({ action: 'set_voice', retailerId: voiceFor.id, voice: voiceDraft });
      setMsg(`Voice saved for ${voiceFor.name}. It applies from the next post or reply that is written.`);
      setVoiceFor(null);
      await load();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  const copyReviewLink = async (r: Row) => {
    if (!r.review) return;
    try { await navigator.clipboard.writeText(r.review.link); setMsg(`Review link for ${r.name} copied: ${r.review.link}`); }
    catch { setMsg(`Review link for ${r.name}: ${r.review.link}`); }
  };

  const downloadCsv = () => {
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['shop,link,expires', ...minted.filter((m) => m.ok).map((m) => [esc(m.name || ''), esc(m.link || ''), esc((m.expiresAt || '').slice(0, 10))].join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `stellar-invite-links-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const visible = useMemo(() => rows.filter((r) =>
    (!stateFilter || r.state === stateFilter) &&
    (!filter || `${r.name} ${r.town ?? ''}`.toLowerCase().includes(filter.toLowerCase()))), [rows, filter, stateFilter]);

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 16 }}>
        <div style={{ width: '100%', maxWidth: 340, ...card }}>
          <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: '0.1em', marginBottom: 14 }}>PILOT ADMIN</div>
          <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} style={{ ...input, width: '100%', marginBottom: 10 }} />
          {msg && <div style={{ color: C.red, fontSize: 12, marginBottom: 8, fontFamily: sans }}>{msg}</div>}
          <button onClick={load} disabled={busy} style={{ ...btn, width: '100%' }}>{busy ? 'Loading…' : 'Enter'}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 16px', fontFamily: sans, color: C.text }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Stellar pilot</h1>
        <p style={{ color: C.mid, fontSize: 13, margin: '0 0 16px' }}>
          Links are generated here and never sent. Tarkett or the rep passes each one to the shop. See docs/rep-guide.md.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {Object.entries(STATE_LABEL).map(([k, [label, fg, bg]]) => (
            <button key={k} onClick={() => setStateFilter(stateFilter === k ? '' : k)} style={{ background: bg, color: fg, border: stateFilter === k ? `2px solid ${fg}` : '2px solid transparent', borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: sans }}>
              {label}: {counts[k] || 0}
            </button>
          ))}
        </div>

        {msg && <div style={{ ...card, padding: 12, fontSize: 13 }}>{msg}</div>}

        {minted.length > 0 && (
          <div style={{ ...card, border: `2px solid ${C.green}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>New links: copy them now. They cannot be shown again.</strong>
              <span style={{ display: 'flex', gap: 8 }}>
                <button onClick={downloadCsv} style={btn}>Download CSV</button>
                <button onClick={() => setMinted([])} style={{ ...btn, background: '#888' }}>Done</button>
              </span>
            </div>
            {minted.map((m) => (
              <div key={m.retailerId} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid #eee', wordBreak: 'break-all' }}>
                <strong>{m.name || m.retailerId}</strong>{' '}
                {m.ok
                  ? <><span style={{ fontFamily: mono }}>{m.link}</span> <span style={{ color: C.soft }}>(until {m.expiresAt?.slice(0, 10)})</span></>
                  : <span style={{ color: C.red }}>{m.error}</span>}
              </div>
            ))}
          </div>
        )}

        {changesFor && (
          <div style={{ ...card, border: `2px solid ${C.text}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <strong style={{ fontSize: 15 }}>What we have changed for {changesFor.name}</strong>
              <button onClick={() => setChangesFor(null)} style={{ ...btn, background: '#888' }}>Close</button>
            </div>
            <p style={{ color: C.mid, fontSize: 13, margin: '0 0 8px' }}>Newest first. Undo writes the earlier value back to the shop&apos;s live Google listing, checks Google has it, and is itself recorded. A customer&apos;s review can never be removed.</p>
            {changesNote && <div role="status" style={{ background: C.amberL, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 8 }}>{changesNote}</div>}
            {changes.length === 0 && !changesNote && <div style={{ color: C.mid, fontSize: 13 }}>Nothing has been changed on this listing.</div>}
            {changes.map((c) => (
              <div key={c.id} style={{ borderTop: '1px solid #e5e5e5', padding: '10px 0', fontSize: 13, display: 'grid', gap: 3 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{c.what}</strong>
                  <span style={{ color: C.soft }}>{new Date(c.when).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span style={{ color: C.soft }}>{c.source === 'revert' ? 'an undo' : c.source === 'onboarding' ? 'the shop chose this' : c.source}</span>
                  {c.undone && <span style={{ background: '#EEE', borderRadius: 6, padding: '1px 7px', fontWeight: 700 }}>Undone</span>}
                  {c.status === 'failed' && <span style={{ background: C.redL, color: C.red, borderRadius: 6, padding: '1px 7px', fontWeight: 700 }}>Did not go through</span>}
                </div>
                <div><span style={{ color: C.soft }}>Was:</span> {c.before}</div>
                <div><span style={{ color: C.soft }}>Became:</span> {c.after}</div>
                <div>{c.canUndo ? <button disabled={busy} onClick={() => undo(c)} style={{ ...btn, background: C.red, padding: '6px 12px' }}>Undo this</button> : <span style={{ color: C.mid }}>{c.whyNot}</span>}</div>
              </div>
            ))}
          </div>
        )}

        {photosFor && photosEnabled && (
          <div style={{ ...card, border: `2px solid ${C.text}` }}>
            <PhotoPanel shop={{ id: photosFor.id, name: photosFor.name }} password={password} onClose={() => setPhotosFor(null)} onChanged={load} />
          </div>
        )}

        {voiceFor && (
          <div style={{ ...card, border: `2px solid ${C.text}` }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>How {voiceFor.name} sounds</div>
            <p style={{ color: C.mid, fontSize: 12, margin: '0 0 12px' }}>
              Used when posts and 4 to 5 star review replies are written. All optional; leave everything empty to go back to the standard wording.
              It never changes the safety rules, and 1 to 3 star reviews always get the fixed holding reply.
              {voiceFor.voiceUpdatedAt ? ` Last changed ${voiceFor.voiceUpdatedAt.slice(0, 10)} by ${voiceFor.voiceUpdatedBy === 'shop' ? 'the shop' : 'a rep'}.` : ''}
            </p>
            <VoiceFields value={voiceDraft} onChange={setVoiceDraft} disabled={busy} accent={C.text}
              inputStyle={input} labelStyle={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }} hintStyle={{ fontSize: 11, color: C.soft, marginTop: 3 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={saveVoice} disabled={busy} style={btn}>Save voice</button>
              <button onClick={() => setVoiceFor(null)} disabled={busy} style={{ ...btn, background: '#888' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Needs help: every shop a person should look at, most urgent first, with what to do. */}
        <div style={{ ...card, border: helpRows.length ? `2px solid ${C.amber}` : undefined }} id="needs-help">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <strong style={{ fontSize: 16 }}>Needs help: {helpRows.length}</strong>
            <span style={{ color: C.mid, fontSize: 13 }}>Shops that are stuck, why, and what to do. Shops that are fine are not listed.</span>
          </div>
          {helpRows.length === 0 ? <div style={{ color: C.mid, fontSize: 14 }}>Nobody needs help right now.</div> : (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {helpKinds.map(([label, n]) => (
                  <button key={label} onClick={() => setHelpFilter(helpFilter === label ? '' : label)} style={{ background: helpFilter === label ? C.text : '#EEE', color: helpFilter === label ? '#fff' : C.text, border: 'none', borderRadius: 999, padding: '5px 11px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: sans }}>{label}: {n}</button>
                ))}
              </div>
              {helpRows.filter((r) => !helpFilter || r.help.label === helpFilter).map((r) => {
                const [fg, bg] = SEV[r.help.severity] || SEV[3];
                const b = (k: string) => r.help.buttons.includes(k);
                const small: React.CSSProperties = { ...btn, padding: '6px 10px', fontSize: 13 };
                return (
                  <div key={r.id} style={{ borderTop: '1px solid #e5e5e5', padding: '12px 0', display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{r.name}</strong><span style={{ color: C.mid, fontSize: 13 }}>{r.town || ''}</span>
                      <span style={{ background: bg, color: fg, borderRadius: 6, padding: '2px 8px', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{r.help.label}</span>
                      {r.help.since && <span style={{ color: C.soft, fontSize: 12 }}>waiting {waiting(r.help.since)}</span>}
                    </div>
                    <div style={{ fontSize: 14 }}>{r.help.why}</div>
                    <div style={{ fontSize: 14, color: C.mid }}><strong style={{ color: C.text }}>What to do:</strong> {r.help.action}</div>
                    {r.note && <div style={{ fontSize: 13, color: C.mid, fontStyle: 'italic' }}>Note: {r.note}</div>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {b('confirm_listing') && <button disabled={busy} onClick={() => act({ action: 'confirm_listing', retailerId: r.id }, `${r.name}: listing confirmed as the right one.`)} style={{ ...small, background: C.green }}>This is right</button>}
                      {b('new_link') && <button disabled={busy} onClick={() => newLink(r)} style={small}>New link</button>}
                      {b('reset') && <button disabled={busy} onClick={() => resetShop(r)} style={{ ...small, background: C.red }}>Reset connection</button>}
                      {b('bounced') && <button disabled={busy} onClick={() => act({ action: 'mark_bounced', retailerId: r.id, bounced: true }, `${r.name}: marked as not delivered.`)} style={{ ...small, background: '#777' }}>Email bounced</button>}
                      {b('not_bounced') && <button disabled={busy} onClick={() => act({ action: 'mark_bounced', retailerId: r.id, bounced: false }, `${r.name}: marked as delivered.`)} style={{ ...small, background: C.green }}>Delivered now</button>}
                      <button disabled={busy} onClick={() => editNote(r)} style={{ ...small, background: 'transparent', color: C.text, textDecoration: 'underline' }}>{r.note ? 'Edit note' : 'Add note'}</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Monthly statement: who was live, by name. A statement to check, not an invoice. */}
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>Live shops in a month</strong>
            <input type="month" value={stMonth} onChange={(e) => setStMonth(e.target.value)} style={{ ...input, padding: '6px 8px' }} aria-label="Month" />
            <button onClick={loadStatement} disabled={busy || !stMonth} style={btn}>Show</button>
            {statement && <button onClick={downloadStatement} style={{ ...btn, background: C.green }}>Download CSV</button>}
          </div>
          <p style={{ color: C.mid, fontSize: 12, margin: '6px 0 0' }}>A shop counts for a month if it was live on at least {statement?.settings?.minLiveDays ?? 1} day{(statement?.settings?.minLiveDays ?? 1) === 1 ? '' : 's'} in it. Live means connected, the right listing, verified by Google, and access not lost. Counting started when this was switched on; earlier months are empty.</p>
          {statement && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                <span><strong>{statement.liveShops}</strong> live</span>
                {statement.settings.capShops !== null && <span>cap <strong>{statement.settings.capShops}</strong> · <strong>{statement.shopsAboveCap}</strong> above it · <strong>{statement.billableShops}</strong> charged</span>}
                {statement.money ? <span>{money(statement.money.grossPence)}{statement.shopsAboveCap ? <> less credit {money(statement.money.creditPence)}</> : null} = <strong>{money(statement.money.totalPence)}</strong></span> : <span style={{ color: C.soft }}>No price is set (BILLING_PRICE_PENCE_PER_SHOP), so counts only.</span>}
              </div>
              {statement.lines.length === 0 ? <div style={{ color: C.mid }}>No shop was recorded as live in {statement.month}.</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: C.soft, fontSize: 11, textTransform: 'uppercase' }}><th style={{ padding: 4 }}>Shop</th><th style={{ padding: 4 }}>Town</th><th style={{ padding: 4 }}>Days live</th><th style={{ padding: 4 }}>First</th><th style={{ padding: 4 }}>Last</th><th style={{ padding: 4 }}></th></tr></thead>
                  <tbody>{statement.lines.map((l: any, i: number) => (
                    <tr key={i} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 4 }}>{l.name}</td><td style={{ padding: 4, color: C.mid }}>{l.town || ''}</td><td style={{ padding: 4 }}>{l.liveDays}</td><td style={{ padding: 4 }}>{l.firstLiveOn}</td><td style={{ padding: 4 }}>{l.lastLiveOn}</td><td style={{ padding: 4, color: C.amber, fontWeight: 600 }}>{l.aboveCap ? 'above cap: credited' : ''}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {statement.notCounted.length > 0 && <div style={{ color: C.mid, marginTop: 6 }}>Not counted (live too few days): {statement.notCounted.map((l: any) => l.name).join(', ')}</div>}
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add a shop Tarkett has given you</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input placeholder="Shop name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...input, flex: '2 1 200px' }} />
            <input placeholder="Town" value={form.town} onChange={(e) => setForm({ ...form, town: e.target.value })} style={{ ...input, flex: '1 1 120px' }} />
            <input placeholder="Contact email (optional)" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} style={{ ...input, flex: '2 1 200px' }} />
            <button onClick={add} disabled={busy || !form.name.trim()} style={btn}>Add</button>
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input placeholder="Search shop or town" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...input, flex: '1 1 200px' }} />
            <button onClick={invite} disabled={busy || !selected.size} style={btn}>Generate links for {selected.size} selected</button>
            <button onClick={() => { if (window.confirm(`Make a link for each of the ${withoutLink.length} shops that do not have one?\n\nNothing is sent. You get one list to download.`)) inviteIds(withoutLink.map((r) => r.id)); }} disabled={busy || !withoutLink.length} style={{ ...btn, background: C.green }}>Generate links for all {withoutLink.length} without one</button>
            <button onClick={load} disabled={busy} style={{ ...btn, background: '#888' }}>Refresh</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.soft, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: 6 }}></th><th style={{ padding: 6 }}>Shop</th><th style={{ padding: 6 }}>Town</th><th style={{ padding: 6 }}>Status</th><th style={{ padding: 6 }}>Detail</th><th style={{ padding: 6 }}>Google connection</th><th style={{ padding: 6 }} title="When Tarkett's ads for this shop started, when they stopped, and what was spent. The dates feed the shop's 'change during your ads' section. The spend is seen by you and Tarkett only: it is never sent to the shop.">Ads: started, ended, spend</th><th style={{ padding: 6 }} title="How this shop's posts and replies should sound. Answered by the shop at onboarding, or set here by a rep.">Voice</th><th style={{ padding: 6 }} title="The shop's Google review link, and a card with a QR code to print for the counter. The same link for every customer: nothing is sent and no customer details are involved.">Review link</th>{photosEnabled && <th style={{ padding: 6 }} title="Photos of the shop's work. Uploaded through a link, used on posts only after you approve them.">Photos</th>}<th style={{ padding: 6 }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const [label, fg, bg] = STATE_LABEL[r.state] || [r.state, C.mid, '#eee'];
                  const canInvite = r.state === 'not_invited' || r.state === 'invite_expired';
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: 6 }}>
                        <input type="checkbox" disabled={!canInvite} checked={selected.has(r.id)} onChange={(e) => {
                          const next = new Set(selected); e.target.checked ? next.add(r.id) : next.delete(r.id); setSelected(next);
                        }} />
                      </td>
                      <td style={{ padding: 6 }}>{r.name}{r.source === 'admin' && <span style={{ color: C.soft }}> (added)</span>}{r.delisted && <span style={{ color: C.red }}> (delisted)</span>}</td>
                      <td style={{ padding: 6, color: C.mid }}>{r.town || ''}</td>
                      <td style={{ padding: 6 }}><span style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span></td>
                      <td style={{ padding: 6, color: C.mid }}>{r.help && !r.help.live ? r.help.label : r.detail}{r.joinedAt ? `, joined ${r.joinedAt.slice(0, 10)}` : ''}</td>
                      <td style={{ padding: 6, color: C.mid }} title={r.connection?.nextStep || ''}>
                        {r.connection ? <><strong style={{ color: ['no_access', 'check_listing', 'waiting_google'].includes(r.connection.status) ? C.amber : C.text }}>{r.connection.label}</strong>{r.connection.detail ? <div style={{ fontSize: 12 }}>{r.connection.detail}</div> : null}</> : <span style={{ color: C.soft }}>&ndash;</span>}
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="date" aria-label={`Ads started for ${r.name}`} defaultValue={r.adStartDate ?? ''} disabled={busy} onBlur={(e) => { if ((e.target.value || null) !== r.adStartDate) setAdStart(r.id, e.target.value); }} style={{ ...input, padding: '4px 6px', fontSize: 12, display: 'block', marginBottom: 3 }} />
                        <input type="date" aria-label={`Ads ended for ${r.name}`} title="When the ads stopped (optional)" defaultValue={r.adEndDate ?? ''} disabled={busy || !r.adStartDate} onBlur={(e) => { if ((e.target.value || null) !== r.adEndDate) setAdEnd(r, e.target.value); }} style={{ ...input, padding: '4px 6px', fontSize: 12, display: 'block', marginBottom: 3 }} />
                        <input type="text" inputMode="decimal" aria-label={`Ad spend in pounds for ${r.name}`} placeholder="Spend £ (optional)" title="Total spent on ads for this shop, in pounds. Seen by you and Tarkett only." defaultValue={r.adSpendPence === null ? '' : String(r.adSpendPence / 100)} disabled={busy} onBlur={(e) => { const was = r.adSpendPence === null ? '' : String(r.adSpendPence / 100); if (e.target.value.trim() !== was) setAdSpend(r, e.target.value.trim()); }} style={{ ...input, padding: '4px 6px', fontSize: 12, width: 130, display: 'block' }} />
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        <button onClick={() => openVoice(r)} disabled={busy} style={{ ...btn, background: 'transparent', color: r.voice ? C.green : C.mid, padding: '2px 6px', textDecoration: 'underline' }}>{r.voice ? 'Set, edit' : 'Not set'}</button>
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {r.review ? (
                          <>
                            <button onClick={() => copyReviewLink(r)} title={r.review.link} style={{ ...btn, background: 'transparent', color: C.text, padding: '2px 6px', textDecoration: 'underline' }}>Copy link</button>
                            {r.review.cardPath && <a href={r.review.cardPath} target="_blank" rel="noreferrer" style={{ color: C.text, fontSize: 13, fontWeight: 600, padding: '2px 6px' }}>Card</a>}
                            {r.review.source === 'baseline' && <span title="This shop has not connected its listing yet, so the link uses the listing matched from Tarkett's store list. Scan the card and check it opens the right shop before printing." style={{ color: C.amber, fontSize: 12 }}> check first</span>}
                          </>
                        ) : <span style={{ color: C.soft }} title="No Google place ID on record for this shop yet. It appears once the shop connects its listing.">No listing yet</span>}
                      </td>
                      {photosEnabled && (
                        <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                          <button onClick={() => setPhotosFor(r)} style={{ ...btn, background: 'transparent', color: r.photos?.pending ? C.amber : C.mid, padding: '2px 6px', textDecoration: 'underline' }}>
                            {r.photos ? `${r.photos.approved} approved${r.photos.pending ? `, ${r.photos.pending} to check` : ''}` : 'None'}
                          </button>
                        </td>
                      )}
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{r.state === 'invited' && <button onClick={() => revoke(r.id)} disabled={busy} style={{ ...btn, background: 'transparent', color: C.red, padding: '2px 6px' }}>Revoke</button>}{(r.state === 'live' || r.state === 'connected_not_live') && <button onClick={() => openChanges(r)} disabled={busy} title="What we have changed on this shop's listing, with an Undo for each" style={{ ...btn, background: 'transparent', color: C.text, padding: '2px 6px', textDecoration: 'underline' }}>Changes</button>}<label title="Leave this shop out of the monthly count of live shops (a test or internal shop)" style={{ fontSize: 12, color: C.mid, display: 'block', whiteSpace: 'nowrap' }}><input type="checkbox" checked={r.excludedFromCount} disabled={busy} onChange={(e) => act({ action: 'set_excluded', retailerId: r.id, excluded: e.target.checked }, e.target.checked ? `${r.name} will be left out of the monthly count.` : `${r.name} will be counted.`)} /> not counted</label>{(r.state === 'live' || r.state === 'connected_not_live') && <button onClick={() => resetShop(r)} disabled={busy} title="Remove the connected account and let the shop start again with its link" style={{ ...btn, background: 'transparent', color: C.red, padding: '2px 6px' }}>Reset</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
