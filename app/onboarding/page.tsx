'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const V = { bg:'#F0EDE8',card:'#FAFAF8',card2:'#F5F3EF',orange:'#E8541A',orangeLight:'#FFF0EB',orangeDark:'#C43E10',green:'#2D7A4F',greenLight:'#E8F5EE',amber:'#B8860B',amberLight:'#FFF8E6',red:'#D93025',text:'#1A1A1A',textMid:'#555',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)',star:'#FBBC04' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const barlow = "'Barlow Condensed',sans-serif";

const STEPS = ['Connecting to your Google profile','Reading your business information','Checking your opening hours','Scanning your reviews','Counting your photos','Checking your services','Analysing your visibility','Comparing against top profiles','Building your report'];

type Phase = 'analysing'|'score'|'preview'|'confirm'|'phone'|'fixing'|'done';

export default function OnboardingPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('analysing');
  const [aIdx, setAIdx] = useState(0);
  const [doneSt, setDoneSt] = useState<Set<number>>(new Set());
  const [audit, setAudit] = useState<any>(null);
  const [predicted, setPredicted] = useState(0);
  const [previews, setPreviews] = useState<any>(null);
  const [locData, setLocData] = useState<any>(null);
  const [desc, setDesc] = useState('');
  const [svcs, setSvcs] = useState<string[]>([]);
  const [post, setPost] = useState('');
  const [hrs, setHrs] = useState<any>(null);
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [fixLines, setFixLines] = useState<string[]>([]);
  const [counter, setCounter] = useState(0);
  const [finalCounter, setFinalCounter] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') === 'true') {
      const stored = sessionStorage.getItem('chocka_fix_data');
      if (stored) { try { const fd = JSON.parse(stored); setDesc(fd.desc||''); setSvcs(fd.svcs||[]); setPost(fd.post||''); setHrs(fd.hrs||null); setPreviews(fd); sessionStorage.removeItem('chocka_fix_data'); setPhase('fixing'); setTimeout(()=>runFixes(fd),100); return; } catch {} }
    }
    runAudit();
  }, []);

  useEffect(() => {
    if (phase !== 'analysing') return;
    const iv = setInterval(() => { setAIdx(p => { if (p < STEPS.length-1) { setDoneSt(d => { const n = new Set(Array.from(d)); n.add(p); return n; }); return p+1; } return p; }); }, 1300);
    return () => clearInterval(iv);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'score' || !audit) return;
    let n = 0; const iv = setInterval(() => { n++; setCounter(n); if (n >= audit.score) clearInterval(iv); }, 25);
    return () => clearInterval(iv);
  }, [phase, audit]);

  useEffect(() => {
    if (phase !== 'done' || !audit) return;
    let n = audit.score; const iv = setInterval(() => { n++; setFinalCounter(n); if (n >= predicted) clearInterval(iv); }, 35);
    return () => clearInterval(iv);
  }, [phase, audit, predicted]);

  async function runAudit() {
    try {
      const res = await fetch('/api/audit', { method: 'POST' });
      if (!res.ok) throw new Error('Audit failed');
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setAudit(d.audit); setPredicted(d.predicted); setPreviews(d.previews); setLocData(d.locationData);
      if (d.previews.description) setDesc(d.previews.description);
      if (d.previews.services) setSvcs(d.previews.services);
      if (d.previews.firstPost) setPost(d.previews.firstPost);
      if (d.previews.defaultHours) setHrs(d.previews.defaultHours);
      const delay = STEPS.length * 1300 + 400;
      setTimeout(() => { setDoneSt(x => { const n = new Set(Array.from(x)); n.add(STEPS.length-1); return n; }); setTimeout(() => setPhase('score'), 600); }, delay);
    } catch (e: any) {
      console.error('Audit failed:', e);
      setPhase('score');
      setAudit({ score: 0, maxScore: 100, band: 'Could not analyse', bandColour: V.red, items: [], fixes: [] });
      setPredicted(0);
    }
  }

  async function submitPhone() {
    const c = phone.replace(/\s/g, '');
    if (!c.match(/^(\+44|0)7\d{9}$/)) { setPhoneErr('Enter a valid UK mobile number'); return; }
    setPhoneErr('');
    const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: c, plan: 'monthly', referralCode: '' }) });
    if (res.ok) {
      const data = await res.json();
      if (data.url) { sessionStorage.setItem('chocka_fix_data', JSON.stringify({ desc, svcs, cats: previews?.categories, hrs, post, reviewPreview: previews?.reviewPreview })); window.location.href = data.url; return; }
    }
    setPhase('fixing'); await runFixes();
  }

  async function runFixes(overrides?: any) {
    const _d = overrides?.desc ?? desc, _s = overrides?.svcs ?? svcs, _p = overrides?.post ?? post, _h = overrides?.hrs ?? hrs, _c = overrides?.cats ?? previews?.categories, _r = overrides?.reviewPreview ?? previews?.reviewPreview;
    const body: any = {}; const lines: string[] = [];
    if (_d) { body.description = _d; lines.push('Updating your business description'); }
    if (_s?.length) { body.services = _s; lines.push(`Adding ${_s.length} services`); }
    if (_c?.length) { body.categories = _c; lines.push(`Adding ${_c.length} categories`); }
    if (_h) { body.hours = _h; lines.push('Setting your opening hours'); }
    if (_r) { body.replyToReviews = true; lines.push(`Replying to ${_r.totalUnreplied} reviews`); }
    if (_p) { body.firstPost = _p; lines.push('Scheduling your first post'); }
    lines.push('Setting up weekly automation');
    for (let i = 0; i < lines.length; i++) { setFixLines(p => [...p, lines[i]]); await new Promise(r => setTimeout(r, 1100)); }
    await fetch('/api/profile-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await new Promise(r => setTimeout(r, 400));
    setPhase('done');
  }

  // Shared styles
  const wrap: React.CSSProperties = { minHeight:'100vh',fontFamily:sans,display:'flex',justifyContent:'center' };
  const box: React.CSSProperties = { width:'100%',maxWidth:460,padding:'2rem 1.25rem' };
  const logoStyle: React.CSSProperties = { fontFamily:mono,fontWeight:500,fontSize:14,letterSpacing:'0.12em',color:V.orange };
  const card: React.CSSProperties = { background:V.card,borderRadius:16,padding:16,boxShadow:V.shadow,marginBottom:12 };
  const lbl: React.CSSProperties = { fontFamily:sans,fontSize:10,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:V.textSoft,marginBottom:8 };
  const btn: React.CSSProperties = { background:V.orange,color:'white',border:'none',padding:'14px 28px',borderRadius:8,fontSize:15,fontWeight:600,cursor:'pointer',width:'100%',fontFamily:sans,transition:'all .2s' };
  const btnGhost: React.CSSProperties = { background:'none',border:'none',color:V.textSoft,fontSize:13,cursor:'pointer',fontFamily:sans,width:'100%',padding:'10px',marginTop:4 };
  const sc = (s:number) => s>=76?V.green:s>=56?V.amber:s>=31?V.orange:V.red;

  /* ── ANALYSING ── */
  if (phase === 'analysing') {
    const progress = Math.min(((aIdx+1)/STEPS.length)*100,100);
    return (
      <div style={{minHeight:'100vh',fontFamily:sans,background:V.bg,color:V.text,display:'flex',justifyContent:'center'}}>
        <div style={{width:'100%',maxWidth:460,padding:'80px 1.25rem 2rem'}}>
          <div style={{marginBottom:32}}>
            <div style={logoStyle}>CHOCKA</div>
            <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text}}>Analysing your<br/>Google profile</h2>
            <p style={{fontSize:13,color:V.textSoft,marginTop:4}}>This takes about 15 seconds.</p>
          </div>
          <div style={{width:'100%',height:4,background:V.border,borderRadius:2,marginBottom:32,overflow:'hidden'}}>
            <div style={{width:`${progress}%`,height:'100%',background:V.orange,borderRadius:2,transition:'width 1.2s ease'}}/>
          </div>
          <div style={{...card,padding:20}}>
          {STEPS.map((t,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',opacity:i<=aIdx?1:0.15,transition:'opacity .5s',borderBottom:i<STEPS.length-1?`1px solid ${V.border}`:'none'}}>
              <span style={{width:20,textAlign:'center',fontSize:14,fontWeight:600,color:doneSt.has(i)?V.green:i===aIdx?V.orange:V.textSoft}}>
                {doneSt.has(i)?'✓':i===aIdx?'→':''}
              </span>
              <span style={{fontSize:14,fontWeight:i===aIdx?500:400,color:doneSt.has(i)?V.textSoft:V.text,transition:'color .3s'}}>{t}</span>
            </div>
          ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── SCORE REVEAL ── */
  if (phase === 'score' && audit) {
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>CHOCKA</div>
          <p style={{fontSize:13,color:V.textSoft,marginTop:4,marginBottom:24}}>Your Google profile report</p>

          <div style={{textAlign:'center',marginBottom:24}}>
            <div style={lbl}>Profile Score</div>
            <div style={{fontFamily:mono,fontSize:56,fontWeight:600,lineHeight:1,color:sc(audit.score)}}>
              {counter}<span style={{fontSize:18,color:V.textSoft}}>/100</span>
            </div>
            <div style={{fontFamily:barlow,fontSize:16,fontWeight:700,textTransform:'uppercase',color:sc(audit.score),marginTop:8,letterSpacing:'.02em'}}>{audit.band}</div>
          </div>

          <div style={{width:'100%',height:6,background:V.border,borderRadius:3,marginBottom:24,overflow:'hidden'}}>
            <div style={{width:`${audit.score}%`,height:'100%',background:sc(audit.score),borderRadius:3,transition:'width 1.5s ease'}}/>
          </div>

          {locData?.city && <p style={{fontSize:13,color:V.textSoft,textAlign:'center',marginBottom:20}}>Most tradespeople in {locData.city} score 40–60. Top businesses score 80+.</p>}

          <div style={card}>
            {audit.items.map((it:any) => (
              <div key={it.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${V.border}`}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:it.status==='green'?V.green:it.status==='amber'?V.amber:V.red,flexShrink:0}}/>
                  <span style={{fontSize:14,fontWeight:500}}>{it.label}</span>
                </div>
                <span style={{fontSize:12,color:V.textSoft,textAlign:'right',maxWidth:'48%'}}>{it.detail}</span>
              </div>
            ))}
          </div>

          {audit.fixes.length > 0 && <button onClick={()=>setPhase('preview')} style={btn}>See what we can fix right now →</button>}
        </div>
      </div>
    );
  }

  /* ── PREVIEW (editable) ── */
  if (phase === 'preview' && audit && previews) {
    const pts = (n:number) => <span style={{fontFamily:mono,fontSize:11,fontWeight:500,color:V.orange}}>+{n} pts</span>;
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>CHOCKA</div>
          <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text}}>Here&apos;s what<br/>we&apos;ll fix.</h2>
          <p style={{fontSize:13,color:V.textSoft,marginBottom:20}}>Tap any section to edit before we apply it.</p>

          {previews.description && (
            <div style={card}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:15,fontWeight:600}}>Business description</span>
                {pts(audit.fixes.find((f:any)=>f.key==='description')?.pointsGain||15)}
              </div>
              <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={5} style={{width:'100%',background:V.card2,color:V.text,border:`1px solid ${V.border}`,borderRadius:12,padding:12,fontSize:14,lineHeight:'1.6',resize:'vertical',fontFamily:sans,outline:'none',boxSizing:'border-box'}}/>
              <p style={{fontSize:11,color:V.textSoft,marginTop:4}}>Appears in your "From the business" section on Google.</p>
            </div>
          )}

          {previews.services && (
            <div style={card}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:15,fontWeight:600}}>Services ({svcs.length})</span>
                {pts(audit.fixes.find((f:any)=>f.key==='services')?.pointsGain||12)}
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {svcs.map((s,i) => <span key={i} style={{background:V.card2,borderRadius:20,padding:'6px 12px',fontSize:13}}>{s}</span>)}
              </div>
            </div>
          )}

          {previews.firstPost && (
            <div style={card}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:15,fontWeight:600}}>Your first post</span>
                {pts(5)}
              </div>
              <textarea value={post} onChange={e=>setPost(e.target.value)} rows={3} style={{width:'100%',background:V.card2,color:V.text,border:`1px solid ${V.border}`,borderRadius:12,padding:12,fontSize:14,lineHeight:'1.6',resize:'vertical',fontFamily:sans,outline:'none',boxSizing:'border-box'}}/>
              <p style={{fontSize:11,color:V.textSoft,marginTop:4}}>Goes live tomorrow at 10am.</p>
            </div>
          )}

          {previews.reviewPreview && (
            <div style={card}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:15,fontWeight:600}}>Review replies ({previews.reviewPreview.totalUnreplied})</span>
                {pts(audit.fixes.find((f:any)=>f.key==='reviews')?.pointsGain||8)}
              </div>
              <div style={{background:V.card2,borderRadius:12,padding:12,marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:4}}>
                  <span style={{fontWeight:600,fontSize:13}}>{previews.reviewPreview.reviewerName}</span>
                  <span style={{color:V.star,fontSize:11}}>{'\u2605'.repeat(previews.reviewPreview.rating)}<span style={{color:'#E0DDD8'}}>{'\u2605'.repeat(5-previews.reviewPreview.rating)}</span></span>
                </div>
                <p style={{fontSize:13,color:V.textMid,margin:0,lineHeight:1.4}}>{previews.reviewPreview.comment}</p>
              </div>
              <div style={{background:V.orangeLight,borderRadius:12,padding:12,borderLeft:`3px solid ${V.orange}`}}>
                <p style={{fontSize:11,color:V.orange,fontWeight:600,margin:'0 0 4px'}}>Our reply:</p>
                <p style={{fontSize:13,margin:0,lineHeight:1.4}}>{previews.reviewPreview.suggestedReply}</p>
              </div>
            </div>
          )}

          {previews.categories?.length > 0 && (
            <div style={card}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:15,fontWeight:600}}>Categories</span>
                {pts(audit.fixes.find((f:any)=>f.key==='categories')?.pointsGain||8)}
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {previews.categories.map((c:string,i:number) => <span key={i} style={{background:V.card2,borderRadius:20,padding:'6px 12px',fontSize:13}}>{c}</span>)}
              </div>
            </div>
          )}

          <div style={{textAlign:'center',padding:'16px 0 8px'}}>
            <div style={{fontSize:11,color:V.textSoft,textTransform:'uppercase',letterSpacing:'.08em'}}>Predicted score after fixes</div>
            <div style={{fontFamily:mono,fontSize:36,fontWeight:600,color:V.green,marginTop:4}}>{predicted}<span style={{fontSize:14,color:V.textSoft}}>/100</span></div>
            <div style={{fontSize:12,color:V.textSoft}}>Up from {audit.score}</div>
          </div>

          <button onClick={()=>setPhase('confirm')} style={btn}>Continue →</button>
        </div>
      </div>
    );
  }

  /* ── CONFIRM ── */
  if (phase === 'confirm' && audit && previews) {
    const fixes = [previews.description&&'Update business description',previews.services&&`Add ${svcs.length} services`,previews.categories?.length&&`Add ${previews.categories.length} categories`,previews.defaultHours&&'Set opening hours',previews.reviewPreview&&`Reply to ${previews.reviewPreview.totalUnreplied} reviews`,previews.firstPost&&'Schedule first post'].filter(Boolean) as string[];
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>CHOCKA</div>
          <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 20px',color:V.text}}>Ready?</h2>

          <div style={card}>
            <p style={{fontSize:15,fontWeight:600,margin:'0 0 12px'}}>We&apos;re about to make {fixes.length} changes to your live Google profile</p>
            {fixes.map((f,i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0'}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:V.orange,flexShrink:0}}/>
                <span style={{fontSize:14,color:V.textMid}}>{f}</span>
              </div>
            ))}
            <p style={{fontSize:12,color:V.textSoft,marginTop:12}}>Changes go live on Google. You can undo them from your Google Business dashboard.</p>
          </div>

          <button onClick={()=>setPhase('phone')} style={btn}>Apply these changes →</button>
          <button onClick={()=>setPhase('preview')} style={btnGhost}>Go back and edit</button>
        </div>
      </div>
    );
  }

  /* ── PHONE ── */
  if (phase === 'phone') {
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>CHOCKA</div>
          <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text}}>Nearly<br/>there.</h2>
          <p style={{fontSize:13,color:V.textSoft,marginBottom:20}}>One last thing before we fix your profile.</p>

          <div style={card}>
            <span style={{fontSize:15,fontWeight:600}}>Your mobile number</span>
            <p style={{fontSize:13,color:V.textSoft,margin:'4px 0 12px'}}>We&apos;ll text you stats every Monday and alert you about new reviews. Nothing else.</p>
            <input type="tel" value={phone} onChange={e=>{setPhone(e.target.value);setPhoneErr('')}} placeholder="07712 345 678"
              style={{width:'100%',padding:'12px 14px',border:phoneErr?`2px solid ${V.red}`:`1px solid ${V.border}`,borderRadius:12,fontSize:16,fontFamily:sans,background:V.card2,color:V.text,boxSizing:'border-box',outline:'none'}}/>
            {phoneErr && <p style={{color:V.red,fontSize:12,marginTop:4}}>{phoneErr}</p>}
          </div>

          <div style={{background:V.text,borderRadius:12,padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div>
              <div style={{fontFamily:mono,fontSize:22,fontWeight:600,color:'#fff'}}>£29<span style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>/month</span></div>
              <div style={{fontSize:11,color:'rgba(255,255,255,.3)'}}>Cancel anytime · No contract</div>
            </div>
            <div style={{fontSize:11,color:'rgba(255,255,255,.3)',textAlign:'right'}}>Billed monthly<br/>via Stripe</div>
          </div>

          <button onClick={submitPhone} style={btn}>Continue to payment →</button>
        </div>
      </div>
    );
  }

  /* ── FIXING ── */
  if (phase === 'fixing') {
    const fixTotal = [desc,svcs.length,previews?.categories?.length,hrs,previews?.reviewPreview,post].filter(Boolean).length+1;
    const fixProg = Math.min((fixLines.length/fixTotal)*100,100);
    return (
      <div style={{minHeight:'100vh',fontFamily:sans,background:V.bg,color:V.text,display:'flex',justifyContent:'center'}}>
        <div style={{width:'100%',maxWidth:460,padding:'80px 1.25rem 2rem'}}>
          <div style={{marginBottom:32}}>
            <div style={logoStyle}>CHOCKA</div>
            <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text}}>Fixing your<br/>profile</h2>
            <p style={{fontSize:13,color:V.textSoft,marginTop:4}}>Applying changes to Google now.</p>
          </div>
          <div style={{width:'100%',height:4,background:V.border,borderRadius:2,marginBottom:32,overflow:'hidden'}}>
            <div style={{width:`${fixProg}%`,height:'100%',background:V.green,borderRadius:2,transition:'width 1s ease'}}/>
          </div>
          <div style={{...card,padding:20}}>
          {fixLines.map((t,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:i<fixLines.length-1?`1px solid ${V.border}`:'none'}}>
              <span style={{width:20,textAlign:'center',fontSize:14,fontWeight:600,color:i<fixLines.length-1?V.green:V.orange}}>
                {i<fixLines.length-1?'✓':'→'}
              </span>
              <span style={{fontSize:14,color:i<fixLines.length-1?V.textSoft:V.text}}>{t}</span>
            </div>
          ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── DONE ── */
  if (phase === 'done' && audit) {
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>CHOCKA</div>
          <h2 style={{fontFamily:barlow,fontSize:32,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 24px',color:V.text}}>Sorted.</h2>

          <div style={{textAlign:'center',marginBottom:24}}>
            <div style={{fontFamily:mono,fontSize:56,fontWeight:600,lineHeight:1,color:sc(predicted)}}>
              {finalCounter}<span style={{fontSize:18,color:V.textSoft}}>/100</span>
            </div>
            <p style={{fontSize:13,color:V.textSoft,marginTop:8}}>Up from {audit.score}. We&apos;ve made {fixLines.length} improvements.</p>
          </div>

          <div style={card}>
            <div style={lbl}>What happens next</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <span style={{width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,background:V.orangeLight}}>📝</span>
                <div><div style={{fontSize:14,fontWeight:500}}>Tomorrow 10am</div><div style={{fontSize:12,color:V.textSoft}}>Your first post goes live on Google</div></div>
              </div>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <span style={{width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,background:V.greenLight}}>📊</span>
                <div><div style={{fontSize:14,fontWeight:500}}>Monday 9am</div><div style={{fontSize:12,color:V.textSoft}}>Your first stats text arrives</div></div>
              </div>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <span style={{width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,background:'#EEF2FF'}}>🔄</span>
                <div><div style={{fontSize:14,fontWeight:500}}>Every week</div><div style={{fontSize:12,color:V.textSoft}}>Posts, review replies, profile managed</div></div>
              </div>
            </div>
          </div>

          <p style={{textAlign:'center',fontSize:13,color:V.textSoft,margin:'16px 0'}}>You don&apos;t need to do anything. Your profile is managed.</p>
          <button onClick={()=>router.push('/dashboard')} style={btn}>Go to dashboard →</button>
        </div>
      </div>
    );
  }

  return null;
}
