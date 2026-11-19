import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { consoleGate } from '@/lib/console-api';
import { loadConsoleData } from '@/lib/console-data';

// With the console flag off at build time this handler returns before reading
// cookies, so Next would prerender its 404 and serve it forever, even after
// the flag is turned on. Always run it per request.
export const dynamic = 'force-dynamic';

/** Console and league data. 404 while the flag is off; 401 without a funder session. */
export async function GET(request: NextRequest) {
  const gate = consoleGate(request);
  if (!gate.ok) return gate.response;

  const { data: funder } = await supabaseAdmin.from('funder_users').select('id, tenant_id, name, active').eq('id', gate.funderId).maybeSingle();
  if (!funder?.active) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const data = await loadConsoleData(supabaseAdmin, funder.tenant_id);
    return NextResponse.json({ viewer: funder.name || null, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[console/data]', err);
    return NextResponse.json({ error: 'Could not load the console' }, { status: 500 });
  }
}
