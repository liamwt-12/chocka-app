/**
 * The operator's two actions for review requests, behind /api/admin/review-requests.
 * The database and the mailer are passed in, so this can be tested with stubs.
 */
import type { Tenant } from './tenant';
import { fromWithName } from './email';
import { reviewRequestsEnabled } from './review-requests';
import {
  prepareRequests, composeRequest, confirmationMatches, sendRequests,
  type Prepared, type RequestShop, type RequestStore, type SendDeps, type loadRequestShop,
} from './review-requests-data';

export interface HandleCtx {
  tenant: Tenant;
  loadShop: (retailerId: unknown) => ReturnType<typeof loadRequestShop>;
  store: RequestStore;
  deps: SendDeps;
  env: Record<string, string | undefined>;
  now?: Date;
}

/**
 * { action: 'dry_run', retailerId, csv }: always allowed; sends nothing, writes nothing.
 * { action: 'send', retailerId, csv, confirmCount }: refused unless the switch
 * is on AND confirmCount is the number of emails the plan says will go. The
 * plan is worked out again from the file and the database as they are now, so
 * what goes is what was shown.
 */
export async function handleReviewRequestAction(body: any, ctx: HandleCtx): Promise<{ status: number; body: any }> {
  const enabled = reviewRequestsEnabled(ctx.env);
  if (body?.action !== 'dry_run' && body?.action !== 'send') return { status: 400, body: { error: 'Unknown action' } };
  const loaded = await ctx.loadShop(body.retailerId);
  if (!loaded.ok) return { status: 400, body: { error: loaded.error, enabled } };
  const prepared = await prepareRequests(ctx.store, loaded.shop, body.csv, ctx.now ?? new Date());
  if (!prepared.plan) return { status: 400, body: { error: prepared.parsed.error, enabled } };
  if (body.action === 'dry_run') return { status: 200, body: dryRunView(loaded.shop, prepared, enabled, ctx.tenant) };

  if (!enabled) return { status: 403, body: { error: 'Review requests are switched off (REVIEW_REQUESTS). Nothing was sent.', enabled } };
  if (!confirmationMatches(prepared.plan, body.confirmCount)) {
    return { status: 409, body: { error: `Not sent. Type the number of emails that will go (${prepared.plan.toSend.length}) to confirm. If it has changed since the dry run, run the dry run again first.`, enabled } };
  }
  const result = await sendRequests(ctx.store, loaded.shop, prepared.plan, ctx.tenant, { ...ctx.deps, env: ctx.env });
  // Counts only: no address in the log.
  console.log(`[admin/review-requests] shop ${loaded.shop.id}: ${result.sent} sent, ${result.failed.length} failed, ${result.skipped.length} skipped, ${result.notReached.length} not reached`);
  return { status: result.refused ? 403 : 200, body: { enabled, result } };
}

/** What the operator sees before anything is sent: every row, and the exact email the first person would get. */
export function dryRunView(shop: RequestShop, prepared: Prepared, enabled: boolean, tenant: Tenant) {
  const plan = prepared.plan!;
  const first = plan.toSend[0];
  const sample = first ? composeRequest(shop, first, tenant) : null;
  return {
    dryRun: true,
    enabled,
    shop: { id: shop.id, name: shop.name },
    headerFound: prepared.parsed.headerFound,
    willSend: plan.toSend.length,
    excludedCount: plan.excluded.length,
    limits: plan.limits,
    rows: plan.lines.map((l) => ({ row: l.row, email: l.email, firstName: l.firstName, firstNameDropped: l.firstNameDropped, send: l.send, reason: l.reason })),
    sample: sample ? { to: sample.to, from: fromWithName(tenant.emailFrom, sample.fromName), replyTo: sample.replyTo, subject: sample.subject, text: sample.text, headers: sample.headers } : null,
    confirmWith: plan.toSend.length,
  };
}
