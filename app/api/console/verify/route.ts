import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { consoleGate } from '@/lib/console-api';
import { hashLoginToken, setFunderCookie } from '@/lib/funder-auth';
import { confirmPage, resultPage } from '@/lib/result-page';
import { getTenantBySlug } from '@/lib/tenant';

/** GET shows a confirm page (so email scanners cannot use up the link); POST signs in. */
export async function GET(request: NextRequest) {
  const gate = consoleGate(request, false);
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const t = getTenantBySlug('stellar');
  return new NextResponse(confirmPage(t, 'Sign in to the console', 'Tap the button to finish signing in.', 'Sign in', `${url.pathname}${url.search}`), {
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const gate = consoleGate(request, false);
  if (!gate.ok) return gate.response;
  const t = getTenantBySlug('stellar');
  const token = new URL(request.url).searchParams.get('token') || '';
  const bad = () => new NextResponse(resultPage(t, 'Link not valid', 'This sign-in link has expired or has already been used. Ask for a new one from the console page.'), { headers: { 'Content-Type': 'text/html' } });
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return bad();

  // Spend the token in one conditional update: unused and unexpired, or nothing.
  const { data } = await supabaseAdmin
    .from('funder_login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', hashLoginToken(token))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('funder_user_id');
  const funderId = data?.[0]?.funder_user_id;
  if (!funderId) return bad();

  const { data: funder } = await supabaseAdmin.from('funder_users').select('id, active').eq('id', funderId).maybeSingle();
  if (!funder?.active) return bad();

  const res = NextResponse.redirect(new URL('/console', request.url), 303);
  setFunderCookie(res, funder.id);
  return res;
}
