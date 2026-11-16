import { describe, it, expect } from 'vitest';
import { reportMonthKey, alreadyReported, claimMonthlyReport, releaseMonthlyReport, inChunks } from './monthly-report';

describe('reportMonthKey and alreadyReported', () => {
  it('takes the month from the first day of the month being reported', () => {
    expect(reportMonthKey('2026-10-01')).toBe('2026-10');
    expect(reportMonthKey('2027-01-01')).toBe('2027-01');
    expect(() => reportMonthKey('October')).toThrow();
  });
  it('a shop is done only if its marker is exactly this month', () => {
    expect(alreadyReported({ monthly_report_sent_for: '2026-10' }, '2026-10')).toBe(true);
    expect(alreadyReported({ monthly_report_sent_for: '2026-09' }, '2026-10')).toBe(false);
    expect(alreadyReported({ monthly_report_sent_for: null }, '2026-10')).toBe(false);
    expect(alreadyReported({}, '2026-10')).toBe(false);
    expect(alreadyReported(null, '2026-10')).toBe(false);
  });
});

/** A one-row profiles table that applies the claim's condition the way the database would. */
function table(initial: string | null, opts: { fail?: boolean } = {}) {
  const row = { id: 'p1', monthly_report_sent_for: initial };
  const calls: string[] = [];
  const db = {
    row, calls,
    from: () => ({
      update: (patch: any) => {
        const conds: Array<(r: any) => boolean> = [];
        const q: any = {
          eq: (c: string, v: any) => { conds.push((r) => r[c] === v); return q; },
          or: (expr: string) => { calls.push(expr); conds.push((r) => r.monthly_report_sent_for === null || r.monthly_report_sent_for !== expr.split('neq.')[1]); return q; },
          select: async () => run(),
          then: (res: any) => res(run()),
        };
        const run = () => {
          if (opts.fail) return { data: null, error: { message: 'column profiles.monthly_report_sent_for does not exist' } };
          if (!conds.every((c) => c(row))) return { data: [], error: null };
          Object.assign(row, patch);
          return { data: [{ id: row.id }], error: null };
        };
        return q;
      },
    }),
  };
  return db;
}

describe('claimMonthlyReport', () => {
  it('marks a shop that has had no report, and says what was there before', async () => {
    const db = table(null);
    expect(await claimMonthlyReport(db, { id: 'p1', monthly_report_sent_for: null }, '2026-10')).toEqual({ ok: true, previous: null });
    expect(db.row.monthly_report_sent_for).toBe('2026-10');
    expect(db.calls[0]).toBe('monthly_report_sent_for.is.null,monthly_report_sent_for.neq.2026-10');
  });
  it('marks a shop whose last report was an earlier month', async () => {
    const db = table('2026-09');
    expect(await claimMonthlyReport(db, { id: 'p1', monthly_report_sent_for: '2026-09' }, '2026-10')).toEqual({ ok: true, previous: '2026-09' });
  });
  it('remembers what was there before even when handed the very row it changes', async () => {
    const db = table('2026-09');
    const claim = await claimMonthlyReport(db, db.row, '2026-10'); // the same object the database updates
    expect(claim).toEqual({ ok: true, previous: '2026-09' });
  });
  it('only one of two overlapping runs gets the claim', async () => {
    const db = table(null);
    const stale = { id: 'p1', monthly_report_sent_for: null }; // both runs read the row before either wrote
    const first = await claimMonthlyReport(db, stale, '2026-10');
    const second = await claimMonthlyReport(db, stale, '2026-10');
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'already-claimed' });
  });
  it('reports an error, and does not throw, when the marker cannot be written', async () => {
    const r = await claimMonthlyReport(table(null, { fail: true }), { id: 'p1' }, '2026-10');
    expect(r).toMatchObject({ ok: false, reason: 'error' });
    expect(await claimMonthlyReport({ from: () => { throw new Error('down'); } }, { id: 'p1' }, '2026-10')).toMatchObject({ ok: false, reason: 'error', detail: 'down' });
  });
});

describe('releaseMonthlyReport', () => {
  it('puts back what was there, so the next run tries again', async () => {
    const db = table('2026-10');
    expect(await releaseMonthlyReport(db, 'p1', '2026-10', '2026-09')).toBe(true);
    expect(db.row.monthly_report_sent_for).toBe('2026-09');
  });
  it('does not touch a marker that is no longer this month\'s', async () => {
    const db = table('2026-11');
    await releaseMonthlyReport(db, 'p1', '2026-10', null);
    expect(db.row.monthly_report_sent_for).toBe('2026-11');
  });
  it('returns false, and does not throw, if it cannot', async () => {
    expect(await releaseMonthlyReport({ from: () => { throw new Error('down'); } }, 'p1', '2026-10', null)).toBe(false);
  });
});

describe('inChunks', () => {
  it('never runs more than the chunk size at once, and keeps the order', async () => {
    let running = 0, most = 0;
    const out = await inChunks(Array.from({ length: 25 }, (_, i) => i), 10, async (i) => {
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return i * 2;
    });
    expect(most).toBe(10);
    expect(out).toEqual(Array.from({ length: 25 }, (_, i) => i * 2));
    expect(await inChunks([], 10, async (x) => x)).toEqual([]);
  });
});

describe('the migration', () => {
  it('adds the column the code writes, with a format check that accepts what the code writes', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/migrations/20261116120000_profile_monthly_report_marker.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/alter table public\.profiles add column if not exists monthly_report_sent_for text;/);
    const pattern = /monthly_report_sent_for ~ '([^']+)'/.exec(sql)![1];
    const re = new RegExp(pattern);
    for (const ok of ['2026-10', '2027-01', '2026-12']) expect(re.test(ok)).toBe(true);
    for (const bad of ['2026-13', '2026-00', '26-10', '2026-1', 'October']) expect(re.test(bad)).toBe(false);
    expect(re.test(reportMonthKey('2026-10-01'))).toBe(true);
  });
});
