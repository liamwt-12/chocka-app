'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ minHeight: '100vh', background: '#F0EDE8' }}>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#FAFAF8',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        padding: '14px 20px',
      }}>
        <div style={{ maxWidth: 420, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/dashboard" style={{
            fontFamily: "'Cabinet Grotesk', sans-serif", fontWeight: 800, fontSize: 14,
            letterSpacing: '0.12em', color: '#D4622B', textDecoration: 'none',
          }}>
            CHOCKA
          </Link>
          <div style={{ display: 'flex', background: '#F0EDE8', borderRadius: 20, padding: 3, gap: 2 }}>
            {[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings', href: '/settings' }].map((item) => {
              const active = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} style={{
                  padding: '6px 16px', borderRadius: 16, fontSize: 13, fontWeight: 500,
                  fontFamily: "'Inter', system-ui", textDecoration: 'none',
                  color: active ? '#2A2520' : '#A09A93',
                  background: active ? '#FAFAF8' : 'transparent',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                }}>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
      <main style={{ maxWidth: 420, margin: '0 auto', padding: '16px 16px 40px' }}>
        {children}
      </main>
    </div>
  );
}
