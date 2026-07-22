import './globals.css';
import type { Metadata } from 'next';
import { getTenant, tenantCssVars } from '@/lib/tenant';
import { TenantProvider } from '@/lib/tenant-context';

export function generateMetadata(): Metadata {
  const t = getTenant();
  return {
    title: t.meta.title,
    description: t.meta.description,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = getTenant();
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
