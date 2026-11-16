// "Opened" for the needs-help list: the first time an invite page was shown in a
// real browser.
//
// The invite page itself still never changes anything when fetched: a mail
// scanner or a link preview fetching the address must not look like a person.
// This is called by a few lines of script on that page instead, which scanners
// and previews do not run. So it is a reasonable signal that a person saw the
// page, not proof.
//
// It records a time, once, and nothing else. It does not accept the invite,
// does not shorten its life, and says nothing back about whether the token was
// real, so it cannot be used to test tokens.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { hashInviteToken, normaliseInviteToken } from '@/lib/invite-token';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const token = normaliseInviteToken(typeof body?.token === 'string' ? body.token : null);
    if (token) {
      const { error } = await supabaseAdmin
        .from('retailer_invites')
        .update({ opened_at: new Date().toISOString() })
        .eq('token_hash', hashInviteToken(token))
        .is('opened_at', null);
      if (error) console.error('[invite/opened] could not record:', error.message);
    }
  } catch (err) {
    console.error('[invite/opened]', err);
  }
  // Always the same answer.
  return new NextResponse(null, { status: 204 });
}
