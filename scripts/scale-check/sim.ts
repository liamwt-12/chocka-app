/**
 * A simulated world for the scale check: an in-memory database, a virtual
 * clock, and counters. NOTHING here touches a real database or the network.
 *
 * THE VIRTUAL CLOCK. Every database query and every outside call "takes" a
 * fixed, stated amount of time (LATENCY below) without anybody actually
 * waiting. Calls started together finish together, as they would in real life,
 * so code that does five things at once is not charged for doing them one
 * after another. The clock also drives Date.now(), so a job that watches its
 * own time budget sees time passing.
 */
import { vi } from 'vitest';

/** Assumed time for one call of each kind, in milliseconds. Stated in the report. */
export const LATENCY = {
  db: 45,            // one database round trip, function and database in the SAME region
  googleToken: 250,  // exchanging the stored credential for an access token
  googleRead: 300,   // one Business Profile read
  googleWrite: 450,  // publishing a post or a reply
  googleMetrics: 600,// one performance-figures request
  model: 3000,       // one short piece of writing from the AI model
  email: 250,
  sms: 350,
};
export type Kind = keyof typeof LATENCY;

export class Clock {
  now = 0;
  private queue: Array<{ t: number; seq: number; resolve: () => void }> = [];
  private scheduled = false;
  private seq = 0;
  constructor(public base: number) {}
  /** dbScale lets the report show what a cross-Atlantic database round trip does. */
  dbScale = 1;
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ t: this.now + ms, seq: this.seq++, resolve });
      if (!this.scheduled) { this.scheduled = true; setImmediate(() => this.pump()); }
    });
  }
  private pump() {
    this.scheduled = false;
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const next = this.queue.shift()!;
    this.now = next.t;
    vi.setSystemTime(this.base + this.now);
    next.resolve();
    if (this.queue.length && !this.scheduled) { this.scheduled = true; setImmediate(() => this.pump()); }
  }
}

export interface Counters { calls: Record<Kind, number>; dbByTable: Record<string, number>; dbRowsReturnedMax: number; unbounded: Record<string, number> }
export const newCounters = (): Counters => ({
  calls: { db: 0, googleToken: 0, googleRead: 0, googleWrite: 0, googleMetrics: 0, model: 0, email: 0, sms: 0 },
  dbByTable: {}, dbRowsReturnedMax: 0, unbounded: {},
});

export interface Sim { clock: Clock; count: Counters; tables: Record<string, any[]>; idSeq: number; index?: Map<string, { size: number; by: Map<any, any[]> }> }

/** Columns worth indexing: every per-shop query filters on one of these. Purely to keep the simulation quick. */
const INDEXED = new Set(['profile_id', 'user_id', 'retailer_id', 'review_id', 'id']);

/** PostgREST returns at most this many rows unless the caller pages. Supabase's default. */
export const MAX_ROWS = 1000;

type Pred = (row: any) => boolean;

/**
 * Enough of the Supabase query builder for the scheduled jobs: filters, order,
 * limit, single, count, insert, update, upsert, delete, and the three embedded
 * shapes those jobs select.
 */
class Query {
  private preds: Pred[] = [];
  private key: { col: string; value: any } | null = null;
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any;
  private wantCount = false; private head = false;
  private lim: number | null = null; private rangeFrom: number | null = null;
  private orderBy: Array<{ col: string; asc: boolean }> = [];
  private one: 'single' | 'maybe' | null = null;
  private returning = false;
  private conflict: string[] | null = null;
  constructor(private sim: Sim, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (this.op !== 'select') this.returning = true; if (opts?.count) this.wantCount = true; if (opts?.head) this.head = true; return this; }
  insert(rows: any) { this.op = 'insert'; this.payload = rows; return this; }
  update(patch: any) { this.op = 'update'; this.payload = patch; return this; }
  upsert(rows: any, opts?: { onConflict?: string }) { this.op = 'upsert'; this.payload = rows; this.conflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null; return this; }
  delete() { this.op = 'delete'; return this; }

  private on(col: string, test: (v: any) => boolean) { if (!col.includes('.')) this.preds.push((r) => test(r[col])); return this; } // filters on embedded columns are not modelled
  eq(c: string, v: any) { if (!this.key && INDEXED.has(c)) this.key = { col: c, value: v }; return this.on(c, (x) => x === v); }
  neq(c: string, v: any) { return this.on(c, (x) => x !== v); }
  in(c: string, vs: any[]) { const s = new Set(vs); return this.on(c, (x) => s.has(x)); }
  is(c: string, v: any) { return this.on(c, (x) => (v === null ? x === null || x === undefined : x === v)); }
  gte(c: string, v: any) { return this.on(c, (x) => x !== null && x !== undefined && x >= v); }
  lte(c: string, v: any) { return this.on(c, (x) => x !== null && x !== undefined && x <= v); }
  gt(c: string, v: any) { return this.on(c, (x) => x !== null && x !== undefined && x > v); }
  lt(c: string, v: any) { return this.on(c, (x) => x !== null && x !== undefined && x < v); }
  like(c: string, pattern: string) { const re = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); return this.on(c, (x) => typeof x === 'string' && re.test(x)); }
  ilike(c: string, v: string) { return this.on(c, (x) => typeof x === 'string' && x.toLowerCase() === v.toLowerCase()); }
  not(c: string, _op: string, v: any) { return this.on(c, (x) => (v === null ? x !== null && x !== undefined : x !== v)); }
  /** `a.eq.x,b.is.null,c.neq.y,d.not.is.null,e.lt.now()`: any one of them. Enough for the filters the jobs use. */
  or(expr: string) {
    const tests = expr.split(',').map((part): Pred => {
      const [col, ...rest] = part.trim().split('.');
      const op = rest.join('.');
      if (op === 'is.null') return (r) => r[col] === null || r[col] === undefined;
      if (op === 'not.is.null') return (r) => r[col] !== null && r[col] !== undefined;
      if (op === 'lt.now()') return (r) => r[col] !== null && r[col] !== undefined && Date.parse(r[col]) < Date.now();
      if (op.startsWith('eq.')) return (r) => String(r[col]) === op.slice(3);
      if (op.startsWith('neq.')) return (r) => r[col] !== null && r[col] !== undefined && String(r[col]) !== op.slice(4);
      return () => true;
    });
    this.preds.push((r) => tests.some((t) => t(r)));
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.orderBy.push({ col, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.lim = to - from + 1; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }

  private embed(row: any): any {
    const t = this.sim.tables;
    const user = (u: any) => (u ? { ...u, tenants: { slug: 'stellar' }, manager: null, profiles: (t.profiles || []).filter((p) => p.user_id === u.id) } : null);
    if (this.table === 'users') return user(row);
    if (this.table === 'scheduled_posts') {
      const p = (t.profiles || []).find((x) => x.id === row.profile_id);
      return { ...row, profiles: p ? { ...p, users: user((t.users || []).find((u) => u.id === p.user_id)) } : null };
    }
    if (this.table === 'review_replies') return { ...row, reviews: (t.reviews || []).find((x) => x.id === row.review_id) ?? null };
    return row;
  }

  private run(): any {
    const sim = this.sim;
    const rows = (sim.tables[this.table] ||= []);
    const match = (r: any) => this.preds.every((p) => p(r));
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const out: any[] = [];
      for (const item of list) {
        const existing = this.op === 'upsert' && this.conflict ? rows.find((r) => this.conflict!.every((c) => r[c] === item[c])) : null;
        if (existing) { Object.assign(existing, item); out.push(existing); }
        else { const row = { id: item.id ?? `${this.table}-${++sim.idSeq}`, created_at: new Date().toISOString(), ...item }; rows.push(row); out.push(row); }
      }
      return this.finish(out, out.length);
    }
    if (this.op === 'update') { const hit = rows.filter(match); for (const r of hit) Object.assign(r, this.payload); return this.finish(hit, hit.length); }
    if (this.op === 'delete') { const hit = rows.filter(match); sim.tables[this.table] = rows.filter((r) => !match(r)); return this.finish(hit, hit.length); }

    let hit = this.candidates(rows).filter(match);
    const total = hit.length;
    for (const o of [...this.orderBy].reverse()) hit = [...hit].sort((a, b) => (a[o.col] === b[o.col] ? 0 : (a[o.col] > b[o.col] ? 1 : -1) * (o.asc ? 1 : -1)));
    if (this.rangeFrom !== null) hit = hit.slice(this.rangeFrom);
    // A query with no limit can come back cut off at 1,000 rows without any error. Count how often that could bite.
    if (this.lim === null && !this.one && !this.head && total > MAX_ROWS) sim.count.unbounded[this.table] = (sim.count.unbounded[this.table] || 0) + 1;
    hit = hit.slice(0, Math.min(this.lim ?? MAX_ROWS, MAX_ROWS));
    return this.finish(this.head ? [] : hit.map((r) => this.embed(r)), total);
  }

  /** The rows that could match: all of them, or just one shop's when the query names a shop. */
  private candidates(rows: any[]): any[] {
    if (!this.key || rows.length < 2000) return rows;
    const sim = this.sim;
    sim.index ||= new Map();
    const name = `${this.table}.${this.key.col}`;
    let idx = sim.index.get(name);
    if (!idx || idx.size !== rows.length) {
      const by = new Map<any, any[]>();
      for (const r of rows) { const k = r[this.key.col]; const list = by.get(k); if (list) list.push(r); else by.set(k, [r]); }
      idx = { size: rows.length, by };
      sim.index.set(name, idx);
    }
    return idx.by.get(this.key.value) || [];
  }

  private finish(rows: any[], total: number) {
    this.sim.count.dbRowsReturnedMax = Math.max(this.sim.count.dbRowsReturnedMax, rows.length);
    const count = this.wantCount ? total : null;
    if (this.one) {
      if (rows.length === 0) return { data: null, error: this.one === 'single' ? { message: 'no rows', code: 'PGRST116' } : null, count };
      return { data: rows[0], error: null, count };
    }
    if (this.op !== 'select' && !this.returning) return { data: null, error: null, count };
    return { data: rows, error: null, count };
  }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    const c = this.sim.count;
    c.calls.db++; c.dbByTable[this.table] = (c.dbByTable[this.table] || 0) + 1;
    return this.sim.clock.wait(LATENCY.db * this.sim.clock.dbScale).then(() => this.run()).then(resolve, reject);
  }
}

export function fakeDb(sim: Sim) {
  return {
    from: (table: string) => new Query(sim, table),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'not simulated' } }), list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) },
  };
}

/** Which kind of outside call a request is, for the clock and the counters. Null means "not allowed". */
export function classify(url: string, method: string): Kind | null {
  const host = new URL(url).host;
  if (host === 'oauth2.googleapis.com') return 'googleToken';
  if (host === 'businessprofileperformance.googleapis.com') return 'googleMetrics';
  if (host.endsWith('googleapis.com')) return method === 'GET' ? 'googleRead' : 'googleWrite';
  if (host === 'api.anthropic.com') return 'model';
  if (host === 'api.resend.com') return 'email';
  if (host === 'api.twilio.com') return 'sms';
  return null;
}
