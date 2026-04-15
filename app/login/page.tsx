'use client';

import { useEffect, useState } from 'react';

const V = { bg:'#F0EDE8',card:'#FAFAF8',orange:'#E8541A',text:'#1A1A1A',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const barlow = "'Barlow Condensed',sans-serif";

export default function LoginPage() {
  const [privacyOpen, setPrivacyOpen] = useState(false);

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
          <h1 style={{ fontFamily:barlow,fontSize:36,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'8px 0 6px',color:V.text }}>See your Google<br/>profile score.</h1>
          <p style={{ fontSize:14,color:V.textSoft }}>Find out what's hurting your visibility and what to fix first. Takes 30 seconds.</p>
        </div>

        <div style={{ background:V.card,borderRadius:16,padding:'28px 24px',boxShadow:V.shadow }}>
          {/* WHAT YOU'LL GET */}
          <div style={{ background:V.bg,borderRadius:12,border:`1px solid ${V.border}`,padding:'16px 16px 12px',marginBottom:20 }}>
            <div style={{ fontFamily:mono,fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.1em',color:V.textSoft,marginBottom:12 }}>What you'll get</div>
            <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
              <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink:0,marginTop:1 }}>
                  <circle cx="10" cy="10" r="9" fill="none" stroke={V.textSoft} strokeWidth="1.5"/>
                  <circle cx="10" cy="10" r="5" fill="none" stroke={V.textSoft} strokeWidth="1.5"/>
                  <circle cx="10" cy="10" r="1.5" fill={V.textSoft}/>
                </svg>
                <div>
                  <div style={{ fontSize:13,fontWeight:600,color:V.text }}>Your score out of 100</div>
                  <div style={{ fontSize:11,color:V.textSoft,marginTop:1 }}>See how you rank against local competitors</div>
                </div>
              </div>
              <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink:0,marginTop:1 }}>
                  <path d="M10 3L18 17H2L10 3Z" fill="none" stroke={V.textSoft} strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="10" y1="9" x2="10" y2="12.5" stroke={V.textSoft} strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="10" cy="14.5" r="0.75" fill={V.textSoft}/>
                </svg>
                <div>
                  <div style={{ fontSize:13,fontWeight:600,color:V.text }}>What's losing you jobs</div>
                  <div style={{ fontSize:11,color:V.textSoft,marginTop:1 }}>Missing photos, reviews, response time and more</div>
                </div>
              </div>
              <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink:0,marginTop:1 }}>
                  <path d="M10 16V4M10 4L5 9M10 4L15 9" fill="none" stroke={V.textSoft} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div>
                  <div style={{ fontSize:13,fontWeight:600,color:V.text }}>What to fix first</div>
                  <div style={{ fontSize:11,color:V.textSoft,marginTop:1 }}>Ranked by impact, so you're not wasting time</div>
                </div>
              </div>
            </div>
          </div>

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
            Connect Google — see your score
          </button>

          <div style={{ textAlign:'center',marginTop:12 }}>
            <p style={{ fontSize:12,color:V.textSoft }}>Free · No card required · 30 seconds</p>
          </div>

          {/* Privacy accordion */}
          <div style={{ marginTop:16,border:`1px solid ${V.border}`,borderRadius:8,overflow:'hidden' }}>
            <button
              onClick={() => setPrivacyOpen(!privacyOpen)}
              style={{
                display:'flex',alignItems:'center',justifyContent:'space-between',
                width:'100%',padding:'10px 12px',background:'transparent',border:'none',
                cursor:'pointer',fontFamily:sans,fontSize:12,color:V.textSoft,
              }}
            >
              <span style={{ display:'flex',alignItems:'center',gap:6 }}>
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <rect x="4" y="6" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M5 6V4.5a2 2 0 0 1 4 0V6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                We only read your profile
              </span>
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform:privacyOpen ? 'rotate(180deg)' : 'none',transition:'transform .2s' }}>
                <path d="M2 4L5 7L8 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {privacyOpen && (
              <div style={{ padding:'0 12px 10px',fontSize:12,color:V.textSoft }}>
                We never post, never make changes, and never access your email.
              </div>
            )}
          </div>
        </div>

        {/* Social proof */}
        <div style={{ textAlign:'center',marginTop:24 }}>
          <p style={{ fontSize:13,color:V.textSoft }}>Trusted by tradespeople across the North East</p>
          <p style={{ fontSize:11,color:V.textSoft,marginTop:4 }}>3,800+ profiles scored</p>
        </div>

        <p style={{ fontSize:11,color:V.textSoft,textAlign:'center',marginTop:20 }}>
          By continuing you agree to our{' '}
          <a href="/terms" style={{ color:V.textSoft,textDecoration:'underline' }}>terms</a> and{' '}
          <a href="/privacy" style={{ color:V.textSoft,textDecoration:'underline' }}>privacy policy</a>.
        </p>
      </div>
    </div>
  );
}
