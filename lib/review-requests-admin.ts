/**
 * The operator's two actions for review requests, behind /api/admin/review-requests.
 * The database and the mailer are passed in, so this can be tested with stubs.
 */
import type { Tenant } from './tenant';
import { fromWithName } from './email';
import { reviewRequestsEnabled } from './review-requests';
import {
  prepareRequests, composeRequest, confirmationMatches, sendRequests, addToDoNotEmail,
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
 * { action: 'suppress', email }: always allowed; adds the address to the do-not-email list (manualSuppress below).
 * { action: 'dry_run', retailerId, csv }: always allowed; sends nothing, writes nothing.
 * { action: 'send', retailerId, csv, confirmCount }: refused unless the switch
 * is on AND confirmCount is the number of emails the plan says will go. The
 * plan is worked out again from the file and the database as they are now, so
 * what goes is what was shown.
 */
export async function handleReviewRequestAction(body: any, ctx: HandleCtx): Promise<{ status: number; body: any }> {
  const enabled = reviewRequestsEnabled(ctx.env);
  if (body?.action === 'suppress') return manualSuppress(body.email, ctx.store);
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

/** The one answer to a manual add, whether the address was on the list already or not. */
export const SUPPRESSED_MESSAGE = 'Done. No shop will send that address a review request.';

/**
 * { action: 'suppress', email }: an operator puts an address on the
 * do-not-email list by hand. Needs no shop, and works whether or not
 * REVIEW_REQUESTS is on, so an unsubscribe can be recorded before switching
 * on. The answer is the same whether or not it was there already, and the
 * address is neither stored, logged nor sent back.
 */
async function manualSuppress(email: unknown, store: RequestStore): Promise<{ status: number; body: any }> {
  const r = await addToDoNotEmail(store, email);
  if (!r.ok) return { status: r.status, body: { error: r.error } };
  console.log('[admin/review-requests] an operator added an address to the do-not-email list');
  return { status: 200, body: { done: true, message: SUPPRESSED_MESSAGE } };
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
