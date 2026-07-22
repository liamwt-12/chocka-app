import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveTenantSlug } from '@/lib/tenant-registry';

// Slice 2 — resolve the tenant by Host and inject `x-tenant-slug` on the request.
//
// Deliberately INERT this slice: getTenant() does NOT read this header yet, so
// the static/dynamic render split is unchanged and Chocka behaves exactly as
// before. This is forward plumbing for slices 3+ (and the second tenant in 6).
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
