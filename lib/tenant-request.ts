// ── Request-scoped tenant resolution ──────────────────────────────────────
// Reads the `x-tenant-slug` header that middleware.ts sets from the Host, and
// turns it into a Tenant. This is the piece that makes one Netlify deploy serve
// Chocka on app.chocka.co.uk and Stellar Local on app.stellarlocal.co.uk.
//
// WHY THIS IS ITS OWN MODULE: it imports next/headers, which lib/tenant.ts must
// never do. That file is imported by cron routes and other non-request contexts
// where headers() throws. Keeping the import here means lib/tenant.ts stays
// safe to import from anywhere.
//
// COST: calling headers() opts the caller out of static rendering. The root
// layout uses this, so every page under it is server-rendered per request
// rather than prerendered. That is accepted and deliberate — host-based
// branding cannot be resolved at build time when one build serves two hosts.
//
// Fail-open: a missing or unknown slug yields the primary tenant (Chocka),
// matching middleware's own fail-open behaviour. A branding wobble is a better
// failure than a 500.

import { headers } from 'next/headers';
import { getTenantBySlug, type Tenant } from './tenant';

export function getRequestTenant(): Tenant {
  try {
    return getTenantBySlug(headers().get('x-tenant-slug'));
  } catch {
    // headers() threw — no request context. Fall back to the primary tenant.
    return getTenantBySlug(null);
  }
}
