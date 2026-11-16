import { describe, it, expect } from 'vitest';
import { startBudget, rotateForRun, runIndex, selectAll, CRON_BUDGET_MS } from './cron-budget';

describe('startBudget', () => {
  it('is spent once the time is up, and not before', () => {
    let t = 1_000;
    const b = startBudget(5_000, () => t);
    expect(b.exhausted()).toBe(false);
    t += 4_999; expect(b.exhausted()).toBe(false);
    t += 1; expect(b.exhausted()).toBe(true);
    expect(b.spentMs()).toBe(5_000);
  });
  it('defaults to under the 25 seconds the scheduler waits', () => {
    expect(CRON_BUDGET_MS).toBeLessThan(25_000);
  });
});

describe('rotateForRun', () => {
  const shops = ['d', 'a', 'c', 'b', 'e'].map((id) => ({ id }));
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).join('');

  it('sorts by id, then starts further along each run', () => {
    expect(ids(rotateForRun(shops, 0, 2))).toBe('abcde');
    expect(ids(rotateForRun(shops, 1, 2))).toBe('cdeab');
    expect(ids(rotateForRun(shops, 2, 2))).toBe('eabcd');
    expect(ids(rotateForRun(shops, 3, 2))).toBe('bcdea');
  });
  it('always returns every shop exactly once', () => {
    for (let run = 0; run < 50; run++) expect(ids(rotateForRun(shops, run, 7)).split('').sort().join('')).toBe('abcde');
  });
  it('successive runs that each reach `stride` shops cover the whole list', () => {
    const many = Array.from({ length: 180 }, (_, i) => ({ id: `shop-${String(i).padStart(3, '0')}` }));
    const reached = new Set<string>();
    for (let run = 1000; run < 1000 + 15; run++) rotateForRun(many, run, 12).slice(0, 12).forEach((s) => reached.add(s.id));
    expect(reached.size).toBe(180);
  });
  it('copes with an empty list, one shop, and odd inputs', () => {
    expect(rotateForRun([], 5, 3)).toEqual([]);
    expect(ids(rotateForRun([{ id: 'x' }], 5, 3))).toBe('x');
    expect(ids(rotateForRun(shops, -3, 2))).toHaveLength(5);
    expect(ids(rotateForRun(shops, 4, 0))).toHaveLength(5);
  });
  it('does not change the list it was given', () => {
    const before = ids(shops);
    rotateForRun(shops, 3, 2);
    expect(ids(shops)).toBe(before);
  });
});

describe('runIndex', () => {
  it('goes up by one each interval', () => {
    const at = (iso: string) => new Date(iso);
    expect(runIndex(30, at('2026-11-16T09:30:00Z')) - runIndex(30, at('2026-11-16T09:00:00Z'))).toBe(1);
    expect(runIndex(30, at('2026-11-16T09:29:59Z'))).toBe(runIndex(30, at('2026-11-16T09:00:00Z')));
    expect(runIndex(5, at('2026-11-16T09:05:00Z')) - runIndex(5, at('2026-11-16T09:00:00Z'))).toBe(1);
  });
});

describe('selectAll', () => {
  it('keeps asking until a page comes back empty, so nothing past 1,000 rows is lost', async () => {
    const all = Array.from({ length: 2_350 }, (_, i) => i);
    const asked: Array<[number, number]> = [];
    const got = await selectAll<number>(async (from, to) => { asked.push([from, to]); return { data: all.slice(from, to + 1), error: null }; });
    expect(got).toEqual(all);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999], [2350, 3349]]);
  });
  it('still gets everything when the server gives fewer rows per page than were asked for', async () => {
    const all = Array.from({ length: 1_200 }, (_, i) => i);
    const serverLimit = 500;
    const got = await selectAll<number>(async (from, to) => ({ data: all.slice(from, Math.min(to + 1, from + serverLimit)), error: null }));
    expect(got).toEqual(all); // a "short" first page of 500 used to be taken for the end
  });
  it('throws on an error rather than returning half, and cannot loop for ever', async () => {
    await expect(selectAll(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom');
    const endless = await selectAll<number>(async () => ({ data: [1, 2, 3], error: null }), 3, 30);
    expect(endless).toHaveLength(30);
  });
});
