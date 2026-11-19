import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { consoleGate } from '@/lib/console-api';
import { newLoginToken, hashLoginToken, normaliseEmail, LOGIN_TOKEN_MINUTES, MAX_LINKS_PER_HOUR } from '@/lib/funder-auth';
import { sendEmail } from '@/lib/email';
import { getTenantBySlug } from '@/lib/tenant';

/**
 * Request a sign-in link. Only reachable when TARKETT_CONSOLE_ENABLED=on (404
 * otherwise), so no link is ever emailed while the console is off. The answer
 * is the same whether or not the address is registered, so it cannot be used
 * to find out who has access.
 */
const SAME_ANSWER = { ok: true, message: 'If that address has access, we have emailed a sign-in link. It works once, for 15 minutes.' };

export async function POST(request: NextRequest) {
  const gate = consoleGate(request, false);
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });

  // `ilike` treats %, _ and * as wildcards. An address is matched as written
  // (case aside), never as a pattern: otherwise "%@…" finds whoever has access
  // and emails them a link, which also burns their hourly limit.
  if (/[%*\\]/.test(email)) return NextResponse.json(SAME_ANSWER);
  const { data: funder } = await supabaseAdmin.from('funder_users').select('id, email, active').ilike('email', email.replace(/_/g, '\\_')).maybeSingle();
  if (!funder?.active) return NextResponse.json(SAME_ANSWER);

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await supabaseAdmin.from('funder_login_tokens').select('id', { count: 'exact', head: true })
    .eq('funder_user_id', funder.id).gte('created_at', hourAgo);
  if ((count ?? 0) >= MAX_LINKS_PER_HOUR) return NextResponse.json(SAME_ANSWER);

  const token = newLoginToken();
  const { error } = await supabaseAdmin.from('funder_login_tokens').insert({
    funder_user_id: funder.id,
    token_hash: hashLoginToken(token),
    expires_at: new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60_000).toISOString(),
  });
  if (error) {
    console.error('[console/login] could not store token:', error.message);
    return NextResponse.json(SAME_ANSWER);
  }

  const t = getTenantBySlug('stellar');
  const link = `${t.appUrl}/api/console/verify?token=${token}`;
  await sendEmail({
    to: funder.email,
    subject: 'Your Stellar Local console sign-in link',
    html: `<p>Here is your sign-in link for the Stellar Local console. It works once, for ${LOGIN_TOKEN_MINUTES} minutes.</p><p><a href="${link}">Sign in to the console</a></p><p>If you did not ask for this, you can ignore it.</p>`,
    tenant: t,
  });
  return NextResponse.json(SAME_ANSWER);
}
