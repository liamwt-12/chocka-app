// Edge-safe host → tenant-slug resolution, used only by middleware.ts (slice 2).
//
// Self-contained on purpose: no DB, no server env, no import of lib/tenant.ts —
// so it runs cleanly in the Netlify Edge runtime and stays a pure string map.
//
// Today there is one tenant, so every host resolves to it and unknown hosts
// fail-safe to the primary. When a second tenant lands (slice 6) this map gains
// entries and the unknown-host case becomes a deliberate 404 / holding-page
// decision instead of a silent fallback.

export const PRIMARY_TENANT_SLUG = 'chocka';

// Known hostnames → slug. Port is stripped before lookup.
const HOST_TO_SLUG: Record<string, string> = {
  'app.chocka.co.uk': 'chocka',
  'chocka.co.uk': 'chocka',
  'www.chocka.co.uk': 'chocka',
  'localhost': 'chocka',
  '127.0.0.1': 'chocka',
};

export function resolveTenantSlug(host: string): string {
  const h = host.split(':')[0].toLowerCase();
  return HOST_TO_SLUG[h] ?? PRIMARY_TENANT_SLUG;
}
