'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/* ── Design tokens ── */
const T = {
  slate: '#2A2520',
  cream: '#F8F6F3',
  orange: '#D4622B',
  gold: '#E7C36A',
  border: 'rgba(42,37,32,0.04)',
  subtle: 'rgba(42,37,32,0.06)',
  muted: '#A09A93',
  green: '#2D8B4E',
  red: '#D93025',
  amber: '#E7C36A',
  white: '#FFFFFF',
  text: '#5A554F',
  warmBg: '#F0EDE8',
};

const STEPS_TEXT = [
  'Connecting to your Google profile',
  'Reading your business information',
  'Checking your opening hours',
  'Scanning your reviews',
  'Counting your photos',
  'Checking your services',
  'Analysing your visibility',
  'Comparing against top profiles',
  'Building your report',
];

type Phase = 'analysing' | 'score' | 'preview' | 'confirm' | 'phone' | 'fixing' | 'done';

export default function OnboardingPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('analysing');
  const [aIdx, setAIdx] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());

  // Data
  const [audit, setAudit] = useState<any>(null);
  const [predicted, setPredicted] = useState(0);
  const [previews, setPreviews] = useState<any>(null);
  const [locData, setLocData] = useState<any>(null);

  // Editable
  const [desc, setDesc] = useState('');
  const [svcs, setSvcs] = useState<string[]>([]);
  const [post, setPost] = useState('');
  const [hrs, setHrs] = useState<any>(null);

  // Phone
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState('');

  // Progress
  const [fixLines, setFixLines] = useState<string[]>([]);
  const [counter, setCounter] = useState(0);
  const [finalCounter, setFinalCounter] = useState(0);

  // Run audit on mount OR resume fixing if returning from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') === 'true') {
      // Returning from Stripe checkout - resume fixing
      const stored = sessionStorage.getItem('chocka_fix_data');
      if (stored) {
        try {
          const fixData = JSON.parse(stored);
          setDesc(fixData.desc || '');
          setSvcs(fixData.svcs || []);
          setPost(fixData.post || '');
          setHrs(fixData.hrs || null);
          sessionStorage.removeItem('chocka_fix_data');
          setPhase('fixing');
          setTimeout(() => runFixes(fixData), 100);
          return;
        } catch {}
      }
    }
    runAudit();
  }, []);

  // Analysis step animation
  useEffect(() => {
    if (phase !== 'analysing') return;
    const iv = setInterval(() => {
      setAIdx(p => {
        if (p < STEPS_TEXT.length - 1) {
          setDone(d => { const n = new Set(Array.from(d)); n.add(p); return n; });
          return p + 1;
        }
        return p;
      });
    }, 1300);
    return () => clearInterval(iv);
  }, [phase]);

  // Score counter animation
  useEffect(() => {
    if (phase !== 'score' || !audit) return;
    let n = 0;
    const iv = setInterval(() => { n++; setCounter(n); if (n >= audit.score) clearInterval(iv); }, 25);
    return () => clearInterval(iv);
  }, [phase, audit]);

  // Final score counter
  useEffect(() => {
    if (phase !== 'done' || !audit) return;
    let n = audit.score;
    const iv = setInterval(() => { n++; setFinalCounter(n); if (n >= predicted) clearInterval(iv); }, 35);
    return () => clearInterval(iv);
  }, [phase, audit, predicted]);

  async function runAudit() {
    try {
      const res = await fetch('/api/audit', { method: 'POST' });
      if (!res.ok) throw new Error('Audit failed');
      const d = await res.json();
      setAudit(d.audit); setPredicted(d.predicted); setPreviews(d.previews); setLocData(d.locationData);
      if (d.previews.description) setDesc(d.previews.description);
      if (d.previews.services) setSvcs(d.previews.services);
      if (d.previews.firstPost) setPost(d.previews.firstPost);
      if (d.previews.defaultHours) setHrs(d.previews.defaultHours);
      // Wait for animation then transition
      const delay = STEPS_TEXT.length * 1300 + 400;
      setTimeout(() => {
        setDone(x => { const n = new Set(Array.from(x)); n.add(STEPS_TEXT.length - 1); return n; });
        setTimeout(() => setPhase('score'), 600);
      }, delay);
    } catch (e) { console.error(e); }
  }

  async function submitPhone() {
    const c = phone.replace(/\s/g, '');
    if (!c.match(/^(\+44|0)7\d{9}$/)) { setPhoneErr('Enter a valid UK mobile number'); return; }
    setPhoneErr('');
    // Save phone + create Stripe checkout
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: c, plan: 'monthly', referralCode: '' }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.url) {
        // Store fix data in sessionStorage so we can apply after payment
        sessionStorage.setItem('chocka_fix_data', JSON.stringify({ desc, svcs, cats: previews?.categories, hrs, post, reviewPreview: previews?.reviewPreview }));
        window.location.href = data.url;
        return;
      }
    }
    // If checkout fails, proceed anyway (for testing)
    setPhase('fixing');
    await runFixes();
  }

  async function runFixes(overrides?: any) {
    const _desc = overrides?.desc ?? desc;
    const _svcs = overrides?.svcs ?? svcs;
    const _post = overrides?.post ?? post;
    const _hrs = overrides?.hrs ?? hrs;
    const _cats = overrides?.cats ?? previews?.categories;
    const _reviewPreview = overrides?.reviewPreview ?? previews?.reviewPreview;

    const body: any = {};
    const lines: string[] = [];
    if (_desc) { body.description = _desc; lines.push('Updating your business description'); }
    if (_svcs?.length) { body.services = _svcs; lines.push(`Adding ${_svcs.length} services`); }
    if (_cats?.length) { body.categories = _cats; lines.push(`Adding ${_cats.length} categories`); }
    if (_hrs) { body.hours = _hrs; lines.push('Setting your opening hours'); }
    if (_reviewPreview) { body.replyToReviews = true; lines.push(`Replying to ${_reviewPreview.totalUnreplied} reviews`); }
    if (_post) { body.firstPost = _post; lines.push('Scheduling your first post for tomorrow 10am'); }
    lines.push('Setting up weekly stats');
    for (let i = 0; i < lines.length; i++) {
      setFixLines(p => [...p, lines[i]]);
      await new Promise(r => setTimeout(r, 1100));
    }
    await fetch('/api/profile-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await new Promise(r => setTimeout(r, 400));
    setPhase('done');
  }

  /* ── Shared styles ── */
  const wrap: React.CSSProperties = { minHeight: '100vh', background: T.cream, color: T.slate, fontFamily: "'Inter', system-ui, sans-serif" };
  const box: React.CSSProperties = { maxWidth: 480, margin: '0 auto', padding: '2rem 1.5rem' };
  const logo: React.CSSProperties = { fontFamily: "'Cabinet Grotesk', sans-serif", fontWeight: 800, fontSize: '1rem', letterSpacing: '3px', color: T.orange, margin: 0, textTransform: 'uppercase' as const };
  const sub: React.CSSProperties = { color: T.muted, fontSize: '0.88rem', margin: '0.15rem 0 2rem' };
  const btn: React.CSSProperties = { background: T.slate, color: T.cream, border: 'none', padding: '0.9rem 2rem', borderRadius: 100, fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', width: '100%', fontFamily: "'Inter', system-ui", boxShadow: '0 4px 24px rgba(42,37,32,.15)' };
  const card: React.CSSProperties = { background: T.white, borderRadius: 24, padding: '1.25rem', marginBottom: '0.75rem', boxShadow: '0 2px 16px rgba(42,37,32,.04)' };
  const ta: React.CSSProperties = { width: '100%', background: T.cream, color: T.slate, border: 'none', borderRadius: 16, padding: '0.75rem', fontSize: '0.85rem', lineHeight: '1.6', resize: 'vertical', fontFamily: "'Inter', system-ui", boxShadow: 'inset 0 1px 4px rgba(42,37,32,.06)' };
  const hint: React.CSSProperties = { color: T.muted, fontSize: '0.73rem', marginTop: '0.35rem' };
  const dot = (c: string): React.CSSProperties => ({ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 });

  /* ── ANALYSING ── */
  if (phase === 'analysing') {
    const progress = Math.min(((aIdx + 1) / STEPS_TEXT.length) * 100, 100);
    return (
      <div style={{ ...wrap, background: T.slate, color: T.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={box}>
          <h1 style={{ ...logo, color: T.orange, fontSize: '1.7rem', textAlign: 'center' }}>Chocka</h1>
          <p style={{ ...sub, color: 'rgba(248,246,243,0.45)', textAlign: 'center' }}>Analysing your Google profile</p>
          <div style={{ width: '100%', height: 3, background: 'rgba(248,246,243,0.08)', borderRadius: 2, marginBottom: '1.5rem', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: T.orange, borderRadius: 2, transition: 'width 1.2s ease' }} />
          </div>
          {STEPS_TEXT.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.5rem 0', opacity: i <= aIdx ? 1 : 0.12, transition: 'opacity 0.5s' }}>
              <span style={{ width: 18, textAlign: 'center', fontSize: '0.8rem', color: done.has(i) ? T.green : T.gold }}>
                {done.has(i) ? '\u2713' : i === aIdx ? '\u2022' : ''}
              </span>
              <span style={{ fontSize: '0.88rem', color: done.has(i) ? 'rgba(248,246,243,0.35)' : T.cream, transition: 'color 0.3s' }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── SCORE REVEAL ── */
  if (phase === 'score' && audit) {
    const bc = audit.score >= 56 ? T.green : audit.score >= 31 ? T.amber : T.red;
    return (
      <div style={wrap}>
        <div style={box}>
          <h1 style={logo}>Chocka</h1>
          <p style={sub}>Your Google profile report</p>
          <div style={{ textAlign: 'center', marginBottom: '1.8rem' }}>
            <p style={{ color: T.muted, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Profile score</p>
            <div style={{ fontSize: '4.2rem', fontWeight: 800, color: bc, lineHeight: 1, letterSpacing: '-0.03em' }}>
              {counter}<span style={{ fontSize: '1.6rem', color: T.muted, fontWeight: 500 }}>/100</span>
            </div>
            <p style={{ color: bc, fontSize: '0.88rem', fontWeight: 500, marginTop: '0.4rem' }}>{audit.band}</p>
          </div>
          <div style={{ width: '100%', height: 5, background: T.border, borderRadius: 3, marginBottom: '1.8rem', overflow: 'hidden' }}>
            <div style={{ width: `${audit.score}%`, height: '100%', background: bc, borderRadius: 3, transition: 'width 1.5s ease' }} />
          </div>
          {locData?.city && <p style={{ color: T.muted, fontSize: '0.83rem', textAlign: 'center', marginBottom: '1.8rem' }}>Most tradespeople in {locData.city} score 40\u201360. Top businesses score 80+.</p>}
          {audit.items.map((it: any) => (
            <div key={it.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: `1px solid ${T.subtle}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={dot(it.status === 'green' ? T.green : it.status === 'amber' ? T.amber : T.red)} />
                <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{it.label}</span>
              </div>
              <span style={{ color: T.muted, fontSize: '0.78rem', textAlign: 'right', maxWidth: '48%' }}>{it.detail}</span>
            </div>
          ))}
          {audit.fixes.length > 0 && (
            <button onClick={() => setPhase('preview')} style={{ ...btn, marginTop: '1.5rem' }}>See what we can fix right now</button>
          )}
        </div>
      </div>
    );
  }

  /* ── PREVIEW (editable) ── */
  if (phase === 'preview' && audit && previews) {
    const pts = (n: number) => <span style={{ color: T.orange, fontSize: '0.73rem', fontWeight: 600 }}>+{n} pts</span>;
    return (
      <div style={wrap}>
        <div style={box}>
          <h1 style={logo}>Chocka</h1>
          <p style={sub}>Here's what we'll do right now</p>

          {previews.description && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 600, margin: 0 }}>Business description</h3>
                {pts(audit.fixes.find((f: any) => f.key === 'description')?.pointsGain || 15)}
              </div>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5} style={ta} />
              <p style={hint}>Tap to edit. Appears in your "From the business" section.</p>
            </div>
          )}

          {previews.services && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 600, margin: 0 }}>Services ({svcs.length})</h3>
                {pts(audit.fixes.find((f: any) => f.key === 'services')?.pointsGain || 12)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {svcs.map((s, i) => (
                  <span key={i} style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>{s}</span>
                ))}
              </div>
              <p style={hint}>Services customers will find when searching for your trade.</p>
            </div>
          )}

          {previews.firstPost && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 600, margin: 0 }}>Your first post</h3>
                {pts(5)}
              </div>
              <textarea value={post} onChange={e => setPost(e.target.value)} rows={3} style={ta} />
              <p style={hint}>Goes live tomorrow at 10am. Edit however you like.</p>
            </div>
          )}

          {previews.reviewPreview && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 600, margin: 0 }}>Review replies ({previews.reviewPreview.totalUnreplied} unanswered)</h3>
                {pts(audit.fixes.find((f: any) => f.key === 'reviews')?.pointsGain || 8)}
              </div>
              <div style={{ background: T.cream, borderRadius: 8, padding: '0.7rem', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.2rem' }}>
                  {[1,2,3,4,5].map(n => <span key={n} style={{ color: n <= previews.reviewPreview.rating ? T.gold : T.border, fontSize: '0.85rem' }}>{'\u2605'}</span>)}
                  <span style={{ color: T.muted, fontSize: '0.78rem', marginLeft: '0.3rem' }}>{previews.reviewPreview.reviewerName}</span>
                </div>
                <p style={{ fontSize: '0.83rem', margin: '0.25rem 0 0' }}>{previews.reviewPreview.comment}</p>
              </div>
              <div style={{ background: 'rgba(212,98,43,0.05)', borderRadius: 8, padding: '0.7rem', borderLeft: `3px solid ${T.orange}` }}>
                <p style={{ fontSize: '0.73rem', color: T.orange, fontWeight: 600, margin: '0 0 0.2rem' }}>Our reply:</p>
                <p style={{ fontSize: '0.83rem', margin: 0 }}>{previews.reviewPreview.suggestedReply}</p>
              </div>
              <p style={hint}>We'll reply to all {previews.reviewPreview.totalUnreplied} reviews in this style. You can review them from your dashboard.</p>
            </div>
          )}

          {previews.categories && previews.categories.length > 0 && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 600, margin: 0 }}>Additional categories</h3>
                {pts(audit.fixes.find((f: any) => f.key === 'categories')?.pointsGain || 8)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {previews.categories.map((c: string, i: number) => (
                  <span key={i} style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>{c}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', padding: '1.2rem 0', marginBottom: '0.5rem' }}>
            <p style={{ color: T.muted, fontSize: '0.83rem', marginBottom: '0.2rem' }}>Predicted score after fixes</p>
            <span style={{ fontSize: '2.3rem', fontWeight: 800, color: T.green, letterSpacing: '-0.02em' }}>{predicted}</span>
            <span style={{ fontSize: '0.95rem', color: T.muted }}>/100</span>
            <p style={{ color: T.muted, fontSize: '0.78rem', marginTop: '0.2rem' }}>Up from {audit.score}</p>
          </div>

          <button onClick={() => setPhase('confirm')} style={btn}>Continue</button>
        </div>
      </div>
    );
  }

  /* ── CONFIRM ── */
  if (phase === 'confirm' && audit && previews) {
    const fixCount = [previews.description, previews.services, previews.firstPost, previews.reviewPreview, previews.categories?.length, previews.defaultHours].filter(Boolean).length;
    return (
      <div style={wrap}>
        <div style={box}>
          <h1 style={logo}>Chocka</h1>
          <p style={sub}>Ready to go?</p>

          <div style={card}>
            <p style={{ fontSize: '0.92rem', fontWeight: 600, color: T.slate, margin: '0 0 0.75rem' }}>
              We are about to make {fixCount} changes to your live Google Business Profile
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
              {previews.description && <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0, paddingLeft: '0.75rem', borderLeft: `2px solid ${T.orange}` }}>Update your business description</p>}
              {previews.services && <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0, paddingLeft: '0.75rem', borderLeft: `2px solid ${T.orange}` }}>Add {svcs.length} services</p>}
              {previews.categories?.length > 0 && <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0, paddingLeft: '0.75rem', borderLeft: `2px solid ${T.orange}` }}>Add {previews.categories.length} categories</p>}
              {previews.defaultHours && <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0, paddingLeft: '0.75rem', borderLeft: `2px solid ${T.orange}` }}>Set your opening hours</p>}
              {previews.reviewPreview && <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0, paddingLeft: '0.75rem', borderLeft: `2px solid ${T.orange}` }}>Reply to {previews.reviewPreview.totalUnreplied} reviews</p>}
              {previews.firstPost && <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0, paddingLeft: '0.75rem', borderLeft: `2px solid ${T.orange}` }}>Schedule your first post</p>}
            </div>
            <p style={{ fontSize: '0.8rem', color: T.muted, margin: 0 }}>
              These changes go live on your Google profile. You can undo them from your Google Business dashboard if needed.
            </p>
          </div>

          <button onClick={() => setPhase('phone')} style={{ ...btn, marginTop: '0.5rem' }}>
            Apply these changes
          </button>
          <button onClick={() => setPhase('preview')} style={{ background: 'none', border: 'none', color: T.muted, fontSize: '0.83rem', cursor: 'pointer', fontFamily: 'inherit', width: '100%', padding: '0.75rem', marginTop: '0.25rem' }}>
            Go back and edit
          </button>
        </div>
      </div>
    );
  }

  /* ── PHONE ── */
  if (phase === 'phone') {
    return (
      <div style={wrap}>
        <div style={box}>
          <h1 style={logo}>Chocka</h1>
          <p style={sub}>Nearly there</p>
          <div style={card}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.25rem' }}>Your mobile number</h3>
            <p style={{ color: T.muted, fontSize: '0.83rem', marginBottom: '0.8rem' }}>We'll text you stats every Monday and alert you about new reviews. Nothing else.</p>
            <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setPhoneErr(''); }} placeholder="07712 345 678"
              style={{ width: '100%', padding: '0.8rem', border: `1px solid ${phoneErr ? T.red : T.border}`, borderRadius: 8, fontSize: '1rem', fontFamily: 'inherit', background: T.cream, color: T.slate, boxSizing: 'border-box' }} />
            {phoneErr && <p style={{ color: T.red, fontSize: '0.78rem', marginTop: '0.3rem' }}>{phoneErr}</p>}
          </div>
          <p style={{ textAlign: 'center', color: T.muted, fontSize: '0.83rem', padding: '1rem 0' }}>&pound;29/month &middot; Cancel anytime</p>
          <button onClick={submitPhone} style={btn}>Continue to payment</button>
        </div>
      </div>
    );
  }

  /* ── FIXING ── */
  if (phase === 'fixing') {
    const fixTotal = [desc, svcs.length, previews?.categories?.length, hrs, previews?.reviewPreview, post].filter(Boolean).length + 1;
    const fixProg = Math.min((fixLines.length / fixTotal) * 100, 100);
    return (
      <div style={{ ...wrap, background: T.slate, color: T.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={box}>
          <h1 style={{ ...logo, color: T.orange, fontSize: '1.7rem', textAlign: 'center' }}>Chocka</h1>
          <p style={{ ...sub, color: 'rgba(248,246,243,0.45)', textAlign: 'center' }}>Fixing your profile</p>
          <div style={{ width: '100%', height: 3, background: 'rgba(248,246,243,0.08)', borderRadius: 2, marginBottom: '1.5rem', overflow: 'hidden' }}>
            <div style={{ width: `${fixProg}%`, height: '100%', background: T.green, borderRadius: 2, transition: 'width 1s ease' }} />
          </div>
          {fixLines.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.5rem 0' }}>
              <span style={{ color: i < fixLines.length - 1 ? T.green : T.gold, fontSize: '0.85rem', width: 18, textAlign: 'center' }}>
                {i < fixLines.length - 1 ? '\u2713' : '\u2022'}
              </span>
              <span style={{ fontSize: '0.88rem', color: i < fixLines.length - 1 ? 'rgba(248,246,243,0.35)' : T.cream }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── DONE ── */
  if (phase === 'done' && audit) {
    const bc = predicted >= 56 ? T.green : predicted >= 31 ? T.amber : T.red;
    return (
      <div style={wrap}>
        <div style={box}>
          <h1 style={logo}>Chocka</h1>
          <p style={sub}>Your profile is sorted</p>
          <div style={{ textAlign: 'center', marginBottom: '1.8rem' }}>
            <div style={{ fontSize: '4.2rem', fontWeight: 800, color: bc, lineHeight: 1, letterSpacing: '-0.03em' }}>
              {finalCounter}<span style={{ fontSize: '1.6rem', color: T.muted, fontWeight: 500 }}>/100</span>
            </div>
            <p style={{ color: T.muted, fontSize: '0.88rem', marginTop: '0.6rem' }}>Up from {audit.score}. We've made {fixLines.length} improvements to your Google profile.</p>
          </div>
          <div style={card}>
            <h3 style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '0.6rem' }}>What happens next</h3>
            <p style={{ fontSize: '0.83rem', color: T.muted, margin: '0 0 0.4rem' }}><strong style={{ color: T.slate }}>Tomorrow 10am</strong> &mdash; your first post goes live</p>
            <p style={{ fontSize: '0.83rem', color: T.muted, margin: '0 0 0.4rem' }}><strong style={{ color: T.slate }}>Monday 7am</strong> &mdash; your first stats text arrives</p>
            <p style={{ fontSize: '0.83rem', color: T.muted, margin: 0 }}><strong style={{ color: T.slate }}>Every week</strong> &mdash; we post, reply to reviews, keep your profile active</p>
          </div>
          <p style={{ textAlign: 'center', color: T.muted, fontSize: '0.83rem', marginBottom: '1.2rem' }}>You don't need to do anything. Your profile is managed.</p>
          <button onClick={() => router.push('/dashboard')} style={btn}>Go to dashboard</button>
        </div>
      </div>
    );
  }

  return null;
}
