'use client';

import { useEffect, useState } from 'react';

const bg = '#efede4';
const text = '#1a1a1a';
const orange = '#E8541A';
const secondary = '#4a4a4a';
const muted = '#6b6b6b';
const cardBg = '#f5f3eb';
const border = '#d8d4c3';
const label = '#8a8575';
const ringTrack = '#e5e2d4';
const ringProgress = '#22c55e';

const display = "'Barlow Condensed',sans-serif";
const body = "'DM Sans',sans-serif";
const caveat = "'Caveat',cursive";

export default function LoginPage() {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [score, setScore] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) sessionStorage.setItem('chocka_ref', ref);
    setErrorCode(params.get('error'));
  }, []);

  useEffect(() => {
    const target = 84;
    const duration = 1500;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setScore(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleGoogleLogin = () => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get('plan') || 'monthly';
    window.location.href = `/api/auth/callback/google?action=login&plan=${plan}`;
  };

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - score / 100);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800&family=DM+Sans:wght@400;500;600;700&family=Caveat:wght@400;700&display=swap');
      `}</style>
      <div style={{ minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',padding:'3rem 1.25rem 2rem',background:bg,fontFamily:body }}>
        <div style={{ width:'100%',maxWidth:540 }}>

          {/* Wordmark */}
          <a href="https://chocka.co.uk" style={{ display:'inline-block',fontFamily:display,fontWeight:800,fontSize:'1.25rem',color:orange,letterSpacing:'0.08em',marginBottom:'2.5rem',textDecoration:'none' }}>CHOCKA</a>

          {/* Hero */}
          <h1 style={{
            fontFamily:display,
            fontWeight:800,
            fontSize:'clamp(2.75rem, 9vw, 4.25rem)',
            textTransform:'uppercase',
            lineHeight:1,
            margin:'0 0 1rem',
            color:text,
          }}>
            SEE YOUR<br/>GOOGLE PROFILE<br/>SCORE.
          </h1>

          <p style={{ fontSize:'1.125rem',color:secondary,lineHeight:1.5,margin:'0 0 0.75rem',maxWidth:440 }}>
            Find out what&apos;s hurting your visibility and what to fix first. Takes 30 seconds.
          </p>

          {/* Social proof */}
          <div style={{
            display:'inline-block',
            fontSize:'0.8125rem',
            color:muted,
            background:'rgba(0,0,0,0.03)',
            padding:'0.3rem 0.7rem',
            borderRadius:'999px',
            marginBottom:'2rem',
          }}>
            7,101 businesses scored across the North East
          </div>

          {/* Error banner */}
          {errorCode === 'scope_missing' && (
            <div role="alert" style={{
              background:'#fdecea',
              border:`1px solid #f5c2bb`,
              borderRadius:'0.875rem',
              padding:'1rem 1.125rem',
              marginBottom:'1.5rem',
              fontSize:'0.9375rem',
              color:'#7a1d11',
              lineHeight:1.5,
            }}>
              Google didn&apos;t grant access to your Business Profile. Please try again and make sure you approve all permissions on Google&apos;s screen. If it keeps happening, email <a href="mailto:team@chocka.co.uk" style={{ color:'#7a1d11',textDecoration:'underline' }}>team@chocka.co.uk</a> and we&apos;ll help.
            </div>
          )}

          {/* Card */}
          <div style={{
            background:cardBg,
            border:`1px solid ${border}`,
            borderRadius:'1.25rem',
            padding:'2rem 1.5rem',
          }}>

            {/* Score ring */}
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',marginBottom:'1.5rem' }}>
              <div style={{ position:'relative',width:80,height:80 }}>
                <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform:'rotate(-90deg)' }}>
                  <circle cx="40" cy="40" r={radius} fill="none" stroke={ringTrack} strokeWidth="8" />
                  <circle
                    cx="40" cy="40" r={radius}
                    fill="none"
                    stroke={ringProgress}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashoffset}
                  />
                </svg>
                <div style={{
                  position:'absolute',inset:0,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontFamily:body,fontWeight:700,fontSize:'1.375rem',color:text,
                }}>
                  {score}
                </div>
              </div>
              <div style={{ fontSize:'0.75rem',color:muted,marginTop:'0.5rem' }}>
                Average score after 8 weeks
              </div>
            </div>

            {/* Label */}
            <div style={{
              fontSize:'0.6875rem',
              fontWeight:600,
              textTransform:'uppercase',
              letterSpacing:'0.15em',
              color:label,
              marginBottom:'1.25rem',
            }}>What you&apos;ll get</div>

            {/* Feature rows */}
            <div style={{ display:'flex',flexDirection:'column',gap:16,marginBottom:'1.75rem' }}>
              {/* Score */}
              <div style={{ display:'flex',alignItems:'flex-start',gap:12 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink:0,marginTop:2 }}>
                  <circle cx="10" cy="10" r="9" fill="none" stroke={muted} strokeWidth="1.5"/>
                  <circle cx="10" cy="10" r="5" fill="none" stroke={muted} strokeWidth="1.5"/>
                  <circle cx="10" cy="10" r="1.5" fill={muted}/>
                </svg>
                <div>
                  <div style={{ fontSize:'0.9375rem',fontWeight:600,color:text }}>Your score out of 100</div>
                  <div style={{ fontSize:'0.8125rem',color:muted,marginTop:2 }}>See how you rank against local competitors</div>
                </div>
              </div>
              {/* Issues */}
              <div style={{ display:'flex',alignItems:'flex-start',gap:12 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink:0,marginTop:2 }}>
                  <path d="M10 3L18 17H2L10 3Z" fill="none" stroke={muted} strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="10" y1="9" x2="10" y2="12.5" stroke={muted} strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="10" cy="14.5" r="0.75" fill={muted}/>
                </svg>
                <div>
                  <div style={{ fontSize:'0.9375rem',fontWeight:600,color:text }}>What&apos;s losing you customers</div>
                  <div style={{ fontSize:'0.8125rem',color:muted,marginTop:2 }}>Missing photos, reviews, response time, and more</div>
                </div>
              </div>
              {/* Fix priority */}
              <div style={{ display:'flex',alignItems:'flex-start',gap:12 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink:0,marginTop:2 }}>
                  <path d="M10 16V4M10 4L5 9M10 4L15 9" fill="none" stroke={muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div>
                  <div style={{ fontSize:'0.9375rem',fontWeight:600,color:text }}>What to fix first</div>
                  <div style={{ fontSize:'0.8125rem',color:muted,marginTop:2 }}>Ranked by impact, so you&apos;re not wasting time</div>
                </div>
              </div>
            </div>

            {/* CTA */}
            <button onClick={handleGoogleLogin} style={{
              display:'flex',alignItems:'center',justifyContent:'center',gap:10,
              width:'100%',padding:'1rem',borderRadius:'0.875rem',
              background:text,color:'#fff',border:'none',
              fontFamily:body,fontSize:'1rem',fontWeight:600,cursor:'pointer',
              transition:'background .2s',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = orange; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = text; }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Connect Google — see your score
            </button>

            {/* Microcopy */}
            <p style={{ textAlign:'center',fontSize:'0.8125rem',color:muted,margin:'0.75rem 0 0' }}>
              Free · No card required · 30 seconds
            </p>

            {/* Visible security line */}
            <p style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontSize:'0.8125rem',color:muted,margin:'0.5rem 0 0' }}>
              <svg width="12" height="12" viewBox="0 0 16 16" style={{ flexShrink:0 }}>
                <rect x="4.5" y="7" width="7" height="5.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              We only access your Google Business Profile. Not your Gmail, Drive, or calendar.
            </p>

            {/* Privacy accordion */}
            <div style={{
              marginTop:'1.25rem',
              background:'#fff',
              border:`1px solid ${border}`,
              borderRadius:'0.75rem',
              overflow:'hidden',
            }}>
              <button
                onClick={() => setPrivacyOpen(!privacyOpen)}
                style={{
                  display:'flex',alignItems:'center',justifyContent:'space-between',
                  width:'100%',padding:'0.75rem 1rem',background:'transparent',border:'none',
                  cursor:'pointer',fontFamily:body,fontSize:'0.8125rem',color:secondary,
                }}
              >
                <span style={{ display:'flex',alignItems:'center',gap:8 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink:0 }}>
                    <rect x="4.5" y="7" width="7" height="5.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  What signing in actually does
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink:0,transform:privacyOpen ? 'rotate(180deg)' : 'none',transition:'transform .2s' }}>
                  <path d="M3 5L6 8L9 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {privacyOpen && (
                <div style={{ padding:'0 1rem 1rem',display:'flex',flexDirection:'column',gap:12 }}>
                  <p style={{ fontSize:'0.8125rem',color:secondary,margin:0,lineHeight:1.55 }}>
                    You sign in with Google and give Chocka permission to manage your Google Business Profile, so we can actually read your score and, if you sign up later, do the work.
                  </p>
                  <p style={{ fontSize:'0.8125rem',color:secondary,margin:0,lineHeight:1.55 }}>
                    Chocka only gets access to your Google Business Profile. Not your Gmail, Drive, calendar, or anything else. Google enforces this.
                  </p>
                  <p style={{ fontSize:'0.8125rem',color:secondary,margin:0,lineHeight:1.55 }}>
                    You can remove our access any time at{' '}
                    <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color:orange,textDecoration:'none' }}>
                      myaccount.google.com/permissions
                    </a>.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Signature */}
          <div style={{ textAlign:'center',marginTop:'2rem' }}>
            <div style={{ fontFamily:caveat,fontSize:'2rem',color:orange }}>Liam</div>
            <p style={{ fontSize:'0.8125rem',color:muted,margin:'0.25rem 0 0' }}>
              Built in the North East · team@chocka.co.uk
            </p>
            <p style={{ fontSize:'0.8125rem',color:muted,margin:'0.5rem 0 0' }}>
              <a href="/privacy" style={{ color:muted,textDecoration:'underline' }}>Privacy</a> · <a href="/terms" style={{ color:muted,textDecoration:'underline' }}>Terms</a>
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
