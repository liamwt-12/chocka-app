import { NextRequest, NextResponse } from 'next/server';
import { getTenantForRow, type TenantEmbeddedRow } from './tenant';

// Verify cron secret from query param
export function verifyCronSecret(request: NextRequest): boolean {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  return secret === process.env.CRON_SECRET;
}

// Standard unauthorized response
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Should cron do automated work for this user?
 *
 * This is the gate every cron job runs behind, and it used to be a bare
 * `subscription_status = 'active'` in SQL. That column is a **Stripe mirror** —
 * the only code that ever writes 'active' is the Stripe webhook
 * (`app/api/webhook/route.ts`). It answers "is this user paying", which is not
 * the same question as "should we do work for this user", and the two only
 * looked identical while every tenant was paid.
 *
 * Stellar Local is free to the retailer (`priceMonthlyGbp: 0`, funded by
 * Tarkett), so a Stellar retailer never touches Stripe and their status stays at
 * its default of 'none' forever. Under the old gate that made every Stellar
 * retailer invisible to all six cron routes — no post generation, no publishing,
 * no review alerts or auto-reply, no weekly stats, no monthly report, no
 * onboarding sequence — permanently, and with no error anywhere. The retailer
 * connects, lands on a working dashboard, and the product simply never runs.
 *
 * A zero-price tenant is therefore entitled by virtue of being zero-price:
 * there is no payment that could arrive to flip the flag.
 *
 * WHY THIS IS FILTERED IN JS AND NOT IN SQL: priceMonthlyGbp lives in
 * `lib/tenant.ts`, not in the `tenants` table (see supabase/README.md — the row
 * deliberately has no price column), so it cannot be reached from a PostgREST
 * filter. The query below keeps its cheap SQL predicates and this one runs in
 * memory.
 *
 * This is the deliberately small fix. Splitting entitlement from billing status
 * properly is the right shape and is logged in FOLLOWUPS.md.
 */
export function isEntitledToAutomation(
  user: (TenantEmbeddedRow & { subscription_status?: string | null }) | null | undefined,
): boolean {
  if (!user) return false;
  if (user.subscription_status === 'active') return true;
  return getTenantForRow(user).priceMonthlyGbp === 0;
}

/**
 * Apply the entitlement gate to a set of candidates AND say out loud what it did.
 *
 * The counting is the point. The 2026-08-03 bug — every Stellar retailer
 * silently excluded from all six cron routes, forever — survived because a run
 * that admits nobody looks exactly like a quiet week: no error, no log, no
 * complaint, and no output that anyone was waiting for. It was found by reading
 * the code, not by observing the system, and nothing about the system would ever
 * have volunteered it.
 *
 * So every route now records `candidates` (what the query returned) and
 * `admitted` (what survived the gate), with a per-tenant breakdown, and warns
 * when it had candidates and admitted none. That last condition is not
 * necessarily a fault — a paid tenant with nobody currently paying legitimately
 * admits zero — but it is the exact shape the fault takes, and it should never
 * again be something you can only discover by going and looking.
 *
 * This lives here, rather than being written out at each call site, because
 * there are two independent query paths (this module's and
 * onboarding-sequence's) and FOLLOWUPS notes that a third which forgets the
 * filter is a silent repeat of the original bug. Routing both through one
 * function that filters and logs together makes forgetting one of the two
 * impossible: you cannot take the filter without the log.
 */
export function admitEntitled<T extends TenantEmbeddedRow & { subscription_status?: string | null }>(
  candidates: T[],
  routeLabel: string,
): T[] {
  const admitted = candidates.filter(isEntitledToAutomation);

  // Per-tenant, because the aggregate hides the failure this exists to catch:
  // "8 admitted of 9" reads fine right up until the 1 excluded is every retailer
  // on the other brand.
  const byTenant: Record<string, { candidates: number; admitted: number }> = {};
  for (const c of candidates) {
    const slug = c?.tenants?.slug ?? '(none)';
    byTenant[slug] = byTenant[slug] || { candidates: 0, admitted: 0 };
    byTenant[slug].candidates++;
  }
  for (const a of admitted) {
    const slug = a?.tenants?.slug ?? '(none)';
    byTenant[slug].admitted++;
  }
  const breakdown = Object.keys(byTenant)
    .sort()
    .map((s) => `${s} ${byTenant[s].admitted}/${byTenant[s].candidates}`)
    .join(', ');

  const line =
    `[cron:${routeLabel}] candidates=${candidates.length} admitted=${admitted.length}` +
    (breakdown ? ` (${breakdown})` : '');

  if (candidates.length > 0 && admitted.length === 0) {
    console.warn(
      `${line} — ZERO admitted. Every candidate was excluded by the entitlement ` +
        `gate. This is legitimate when no one is currently entitled, but it is ` +
        `also exactly what the 2026-08-03 silent-exclusion bug looked like, so it ` +
        `is stated rather than left to be inferred from an absence of output.`,
    );
  } else {
    console.log(line);
  }

  return admitted;
}

// Get all users cron should work for, with profiles (used by most cron jobs)
//
// tenants ( slug ) is embedded via the users.tenant_id FK so callers can resolve
// each user's tenant with getTenantForRow(). Cron has no request context, so
// this is the only way the brand is known at send time — dropping it would not
// break anything visibly, it would quietly send every tenant Chocka's branding.
// It is now also what isEntitledToAutomation reads, so the embed is load-bearing
// twice over.
//
// `routeLabel` only names the caller in the log line — see admitEntitled. It is
// required rather than defaulted, so a new cron route cannot land contributing
// an anonymous count to a shared log stream.
// The `any[]` return is the pre-existing shape, restated explicitly rather than
// inherited: admitEntitled is generic over a constrained row type, and letting
// it infer here would narrow callers to just the two fields the gate reads,
// breaking every route that goes on to use `profiles`, `phone_number` and the
// rest. Typing these rows properly is a separate job to the whole of cron.
export async function getActiveUsersWithProfiles(supabaseAdmin: any, routeLabel: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(`
      *,
      profiles (*),
      tenants ( slug )
    `)
    .eq('token_status', 'valid')
    .or('pause_until.is.null,pause_until.lt.now()');

  if (error) throw error;
  return admitEntitled(data || [], routeLabel);
}

// Generate a signed cancel URL hash
export function generateCancelHash(postId: string): string {
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', process.env.CANCEL_HASH_SECRET!)
    .update(postId)
    .digest('hex')
    .substring(0, 16);
}

// Generate a signed review action hash
export function generateReviewHash(reviewId: string): string {
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', process.env.CANCEL_HASH_SECRET!)
    .update(`review:${reviewId}`)
    .digest('hex')
    .substring(0, 16);
}
