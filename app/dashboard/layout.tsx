'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Settings', href: '/settings' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(248,246,243,0.92)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        padding: '0.85rem 1.5rem',
      }}>
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/dashboard" style={{
            fontFamily: 'var(--hd)', fontWeight: 800, fontSize: '0.95rem',
            letterSpacing: '3px', color: 'var(--orange)', textDecoration: 'none',
            textTransform: 'uppercase' as const,
          }}>
            CHOCKA
          </Link>
          <div style={{ display: 'flex', gap: '0.15rem' }}>
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    padding: '0.4rem 0.85rem',
                    borderRadius: 100,
                    fontSize: '0.8rem',
                    fontWeight: active ? 600 : 500,
                    textDecoration: 'none',
                    color: active ? 'var(--charcoal)' : 'var(--grey)',
                    background: active ? 'rgba(42,37,32,0.05)' : 'transparent',
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '1.25rem 1.5rem 3rem' }}>
        {children}
      </main>
    </div>
  );
}
