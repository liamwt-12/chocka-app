'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const T = {
  slate: '#1C2331',
  cream: '#F8F6F3',
  orange: '#D4622B',
  muted: '#7A8190',
  border: 'rgba(28,35,49,0.10)',
  white: '#FFFFFF',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Settings', href: '/settings' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: T.cream, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <nav style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: '0.9rem 1.5rem' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/dashboard" style={{ color: T.orange, fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.02em', textDecoration: 'none' }}>
            Chocka
          </Link>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    padding: '0.45rem 0.9rem',
                    borderRadius: 8,
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    textDecoration: 'none',
                    color: active ? T.orange : T.muted,
                    background: active ? 'rgba(212,98,43,0.06)' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem 1.5rem 3rem' }}>
        {children}
      </main>
    </div>
  );
}
