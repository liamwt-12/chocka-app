import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveTenantSlug } from '@/lib/tenant-registry';

// Resolve the tenant by Host and inject `x-tenant-slug` on the request.
//
// This header is LIVE: the root layout reads it via getRequestTenant()
// (lib/tenant-request.ts) to pick the brand. app.stellarlocal.co.uk therefore
// renders as Stellar Local and app.chocka.co.uk as Chocka, from one deploy.
//
// Cron does NOT and cannot use this header — a scheduler sends no meaningful
// Host, so per-user work resolves the brand from users.tenant_id instead, via
// getTenantForRow(). The OAuth callback is where the two meet: it reads this
// header at signup and writes the resulting tenant onto the new user row, which
// is what every later cron then reads back.
//
// Fail-open: any error serves the request unchanged (i.e. as Chocka) rather than
// taking the site down. No DB and no Node APIs — Edge-runtime safe.
//
// THE IMAGE ENDPOINT IS SHUT. Nothing in the app uses next/image, and several
// published Next.js advisories (some only fixed in 15.5 or later) are in the
// image optimiser behind /_next/image. So any request for it gets a plain 404
// here, before Next or the host's image service sees it. If an image component
// is ever wanted, remove this and the `images` setting in next.config.js
// together, on a Next version without those advisories.
export const IMAGE_ENDPOINT = '/_next/image';

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === IMAGE_ENDPOINT || req.nextUrl.pathname.startsWith(`${IMAGE_ENDPOINT}/`)) {
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
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
// _next output. `/api/*` is included so the header is available app-wide for
// later slices. /_next/image is matched on its own, only to refuse it (above).
export const config = {
  matcher: ['/_next/image', '/_next/image/:path*', '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
