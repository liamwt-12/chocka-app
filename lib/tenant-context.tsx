'use client';

// Client-side access to the resolved tenant. The server (root layout) resolves
// the tenant via getTenant() and passes it down; client components read it with
// useTenant(). This is the seam that lets a client bundle stay tenant-agnostic —
// no client code imports getTenant() or reads env directly.

import { createContext, useContext } from 'react';
import type { Tenant } from './tenant';

const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({ tenant, children }: { tenant: Tenant; children: React.ReactNode }) {
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

export function useTenant(): Tenant {
  const t = useContext(TenantContext);
  if (!t) throw new Error('useTenant must be used within <TenantProvider>');
  return t;
}
