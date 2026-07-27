import './globals.css';
import type { Metadata } from 'next';
import { tenantCssVars } from '@/lib/tenant';
import { getRequestTenant } from '@/lib/tenant-request';
import { TenantProvider } from '@/lib/tenant-context';

// Both of these read the request's Host (via the x-tenant-slug header), which
// makes every page under this layout server-rendered rather than prerendered.
// That is the accepted cost of serving two brands from one deploy — see
// lib/tenant-request.ts.

export function generateMetadata(): Metadata {
  const t = getRequestTenant();
  return {
    title: t.meta.title,
    description: t.meta.description,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = getRequestTenant();
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${tenantCssVars(tenant)}}` }} />
      </head>
      <body style={{ fontFamily: "var(--bd)", background: 'var(--cream)', color: 'var(--text)' }}>
        <TenantProvider tenant={tenant}>{children}</TenantProvider>
      </body>
    </html>
  );
}
