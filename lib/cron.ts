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
export async function getActiveUsersWithProfiles(supabaseAdmin: any) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(`
      *,
      profiles (*)
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
    .createHmac('sha256', process.env.CRON_SECRET!)
    .update(postId)
    .digest('hex')
    .substring(0, 16);
}
