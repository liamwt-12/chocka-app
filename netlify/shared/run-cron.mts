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

/*
 * FAILURE ALERTS (added 2026-11-14)
 * Throwing makes a failure visible in the Netlify log, but nobody reads that log
 * unprompted. So every failure (missing configuration, a non-2xx response, a
 * network error, or a run that outlasts the function's time limit) also sends
 * an alert, to whichever of these are configured:
 *   CRON_ALERT_EMAIL        an address; sent through Resend (RESEND_API_KEY)
 *   CRON_ALERT_FROM         optional sender, defaults to RESEND_FROM, then the
 *                           Stellar Local address
 *   CRON_ALERT_WEBHOOK_URL  optional; receives JSON {"text": "..."}, which
 *                           Slack and Discord-compatible webhooks accept
 * If none is set, a warning says so on every failure. An alert that fails to
 * send is logged and never hides the original error.
 *
 * THE SECRET GOES IN A HEADER, not the URL, so it stays out of access logs. The
 * routes still accept ?secret= until CRON_ACCEPT_QUERY_SECRET=false (lib/cron.ts).
 */

/** Netlify Functions v2 config. Typed locally so this needs no new dependency. */
export type ScheduledConfig = { schedule: string };

/**
 * Scheduled functions are stopped by Netlify at 30 seconds. Giving up a little
 * before that means a slow run produces an alert instead of vanishing.
 */
export const CRON_TIMEOUT_MS = 25_000;

const DEFAULT_ALERT_FROM = 'Stellar Local <hello@stellarlocal.co.uk>';

/** Send a failure alert to every configured channel. Never throws. */
export async function sendCronAlert(routePath: string, message: string): Promise<void> {
  const email = process.env.CRON_ALERT_EMAIL;
  const webhook = process.env.CRON_ALERT_WEBHOOK_URL;
  const text = `Scheduled job "${routePath}" failed at ${new Date().toISOString()}.\n\n${message}`;

  if (!email && !webhook) {
    console.warn(`[cron:${routePath}] no alert channel configured (CRON_ALERT_EMAIL / CRON_ALERT_WEBHOOK_URL), so this failure is in the log only`);
    return;
  }

  const sends: Promise<void>[] = [];
  if (email) {
    sends.push((async () => {
      const key = process.env.RESEND_API_KEY;
      if (!key) { console.error(`[cron:${routePath}] CRON_ALERT_EMAIL is set but RESEND_API_KEY is not`); return; }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.CRON_ALERT_FROM || process.env.RESEND_FROM || DEFAULT_ALERT_FROM,
          to: email,
          subject: `Scheduled job failed: ${routePath}`,
          text,
        }),
      });
      if (!res.ok) console.error(`[cron:${routePath}] alert email failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    })());
  }
  if (webhook) {
    sends.push((async () => {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) console.error(`[cron:${routePath}] alert webhook failed: ${res.status}`);
    })());
  }
  const results = await Promise.allSettled(sends);
  for (const r of results) {
    if (r.status === 'rejected') console.error(`[cron:${routePath}] alert could not be sent: ${String(r.reason).slice(0, 200)}`);
  }
}

/** Run one cron route. Any failure is alerted, then thrown so Netlify records it too. */
export async function runCron(routePath: string): Promise<Response> {
  try {
    return await callRoute(routePath);
  } catch (err: any) {
    const message = String(err?.message ?? err);
    await sendCronAlert(routePath, message);
    throw err;
  }
}

async function callRoute(routePath: string): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error(
      `[cron:${routePath}] CRON_SECRET is not set in this environment. Every ` +
        `cron route would answer 401, which is indistinguishable from a healthy ` +
        `run with nothing to do, so this fails instead.`,
    );
  }

  // CRON_TARGET_URL exists for the case where the scheduler should hit a
  // specific host; otherwise Netlify's own URL for the deploy is correct. The
  // routes resolve each user's brand from users.tenant_id rather than from the
  // Host header (cron has no meaningful Host, see middleware.ts), so which of
  // the site's domains this lands on does not affect branding.
  const base = process.env.CRON_TARGET_URL || process.env.URL;
  if (!base) {
    throw new Error(
      `[cron:${routePath}] Neither CRON_TARGET_URL nor URL is set, so there is ` +
        `no host to call.`,
    );
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${base}/api/cron/${routePath}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(CRON_TIMEOUT_MS),
    });
  } catch (err: any) {
    const elapsed = Date.now() - started;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(
        `[cron:${routePath}] no response after ${elapsed}ms. The route may still be running, ` +
          `but it is close to the function time limit and work may have been cut off.`,
      );
    }
    throw new Error(`[cron:${routePath}] request failed after ${elapsed}ms: ${String(err?.message ?? err).slice(0, 300)}`);
  }
  const elapsed = Date.now() - started;
  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `[cron:${routePath}] responded ${res.status} after ${elapsed}ms: ${body.slice(0, 500)}`,
    );
  }

  console.log(`[cron:${routePath}] ok in ${elapsed}ms: ${body.slice(0, 500)}`);
  return new Response(body, { status: 200 });
}
