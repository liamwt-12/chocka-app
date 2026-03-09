'use client';

import { useEffect } from 'react';

const hd = "'DM Mono', monospace";
const bd = "'DM Sans', sans-serif";

export default function LoginPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) sessionStorage.setItem('chocka_ref', ref);
  }, []);

  const handleGoogleLogin = () => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get('plan') || 'monthly';
    window.location.href = `/api/auth/callback/google?action=login&plan=${plan}`;
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', background: 'var(--cream)' }}>
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <h1 style={{ fontFamily: hd, fontWeight: 800, fontSize: '1rem', letterSpacing: '3px', color: 'var(--orange)', margin: '0 0 0.3rem', textTransform: 'uppercase' as const }}>CHOCKA</h1>
        <p style={{ fontFamily: bd, color: 'var(--grey)', fontSize: '0.85rem', margin: '0 0 2.5rem' }}>Keep your diary chocka</p>

        <div style={{ background: '#FFFFFF', borderRadius: 24, padding: '2rem 1.75rem', boxShadow: '0 2px 16px rgba(42,37,32,.04)', animation: 'fadeUp 0.8s ease both' }}>
          <h2 style={{ fontFamily: hd, fontWeight: 800, fontSize: '1.3rem', color: 'var(--charcoal)', margin: '0 0 0.3rem', letterSpacing: '-0.5px' }}>Get started</h2>
          <p style={{ fontFamily: bd, fontSize: '0.83rem', color: 'var(--text)', margin: '0 0 1.75rem', lineHeight: 1.5 }}>
            Connect your Google account to manage your business profile automatically.
          </p>

          <button onClick={handleGoogleLogin} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem',
            width: '100%', padding: '0.9rem 1.5rem', borderRadius: 100,
            background: 'var(--charcoal)', color: '#FFFFFF', border: 'none',
            fontFamily: bd, fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(42,37,32,.15)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </div>

        <p style={{ fontFamily: bd, fontSize: '0.72rem', color: 'var(--grey)', marginTop: '2rem' }}>
          By continuing you agree to our{' '}
          <a href="/terms" style={{ color: 'var(--grey)', textDecoration: 'underline' }}>terms</a> and{' '}
          <a href="/privacy" style={{ color: 'var(--grey)', textDecoration: 'underline' }}>privacy policy</a>.
        </p>
      </div>
    </div>
  );
}
