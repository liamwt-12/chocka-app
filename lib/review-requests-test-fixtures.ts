/**
 * Test helpers for review requests: an in-memory stand-in for the three
 * tables and a stub mailer. Used only by the lib/review-requests*.test.ts
 * files. Nothing here reaches Supabase or Resend.
 */
import { vi } from 'vitest';
import type { RequestStore, Composed, SuppressionSource } from './review-requests-data';

export type MemoryStore = RequestStore & {
  suppressed: Set<string>;
  /** How each hash came onto the list, in the order added. A second add of the same hash adds nothing. */
  suppressions: Array<{ email_hash: string; source: SuppressionSource }>;
  history: Map<string, string>;
  rows: Array<{ retailer_id: string; email_hash: string; status: string; created_at: string; batch_id: string }>;
  /** Every store call, in order, with the hash it was for. */
  log: string[];
};

export function memoryStore(init: { suppressed?: string[]; history?: Array<[string, string, string]>; sent?: Array<{ retailer_id: string; created_at: string }> } = {}): MemoryStore {
  const suppressed = new Set(init.suppressed || []);
  const suppressions: MemoryStore['suppressions'] = [];
  const history = new Map<string, string>((init.history || []).map(([r, h, at]) => [`${r}|${h}`, at]));
  const rows: MemoryStore['rows'] = (init.sent || []).map((s) => ({ ...s, email_hash: 'x', status: 'sent', batch_id: 'b' }));
  const log: string[] = [];
  return {
    suppressed, suppressions, history, rows, log,
    async suppressedAmong(hs) { log.push('suppressedAmong'); return new Set(hs.filter((h) => suppressed.has(h))); },
    async isSuppressed(h) { log.push(`isSuppressed:${h}`); return suppressed.has(h); },
    async suppress(h, source) { log.push(`suppress:${h}`); if (!suppressed.has(h)) { suppressed.add(h); suppressions.push({ email_hash: h, source }); } return true; },
    async askedBefore(r, hs, since) { const m = new Map<string, string>(); for (const h of hs) { const at = history.get(`${r}|${h}`); if (at && at >= since) m.set(h, at); } return m; },
    async sentSince(r, since) { return rows.filter((x) => x.status === 'sent' && x.created_at >= since && (!r || x.retailer_id === r)).length; },
    async claim(r, _t, h, at, since) { log.push(`claim:${h}`); const k = `${r}|${h}`; const was = history.get(k); if (was && was >= since) return false; history.set(k, at); return true; },
    async release(r, h, at) { log.push(`release:${h}`); if (history.get(`${r}|${h}`) === at) history.delete(`${r}|${h}`); },
    async record(row) { rows.push(row); },
  };
}

/** A mailer that records what it was given and sends nothing. `ok` decides whether each "send" succeeds. */
export function stubMailer(ok: (e: Composed) => boolean = () => true, log?: string[]) {
  const sent: Composed[] = [];
  return { sent, send: vi.fn(async (e: Composed) => { log?.push(`send:${e.to}`); sent.push(e); return ok(e); }) };
}
