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

// Get all users cron should work for, with profiles (used by most cron jobs)
//
// tenants ( slug ) is embedded via the users.tenant_id FK so callers can resolve
// each user's tenant with getTenantForRow(). Cron has no request context, so
// this is the only way the brand is known at send time — dropping it would not
// break anything visibly, it would quietly send every tenant Chocka's branding.
// It is now also what isEntitledToAutomation reads, so the embed is load-bearing
// twice over.
export async function getActiveUsersWithProfiles(supabaseAdmin: any) {
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
  return (data || []).filter(isEntitledToAutomation);
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
