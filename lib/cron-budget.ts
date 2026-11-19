/**
 * Time budgets for the scheduled jobs.
 *
 * WHY. Each job works through the shops one at a time, and each shop costs
 * real time: a second or so for Google, three for a piece of writing from the
 * model. Netlify stops a function after 60 seconds, and our own scheduler
 * (netlify/shared/run-cron.mts) stops waiting after 25. Measured in
 * scripts/scale-check: the weekly post job gets through about 17 shops in 60
 * seconds, so with 180 shops, 163 of them would simply never get a post, with
 * no error anywhere, and always the same 163.
 *
 * WHAT THIS DOES. A job stops cleanly when its budget is spent, between shops,
 * and says how many it left. The jobs that can tell what they have already
 * done are scheduled to run again a few minutes later and carry on from there.
 *
 * What it does NOT do is make any single run faster. See docs/scale-check.md
 * for what a proper fix looks like (background functions).
 */

/** Stop starting new work after this long. The scheduler gives up waiting at 25 seconds. */
export const CRON_BUDGET_MS = 20_000;

export interface Budget { spentMs(): number; exhausted(): boolean }

export function startBudget(ms: number = CRON_BUDGET_MS, now: () => number = Date.now): Budget {
  const started = now();
  return { spentMs: () => now() - started, exhausted: () => now() - started >= ms };
}

/**
 * The same list, starting from a different place each run, so that when a run
 * cannot reach everyone it is not always the same shops at the back.
 *
 * Sorted by id first (the database gives no promised order), then rotated by
 * `runIndex * stride`. With one run an hour and a stride no bigger than what a
 * run can get through, successive runs cover the whole list.
 */
export function rotateForRun<T extends { id: string }>(items: T[], runIndex: number, stride: number): T[] {
  if (items.length < 2) return items.slice();
  const sorted = items.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = sorted.length;
  const start = (((Math.floor(runIndex) * Math.max(1, Math.floor(stride))) % n) + n) % n;
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

/** A run number for a job that runs every `everyMinutes` minutes. */
export function runIndex(everyMinutes: number, now: Date = new Date()): number {
  return Math.floor(now.getTime() / (everyMinutes * 60_000));
}

/**
 * Every row of a query, a page at a time. PostgREST stops at 1,000 rows per
 * request (or fewer, if the project is set lower) without saying so.
 *
 * Two rules for callers and for this loop, both learned in review:
 *  - THE QUERY MUST HAVE A STABLE `.order(...)`. Without one the database may
 *    return rows in a different order for each page, so a row can be missed.
 *  - It stops on an EMPTY page, not a short one. A short page does not mean the
 *    end when the server's own limit is below the page size asked for.
 */
export async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pageSize = 1000, maxRows = 200_000): Promise<T[]> {
  const out: T[] = [];
  while (out.length < maxRows) {
    const { data, error } = await page(out.length, out.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return out;
    out.push(...data);
  }
  return out;
}
