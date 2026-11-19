'use client';

import { useState } from 'react';

/**
 * Review requests for one shop, for an operator in /admin/pilot
 * (lib/review-requests.ts). Choose the shop's CSV, see the dry run (who gets
 * it, who does not and why, and the exact email), then type the count to send.
 * Sending is refused by the server unless REVIEW_REQUESTS=on.
 *
 * The file is read in the browser and posted as text. It is never stored: the
 * dry run and the send each post it again.
 */
const C = { text: '#1A1A1A', mid: '#555', soft: '#999', green: '#2D7A4F', amber: '#B8860B', red: '#D93025', bg: '#F0EDE8' };
const btn: React.CSSProperties = { background: C.text, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

type DryRun = {
  enabled: boolean; willSend: number; excludedCount: number; headerFound: boolean; confirmWith: number;
  limits: { perBatch: number; perShopPerDay: number; platformPerDay: number; shopLeftToday: number; platformLeftToday: number };
  rows: Array<{ row: number; email: string; firstName: string | null; firstNameDropped: boolean; send: boolean; reason: string | null }>;
  sample: { to: string; from: string; replyTo: string; subject: string; text: string } | null;
};
type Result = { sent: number; failed: Array<{ row: number; email: string }>; skipped: Array<{ row: number; email: string; reason: string }>; notReached: Array<{ row: number; email: string }> };

export default function ReviewRequestPanel({ shop, password, onClose }: { shop: { id: string; name: string }; password: string; onClose: () => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [dry, setDry] = useState<DryRun | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (payload: object) => {
    const res = await fetch('/api/admin/review-requests', { method: 'POST', headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
    return data;
  };

  const pick = async (f: File | undefined) => {
    setDry(null); setResult(null); setTyped(''); setMsg('');
    if (!f) return;
    setFileName(f.name); setCsv(await f.text());
  };
  const dryRun = async () => {
    setBusy(true); setMsg(''); setResult(null); setTyped('');
    try { setDry(await call({ action: 'dry_run', retailerId: shop.id, csv })); } catch (e: any) { setDry(null); setMsg(e.message); }
    setBusy(false);
  };
  const send = async () => {
    setBusy(true); setMsg('');
    try { const d = await call({ action: 'send', retailerId: shop.id, csv, confirmCount: typed }); setResult(d.result); setDry(null); setTyped(''); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 15 }}>Ask {shop.name}&apos;s customers for a review</strong>
        <button onClick={onClose} style={{ ...btn, background: 'transparent', color: C.mid }}>Close</button>
      </div>
      <p style={{ color: C.mid, margin: '0 0 8px' }}>A CSV from the shop of its own customers: a column of email addresses, and optionally first names. A header row is optional. Nothing is sent until you have seen the dry run and typed the number to send.</p>
      <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
      <button onClick={dryRun} disabled={busy || !csv} style={{ ...btn, marginLeft: 8 }}>Dry run</button>
      {fileName && <span style={{ color: C.soft, marginLeft: 8 }}>{fileName}</span>}
      {msg && <p style={{ color: C.red, margin: '8px 0 0' }}>{msg}</p>}

      {dry && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 6px' }}><strong>Dry run: nothing has been sent.</strong> {dry.willSend} would be sent, {dry.excludedCount} left out. {dry.headerFound ? 'Header row recognised.' : 'No header row.'}</p>
          <p style={{ margin: '0 0 6px', color: C.mid }}>Limits: {dry.limits.perBatch} per send, {dry.limits.perShopPerDay} per shop and {dry.limits.platformPerDay} for all shops in 24 hours. After this send: {dry.limits.shopLeftToday} left for this shop, {dry.limits.platformLeftToday} for all shops.</p>
          {dry.sample && (
            <div style={{ background: C.bg, borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div><span style={{ color: C.soft }}>From:</span> {dry.sample.from}</div>
              <div><span style={{ color: C.soft }}>Reply-To:</span> {dry.sample.replyTo}</div>
              <div><span style={{ color: C.soft }}>To (first of {dry.willSend}):</span> {dry.sample.to}</div>
              <div><span style={{ color: C.soft }}>Subject:</span> {dry.sample.subject}</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '8px 0 0' }}>{dry.sample.text}</pre>
            </div>
          )}
          <div style={{ maxHeight: 260, overflow: 'auto', border: `1px solid ${C.bg}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', color: C.soft }}><th style={{ padding: 4 }}>Row</th><th style={{ padding: 4 }}>Address</th><th style={{ padding: 4 }}>Name</th><th style={{ padding: 4 }}>Outcome</th></tr></thead>
              <tbody>
                {dry.rows.map((r) => (
                  <tr key={r.row} style={{ borderTop: `1px solid ${C.bg}` }}>
                    <td style={{ padding: 4, color: C.soft }}>{r.row}</td>
                    <td style={{ padding: 4 }}>{r.email || <em style={{ color: C.soft }}>(empty)</em>}</td>
                    <td style={{ padding: 4 }}>{r.firstName ?? (r.firstNameDropped ? <span style={{ color: C.amber }}>not used</span> : '')}</td>
                    <td style={{ padding: 4, color: r.send ? C.green : C.red }}>{r.send ? 'Would be sent' : r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dry.willSend > 0 && (dry.enabled ? (
            <div style={{ marginTop: 10 }}>
              <label>To send {dry.willSend} email{dry.willSend === 1 ? '' : 's'} now, type <strong>{dry.confirmWith}</strong>: </label>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" style={{ width: 70, padding: '6px 8px', border: `1px solid ${C.soft}`, borderRadius: 6 }} />
              <button onClick={send} disabled={busy || typed.trim() !== String(dry.confirmWith)} style={{ ...btn, background: C.red, marginLeft: 8 }}>Send {dry.willSend}</button>
            </div>
          ) : <p style={{ marginTop: 10, color: C.amber }}>Review requests are switched off (REVIEW_REQUESTS). This is as far as it goes: nothing can be sent.</p>)}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 4px' }}><strong>{result.sent} sent.</strong>{result.failed.length ? ` ${result.failed.length} could not be sent (they can be tried again).` : ''}{result.skipped.length ? ` ${result.skipped.length} skipped at the last moment (unsubscribed or already asked).` : ''}{result.notReached.length ? ` ${result.notReached.length} not reached in time: run the dry run again and send the rest.` : ''}</p>
          {[...result.failed.map((f) => `Row ${f.row}: ${f.email}: not sent`), ...result.skipped.map((s) => `Row ${s.row}: ${s.email}: ${s.reason}`), ...result.notReached.map((n) => `Row ${n.row}: ${n.email}: not reached`)].map((l) => <div key={l} style={{ color: C.mid }}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
