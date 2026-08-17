/**
 * The bridge between Netlify's scheduler and the cron routes.
 *
 * WHY THIS FILE EXISTS AT ALL
 * The six jobs are Next.js API routes (`app/api/cron/*`), not Netlify
 * functions, so Netlify's scheduler cannot invoke them directly. Each schedule
 * is therefore a thin Netlify function whose only job is to call its route over
 * HTTP. Nothing about the jobs themselves moves here — this is wiring.
 *
 * Until now there was no scheduler of any kind: no `[functions]` schedule, no
 * scheduled functions, no workflow, no third-party service. The routes existed
 * and were tested and had never once been invoked in production. That is the
 * gap this closes.
 *
 * WHY IT LIVES IN netlify/shared AND NOT netlify/functions
 * Netlify turns every file in the functions directory into a deployed function.
 * A helper sitting in there would become a seventh, unscheduled, publicly
 * addressable endpoint. Keeping it one directory across means it is bundled as
 * an import and never as a route.
 *
 * ON FAILING LOUDLY
 * A missing CRON_SECRET returns 401 from every route, and a scheduled job that
 * quietly 401s every hour looks exactly like a job that is running fine and
 * finding nothing to do. This codebase has already been bitten once by work
 * silently not happening (see admitEntitled in lib/cron.ts), so a missing
 * secret or a non-2xx response is thrown, not swallowed: a failed scheduled
 * function is visible in the Netlify log, a silent one is not.
 */

/** Netlify Functions v2 config. Typed locally so this needs no new dependency. */
export type ScheduledConfig = { schedule: string };

export async function runCron(routePath: string): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error(
      `[cron:${routePath}] CRON_SECRET is not set in this environment. Every ` +
        `cron route would answer 401, which is indistinguishable from a healthy ` +
        `run with nothing to do — so this fails instead.`,
    );
  }

  // CRON_TARGET_URL exists for the case where the scheduler should hit a
  // specific host; otherwise Netlify's own URL for the deploy is correct. The
  // routes resolve each user's brand from users.tenant_id rather than from the
  // Host header (cron has no meaningful Host — see middleware.ts), so which of
  // the site's domains this lands on does not affect branding.
  const base = process.env.CRON_TARGET_URL || process.env.URL;
  if (!base) {
    throw new Error(
      `[cron:${routePath}] Neither CRON_TARGET_URL nor URL is set, so there is ` +
        `no host to call.`,
    );
  }

  const started = Date.now();
  const res = await fetch(
    `${base}/api/cron/${routePath}?secret=${encodeURIComponent(secret)}`,
  );
  const elapsed = Date.now() - started;
  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `[cron:${routePath}] responded ${res.status} after ${elapsed}ms: ${body.slice(0, 500)}`,
    );
  }

  console.log(`[cron:${routePath}] ok in ${elapsed}ms — ${body.slice(0, 500)}`);
  return new Response(body, { status: 200 });
}
