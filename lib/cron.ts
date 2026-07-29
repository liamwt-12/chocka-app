import { NextRequest, NextResponse } from 'next/server';

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

// Get all active users with profiles (used by most cron jobs)
//
// tenants ( slug ) is embedded via the users.tenant_id FK so callers can resolve
// each user's tenant with getTenantForRow(). Cron has no request context, so
// this is the only way the brand is known at send time — dropping it would not
// break anything visibly, it would quietly send every tenant Chocka's branding.
export async function getActiveUsersWithProfiles(supabaseAdmin: any) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(`
      *,
      profiles (*),
      tenants ( slug )
    `)
    .eq('subscription_status', 'active')
    .eq('token_status', 'valid')
    .or('pause_until.is.null,pause_until.lt.now()');

  if (error) throw error;
  return data || [];
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
