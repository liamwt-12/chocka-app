'use client';

import { useEffect } from 'react';

const V = { bg:'#F0EDE8',card:'#FAFAF8',orange:'#E8541A',text:'#1A1A1A',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const barlow = "'Barlow Condensed',sans-serif";

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
    <div style={{ minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'1.5rem',background:V.bg,fontFamily:sans }}>
      <div style={{ width:'100%',maxWidth:380 }}>
        <div style={{ marginBottom:32 }}>
          <div style={{ fontFamily:mono,fontWeight:500,fontSize:14,letterSpacing:'0.12em',color:V.orange }}>CHOCKA</div>
          <h1 style={{ fontFamily:barlow,fontSize:36,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'8px 0 6px',color:V.text }}>Get<br/>started.</h1>
          <p style={{ fontSize:14,color:V.textSoft }}>Connect your Google account to get your free profile score.</p>
        </div>

        <div style={{ background:V.card,borderRadius:16,padding:'28px 24px',boxShadow:V.shadow }}>
          <button onClick={handleGoogleLogin} style={{
            display:'flex',alignItems:'center',justifyContent:'center',gap:10,
            width:'100%',padding:'14px 20px',borderRadius:8,
            background:V.text,color:'#fff',border:'none',
            fontFamily:sans,fontSize:15,fontWeight:600,cursor:'pointer',
            transition:'all .2s',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div style={{ textAlign:'center',marginTop:16 }}>
            <p style={{ fontSize:12,color:V.textSoft }}>Takes 30 seconds · No card required to see your score</p>
          </div>
        </div>

        <div style={{ display:'flex',justifyContent:'center',gap:20,marginTop:24 }}>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontFamily:mono,fontSize:18,fontWeight:600,color:V.text }}>£29</div>
            <div style={{ fontSize:10,color:V.textSoft,textTransform:'uppercase',letterSpacing:'.06em' }}>per month</div>
          </div>
          <div style={{ width:1,background:V.border }}/>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontFamily:mono,fontSize:18,fontWeight:600,color:V.text }}>2 min</div>
            <div style={{ fontSize:10,color:V.textSoft,textTransform:'uppercase',letterSpacing:'.06em' }}>to set up</div>
          </div>
          <div style={{ width:1,background:V.border }}/>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontFamily:mono,fontSize:18,fontWeight:600,color:V.text }}>0</div>
            <div style={{ fontSize:10,color:V.textSoft,textTransform:'uppercase',letterSpacing:'.06em' }}>effort</div>
          </div>
        </div>

        <p style={{ fontSize:11,color:V.textSoft,textAlign:'center',marginTop:24 }}>
          By continuing you agree to our{' '}
          <a href="/terms" style={{ color:V.textSoft,textDecoration:'underline' }}>terms</a> and{' '}
          <a href="/privacy" style={{ color:V.textSoft,textDecoration:'underline' }}>privacy policy</a>.
        </p>
      </div>
    </div>
  );
}
