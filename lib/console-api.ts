import { NextResponse } from 'next/server';
import { consoleEnabled, getFunderId } from './funder-auth';

/** Every console route starts here: 404 while the flag is off, 401 without a funder session. */
export function consoleGate(request: { cookies: { get(n: string): { value: string } | undefined } }, needSession = true):
  { ok: true; funderId: string | null } | { ok: false; response: NextResponse } {
  if (!consoleEnabled()) return { ok: false, response: new NextResponse('Not found', { status: 404 }) };
  if (!needSession) return { ok: true, funderId: null };
  const funderId = getFunderId(request);
  if (!funderId) return { ok: false, response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  return { ok: true, funderId };
}
