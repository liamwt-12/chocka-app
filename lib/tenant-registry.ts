// Edge-safe host → tenant-slug resolution, used only by middleware.ts (slice 2).
//
// Self-contained on purpose: no DB, no server env, no import of lib/tenant.ts —
// so it runs cleanly in the Netlify Edge runtime and stays a pure string map.
//
// Unknown hosts fail-safe to the primary tenant rather than erroring. Once
// Stellar is in front of real retailers, the unknown-host case should become a
// deliberate 404 / holding-page decision instead of a silent fallback.

export const PRIMARY_TENANT_SLUG = 'chocka';

// Known hostnames → slug. Port is stripped before lookup.
//
// Only app.* hosts appear here. The apex and www for both brands serve their
// static marketing sites on separate Netlify sites and never reach this app —
// adding them would imply a routing that does not exist.
const HOST_TO_SLUG: Record<string, string> = {
  'app.chocka.co.uk': 'chocka',
  'chocka.co.uk': 'chocka',
  'www.chocka.co.uk': 'chocka',
  'localhost': 'chocka',
  '127.0.0.1': 'chocka',
  'app.stellarlocal.co.uk': 'stellar',
};

export function resolveTenantSlug(host: string): string {
  const h = host.split(':')[0].toLowerCase();
  return HOST_TO_SLUG[h] ?? PRIMARY_TENANT_SLUG;
}
