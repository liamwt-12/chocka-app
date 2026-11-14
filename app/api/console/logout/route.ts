import { NextRequest, NextResponse } from 'next/server';
import { consoleGate } from '@/lib/console-api';
import { clearFunderCookie } from '@/lib/funder-auth';

export async function POST(request: NextRequest) {
  const gate = consoleGate(request, false);
  if (!gate.ok) return gate.response;
  const res = NextResponse.json({ ok: true });
  clearFunderCookie(res);
  return res;
}
