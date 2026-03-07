'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ minHeight: '100vh', background: '#F0EDE8', fontFamily: "'DM Sans', sans-serif", color: '#1A1A1A' }}>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#FAFAF8',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ maxWidth: 420, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, fontWeight: 500, letterSpacing: '0.12em', color: '#E8541A' }}>CHOCKA</span>
          <div style={{ display: 'flex', background: '#F0EDE8', borderRadius: 20, padding: 3, gap: 2 }}>
            {[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings', href: '/settings' }].map((item) => {
              const active = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} style={{
                  padding: '6px 16px', borderRadius: 16, fontSize: 13, fontWeight: 500,
                  fontFamily: "'DM Sans', sans-serif", textDecoration: 'none', cursor: 'pointer',
                  color: active ? '#1A1A1A' : '#999',
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
      <main style={{ maxWidth: 420, margin: '0 auto', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </main>
    </div>
  );
}
