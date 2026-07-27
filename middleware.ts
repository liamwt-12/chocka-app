import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveTenantSlug } from '@/lib/tenant-registry';

// Resolve the tenant by Host and inject `x-tenant-slug` on the request.
//
// This header is LIVE: the root layout reads it via getRequestTenant()
// (lib/tenant-request.ts) to pick the brand. app.stellarlocal.co.uk therefore
// renders as Stellar Local and app.chocka.co.uk as Chocka, from one deploy.
//
// Not yet consumed by cron, email or API routes — those still resolve to the
// primary tenant. See the KNOWN GAP note in lib/tenant.ts.
//
// Fail-open: any error serves the request unchanged (i.e. as Chocka) rather than
// taking the site down. No DB and no Node APIs — Edge-runtime safe.
export function middleware(req: NextRequest) {
  try {
    const slug = resolveTenantSlug(req.headers.get('host') || '');
    const headers = new Headers(req.headers);
    headers.set('x-tenant-slug', slug);
    return NextResponse.next({ request: { headers } });
  } catch {
    return NextResponse.next();
  }
}

// Run on everything except static assets, so we never sit in the hot path for
// images / _next output. `/api/*` is included so the header is available
// app-wide for later slices.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
