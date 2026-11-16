'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/lib/tenant-context';
import ImproveListing from '@/components/ImproveListing';
import VoiceFields, { draftFromVoice, draftIsEmpty, EMPTY_DRAFT, type VoiceDraft } from '@/components/VoiceFields';

const V = { bg:'#F0EDE8',card:'#FAFAF8',card2:'#F5F3EF',orange:'var(--brand-strong)',orangeLight:'var(--brand-strong-light)',orangeDark:'var(--brand-strong-dark)',green:'#2D7A4F',greenLight:'#E8F5EE',amber:'#B8860B',amberLight:'#FFF8E6',red:'#D93025',text:'#1A1A1A',textMid:'#555',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)',star:'#FBBC04' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const barlow = "'Barlow Condensed',sans-serif";

const STEPS = ['Connecting to your Google profile','Reading your business information','Checking your opening hours','Scanning your reviews','Counting your photos','Checking your services','Analysing your visibility','Comparing against top profiles','Building your report'];

type Phase = 'select'|'analysing'|'score'|'voice'|'phone'|'improve';

export default function OnboardingPage() {
  const router = useRouter();
  const tenant = useTenant();
  const [phase, setPhase] = useState<Phase>('analysing');
  const [aIdx, setAIdx] = useState(0);
  const [doneSt, setDoneSt] = useState<Set<number>>(new Set());
  const [audit, setAudit] = useState<any>(null);
  // What Google holds for hours now, and the gaps we do not fill (app/api/audit).
  const [hoursInfo, setHoursInfo] = useState<any>(null);
  const [manual, setManual] = useState<any[]>([]);
  const [locData, setLocData] = useState<any>(null);
  const [phone, setPhone] = useState('');
  // Voice: a few short optional questions about how the shop sounds (lib/voice.ts).
  // Only offered when a shop is linked to this account, which /api/voice decides.
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft>(EMPTY_DRAFT);
  const [voiceErr, setVoiceErr] = useState('');
  const [voiceSaving, setVoiceSaving] = useState(false);

  // Automation opt-in, shown only on a free tenant (see the users insert in the
  // OAuth callback). Both start FALSE and match the row as created, so a
  // retailer who never touches them is left exactly as they were made — the
  // screen cannot silently grant something by being skipped.
  const freeTenant = tenant.priceMonthlyGbp === 0;
  const [optPost, setOptPost] = useState(false);
  const [optReply, setOptReply] = useState(false);
  const [phoneErr, setPhoneErr] = useState('');
  const [counter, setCounter] = useState(0);
  // Back from paying (paid brand only): go straight to the changes once the listing has been read.
  const [resumeAtImprove, setResumeAtImprove] = useState(false);
  const [auditError, setAuditError] = useState<string|false>(false);
  const [auditCode, setAuditCode] = useState<string>('');
  const [auditReady, setAuditReady] = useState(false);
  const [listings, setListings] = useState<any[]|null>(null);
  const [listingsError, setListingsError] = useState<string>('');
  // Ownership detection: which shop we expected (invited shops) and help if we can't see it.
  const [listingsHelp, setListingsHelp] = useState<{title:string;message:string;nextStep:string}|null>(null);
  const [expectedShop, setExpectedShop] = useState<{name:string;town:string|null}|null>(null);
  const [selecting, setSelecting] = useState<string>('');
  const [wrongAccountPath, setWrongAccountPath] = useState<string>('');
  const [returnTo, setReturnTo] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') === 'true') setResumeAtImprove(true);
    // Manager of several listings (or a settings-initiated "change listing") —
    // pick which one to set up before auditing anything.
    if (params.get('select') === '1') {
      setReturnTo(params.get('return') || '');
      setPhase('select');
      loadListings();
      return;
    }
    // The OAuth callback could not enumerate this account's listings — Google
    // threw rather than answering "none". No profile is bound, so running the
    // audit here would return no_profile and render "No Google Business Profile
    // found", which is the wrong thing to tell someone whose listing is fine.
    // Show the retryable state instead, and return before runAudit().
    if (params.get('connect') === 'failed') {
      setAuditCode('connect_failed');
      setAuditError('Could not reach Google');
      return;
    }
    runAudit();
  }, []);

  useEffect(() => {
    if (phase !== 'analysing') return;
    if (auditReady) {
      setDoneSt(new Set(STEPS.map((_, i) => i)));
      setAIdx(STEPS.length - 1);
      const t = setTimeout(() => setPhase(resumeAtImprove ? 'improve' : 'score'), 600);
      return () => clearTimeout(t);
    }
    const iv = setInterval(() => { setAIdx(p => { if (p < STEPS.length-1) { setDoneSt(d => { const n = new Set(Array.from(d)); n.add(p); return n; }); return p+1; } return p; }); }, 800);
    return () => clearInterval(iv);
  }, [phase, auditReady, resumeAtImprove]);

  useEffect(() => {
    if (phase !== 'score' || !audit) return;
    let n = 0; const iv = setInterval(() => { n++; setCounter(n); if (n >= audit.score) clearInterval(iv); }, 25);
    return () => clearInterval(iv);
  }, [phase, audit]);

  async function runAudit() {
    setAuditError(false);
    setAuditCode('');
    setAuditReady(false);
    try {
      const res = await fetch('/api/audit', { method: 'POST' });
      const d = await res.json();
      if (!res.ok || d.error) { setAuditCode(d.code || ''); throw new Error(d.error || 'Audit failed'); }
      setAudit(d.audit); setLocData(d.locationData); setHoursInfo(d.hours || null); setManual(d.manual || []);
      // Whether to ask the voice questions. Any failure just means they are not asked.
      fetch('/api/voice').then(r => r.ok ? r.json() : null).then(v => { if (v?.available) { setVoiceAvailable(true); setVoiceDraft(draftFromVoice(v.voice)); } }).catch(() => {});
      setAuditReady(true);
    } catch (e: any) {
      console.error('Audit failed:', e);
      setAuditError(e.message || 'Audit failed');
    }
  }

  async function loadListings() {
    setListings(null); setListingsError(''); setSelecting('');
    try {
      const res = await fetch('/api/listings');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to load listings');
      setListings(d.listings || []);
      setListingsHelp(d.help || null);
      setExpectedShop(d.expected || null);
      setWrongAccountPath(d.wrongAccountPath || '');
    } catch (e: any) {
      console.error('Load listings failed:', e);
      setListingsError(e.message || 'Failed to load listings');
      setListings([]);
    }
  }

  async function selectListing(accountName: string, locationName: string) {
    setSelecting(locationName); setListingsError('');
    try {
      const res = await fetch('/api/listings/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountName, locationName }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'Selection failed');
      // Re-pick from settings: repopulate the audit for the new listing, then return.
      // Free brand, first time: choosing the listing completes the connection.
      if (d.connectedPage && returnTo !== 'settings') { router.push('/connected'); return; }
      if (returnTo === 'settings') { await fetch('/api/audit', { method: 'POST' }).catch(()=>{}); router.push('/dashboard'); return; }
      // Onboarding: audit the listing they just chose.
      setAuditError(false); setAuditCode(''); setAIdx(0); setDoneSt(new Set());
      setPhase('analysing');
      runAudit();
    } catch (e: any) {
      console.error('Select listing failed:', e);
      setListingsError(e.message || 'Selection failed');
      setSelecting('');
    }
  }

  // After the score: the optional voice questions if they are on offer, then
  // the mobile number, then the changes. The changes come last so that the
  // drafts are written after the shop has said how it wants to sound.
  // A free brand is never asked for a mobile number here: texts are off, and it
  // used to stop a shop with only a landline from finishing at all.
  const afterVoice: Phase = freeTenant ? 'improve' : 'phone';
  function afterScore() { setPhase(voiceAvailable ? 'voice' : afterVoice); }

  async function submitVoice(skip: boolean) {
    setVoiceErr('');
    // Skipped, or nothing typed: nothing is saved and the default wording stays.
    if (skip || draftIsEmpty(voiceDraft)) { setPhase(afterVoice); return; }
    setVoiceSaving(true);
    try {
      const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: voiceDraft }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setVoiceErr(d.error || 'We could not save that. Please try again.'); return; }
      setPhase(afterVoice);
    } catch {
      setVoiceErr('We could not save that. Please try again.');
    } finally {
      setVoiceSaving(false);
    }
  }

  async function submitPhone() {
    const c = phone.replace(/\s/g, '');
    if (!c.match(/^(\+44|0)7\d{9}$/)) { setPhoneErr('Enter a valid UK mobile number'); return; }
    setPhoneErr('');

    // Persist the opt-in BEFORE anything else on this path can fail. The two
    // fields are already on the PATCH allowlist in /api/account/delete, so this
    // needs no new endpoint. Written unconditionally rather than only when true:
    // a retailer who turns one on and back off must end up off, not untouched.
    if (freeTenant) {
      // A free tenant NEVER touches /api/checkout. There is no per-retailer
      // subscription behind it — Stellar Local is funded by Tarkett and invoiced
      // monthly against active user counts, reconciled by hand — so a Stripe
      // customer for this retailer is a record of something that does not exist,
      // and the checkout page it leads to quotes Chocka's price to someone who
      // was told the service is free.
      //
      // The phone goes through the account PATCH instead, which is why
      // phone_number is on that allowlist. Saved together with the automation
      // choices in one request so a retailer cannot end up with their opt-ins
      // stored and their number lost, or the reverse.
      const saved = await fetch('/api/account/delete', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: c, auto_post_enabled: optPost, auto_reply_enabled: optReply }),
      }).catch(() => null);

      if (!saved || !saved.ok) {
        // Do not silently continue: the number drives the Monday stats text and
        // the review alerts, and losing it here is invisible until they never
        // arrive.
        setPhoneErr('We could not save your details. Please try again.');
        return;
      }

      setPhase('improve');
      return;
    }

    const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: c, plan: 'monthly', referralCode: sessionStorage.getItem('chocka_ref') || '' }) });
    if (res.ok) {
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
    }
    setPhase('improve');
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

  /* ── SELECT LISTING (picker) ── */
  if (phase === 'select') {
    return (
      <div style={{minHeight:'100vh',fontFamily:sans,background:V.bg,color:V.text,display:'flex',justifyContent:'center'}}>
        <div style={{width:'100%',maxWidth:460,padding:'80px 1.25rem 2rem'}}>
          <div style={{marginBottom:24}}>
            <div style={logoStyle}>{tenant.wordmark}</div>
            <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text}}>Which listing<br/>is yours?</h2>
            <p style={{fontSize:13,color:V.textSoft,marginTop:4}}>You manage more than one Google Business Profile. Pick the one to set up.</p>
          </div>
          {listings === null ? (
            <div style={{...card,padding:20,textAlign:'center'}}><p style={{fontSize:14,color:V.textSoft,margin:0}}>Loading your listings…</p></div>
          ) : listingsError ? (
            <div style={{...card,padding:20,textAlign:'center'}}>
              <p style={{fontSize:14,color:V.textMid,margin:'0 0 16px'}}>{listingsError}</p>
              <button onClick={loadListings} style={btn}>Try Again</button>
            </div>
          ) : listings.length === 0 ? (
            <div style={{...card,padding:20,textAlign:'center'}}><p style={{fontSize:14,color:V.textMid,margin:0}}>We couldn&apos;t find a Google Business Profile you manage.</p>{wrongAccountPath && <a href={wrongAccountPath} style={{display:'block',marginTop:12,fontSize:15,color:V.text,textDecoration:'underline'}}>Try a different Google account</a>}</div>
          ) : (
            <>
            {listingsHelp && (
              <div style={{...card,padding:16,marginBottom:12,background:V.card}}>
                <div style={{fontSize:14,fontWeight:600,color:V.text,marginBottom:4}}>{listingsHelp.title}</div>
                <p style={{fontSize:13,color:V.textMid,margin:'0 0 6px',lineHeight:1.5}}>{expectedShop ? `We were expecting ${expectedShop.name}${expectedShop.town ? `, ${expectedShop.town}` : ''}. ` : ''}{listingsHelp.message}</p>
                <p style={{fontSize:13,color:V.textMid,margin:0,lineHeight:1.5}}>{listingsHelp.nextStep}</p>
              </div>
            )}
            <div style={{...card,padding:8}}>
              {listings.map((l:any) => (
                <button key={l.locationName} onClick={()=>selectListing(l.accountName, l.locationName)} disabled={!!selecting}
                  style={{display:'block',width:'100%',textAlign:'left',background:'none',border:'none',borderBottom:`1px solid ${V.border}`,padding:'14px 12px',cursor:selecting?'default':'pointer',opacity:selecting && selecting!==l.locationName?0.4:1}}>
                  <div style={{fontSize:15,fontWeight:600,color:V.text}}>{l.title || 'Untitled listing'}</div>
                  {l.address && <div style={{fontSize:13,color:V.textSoft,marginTop:2}}>{l.address}</div>}
                  <div style={{fontSize:11,color:V.textSoft,marginTop:4}}>{l.accountDisplay || (l.accountType === 'PERSONAL' ? 'Personal account' : 'Google account')}</div>
                  {l.matchesExpected && <div style={{fontSize:12,color:V.green,marginTop:6,fontWeight:600}}>This looks like your shop</div>}
                  {l.waitingOnGoogle && <div style={{fontSize:12,color:V.amber,marginTop:6}}>Google hasn&apos;t finished verifying this listing yet</div>}
                  {selecting===l.locationName && <div style={{fontSize:12,color:V.orange,marginTop:6}}>Setting up…</div>}
                </button>
              ))}
            </div>
            {wrongAccountPath && <a href={wrongAccountPath} style={{display:'block',textAlign:'center',fontSize:15,color:V.textMid,padding:'14px 8px',textDecoration:'underline'}}>None of these is my shop</a>}
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── ANALYSING ── */
  if (phase === 'analysing') {
    // Error during analysis — show retry/skip
    if (auditError) {
      // Prefer the structured code from the API; fall back to legacy string
      // matching so older responses still render the right screen.
      const isNoProfile = auditCode === 'no_profile' || auditError === 'No profile found';
      const isNotAuth = auditCode === 'not_authenticated' || auditError === 'Not authenticated';
      const isDisconnected = auditCode === 'google_disconnected' || auditError === 'Google not connected';
      const isListing = auditCode === 'listing_access_denied' || auditCode === 'listing_not_found';
      // Set by the OAuth callback, not by /api/audit: the listing enumeration
      // threw, so nothing is bound and there is nothing to audit yet. Its retry
      // has to redo the CONNECT, which is why it cannot share the Try Again
      // button below — that one re-runs the audit and would come straight back
      // with no_profile.
      const isConnectFailed = auditCode === 'connect_failed';
      // Any other code (google_unreachable, unknown, or an empty/legacy code) is
      // treated as a reachable-but-failed listing: honest, retryable, with a
      // reconnect option. The bare "Something went wrong" screen is deliberately
      // no longer reachable.
      const heading = isNoProfile ? 'No Google Business\nProfile found'
        : isNotAuth ? 'Session\nexpired'
        : isDisconnected ? 'Reconnect\nyour Google'
        : isListing ? 'Listing access\nproblem'
        : isConnectFailed ? 'We couldn’t reach\nGoogle'
        : 'We couldn’t reach\nyour listing';
      const subtitle = isNoProfile
        ? 'We couldn\u2019t find a Google Business Profile linked to this account.'
        : isNotAuth
        ? 'Your session has expired.'
        : isDisconnected
        ? 'We lost the connection to your Google account.'
        : isListing
        ? 'We couldn\u2019t open the listing that\u2019s currently connected.'
        : isConnectFailed
        ? 'Google didn\u2019t answer when we asked which listings you manage. Nothing is wrong with your account.'
        : 'We couldn\u2019t reach your Google listing right now. This is usually temporary.';
      const detail = isNoProfile
        ? `Try signing in with the Google account you use to manage your listing. Not sure which one? Email ${tenant.teamEmail} and we\u2019ll help.`
        : isNotAuth
        ? 'Please sign in again to reconnect.'
        : isDisconnected
        ? 'Please sign in again to reconnect.'
        : isListing
        ? 'You may not have permission to manage this listing, or it\u2019s been removed. Choose a different one, or ask the owner to add you.'
        : isConnectFailed
        ? `This is almost always temporary \u2014 try again in a moment. If it keeps happening, email ${tenant.teamEmail}.`
        : `Reconnect Google or try again. If it keeps happening, email ${tenant.teamEmail}.`;
      return (
        <div style={{minHeight:'100vh',fontFamily:sans,background:V.bg,color:V.text,display:'flex',justifyContent:'center'}}>
          <div style={{width:'100%',maxWidth:460,padding:'80px 1.25rem 2rem'}}>
            <div style={{marginBottom:32}}>
              <div style={logoStyle}>{tenant.wordmark}</div>
              <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text,whiteSpace:'pre-line'}}>{heading}</h2>
              <p style={{fontSize:13,color:V.textSoft,marginTop:4}}>{subtitle}</p>
            </div>
            <div style={{...card,padding:20,textAlign:'center'}}>
              <div style={{fontSize:40,marginBottom:12}}>!</div>
              <p style={{fontSize:14,color:V.textMid,margin:'0 0 16px'}}>{detail}</p>
              {isConnectFailed ? (
                /* Retries the CONNECT, not the audit. Nothing is bound yet, so
                   there is nothing for runAudit() to look at. */
                <button onClick={()=>{ window.location.href='/api/auth/callback/google'; }} style={btn}>Try Again</button>
              ) : isListing ? (
                <button onClick={()=>{ setAuditError(false); setAuditCode(''); setPhase('select'); loadListings(); }} style={btn}>Choose a Different Listing</button>
              ) : (isNoProfile || isDisconnected || isNotAuth) ? (
                <button onClick={()=>{ window.location.href='/api/auth/callback/google'; }} style={btn}>Sign In With a Different Account</button>
              ) : (
                <>
                  <button onClick={()=>{ setPhase('analysing'); setAIdx(0); setDoneSt(new Set()); runAudit(); }} style={btn}>Try Again</button>
                  <button onClick={()=>{ window.location.href='/api/auth/callback/google'; }} style={{...btnGhost,marginTop:8}}>Reconnect Google</button>
                </>
              )}
              <button onClick={()=>router.push('/dashboard')} style={{...btnGhost,marginTop:8}}>Leave this for now</button>
            </div>
          </div>
        </div>
      );
    }

    const progress = Math.min(((aIdx+1)/STEPS.length)*100,100);
    const showStillWorking = aIdx >= STEPS.length - 1 && !auditReady && !auditError;
    return (
      <div style={{minHeight:'100vh',fontFamily:sans,background:V.bg,color:V.text,display:'flex',justifyContent:'center'}}>
        <div style={{width:'100%',maxWidth:460,padding:'80px 1.25rem 2rem'}}>
          <div style={{marginBottom:32}}>
            <div style={logoStyle}>{tenant.wordmark}</div>
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
          {showStillWorking && (
            <p style={{textAlign:'center',fontSize:13,color:V.textSoft,marginTop:16,animation:'pulse 2s ease-in-out infinite'}}>
              Still working — your profile has a lot of data...
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ── SCORE REVEAL ── */
  if (phase === 'score' && audit) {
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>{tenant.wordmark}</div>
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

          <button onClick={afterScore} style={btn}>{audit.fixes.length > 0 ? 'See what we could improve →' : 'Continue →'}</button>
          <p style={{textAlign:'center',fontSize:12,color:V.textSoft,marginTop:8}}>Nothing has been changed on your listing.</p>
        </div>
      </div>
    );
  }

  /* ── VOICE (optional) ── */
  if (phase === 'voice') {
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>{tenant.wordmark}</div>
          <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text}}>Make it sound<br/>like you.</h2>
          <p style={{fontSize:13,color:V.textSoft,marginBottom:20}}>A few quick questions so your posts and review replies sound like your shop. All optional, and you can skip this.</p>
          <div style={card}>
            <VoiceFields value={voiceDraft} onChange={(d)=>{setVoiceDraft(d);setVoiceErr('');}} disabled={voiceSaving} accent={V.text}
              inputStyle={{background:V.card2,color:V.text,border:`1px solid ${V.border}`,borderRadius:12,padding:'10px 12px',fontSize:14,fontFamily:sans,outline:'none'}}
              labelStyle={{display:'block',fontSize:13,fontWeight:600,marginBottom:6,color:V.text}}
              hintStyle={{fontSize:11,color:V.textSoft,marginTop:4}} />
          </div>
          {voiceErr && <p style={{color:V.red,fontSize:13,margin:'0 0 12px'}}>{voiceErr}</p>}
          <button onClick={()=>submitVoice(false)} disabled={voiceSaving} style={{...btn,opacity:voiceSaving?0.6:1}}>{voiceSaving ? 'Saving…' : 'Continue →'}</button>
          <button onClick={()=>submitVoice(true)} disabled={voiceSaving} style={btnGhost}>Skip for now</button>
        </div>
      </div>
    );
  }

  /* ── PHONE ── */
  if (phase === 'phone') {
    return (
      <div style={{...wrap,background:V.bg}}>
        <div style={box}>
          <div style={logoStyle}>{tenant.wordmark}</div>
          <h2 style={{fontFamily:barlow,fontSize:28,fontWeight:800,textTransform:'uppercase',lineHeight:1,margin:'12px 0 4px',color:V.text}}>Nearly<br/>there.</h2>
          <p style={{fontSize:13,color:V.textSoft,marginBottom:20}}>One last thing. Nothing on your listing has changed yet.</p>

          <div style={card}>
            <span style={{fontSize:15,fontWeight:600}}>Your mobile number</span>
            <p style={{fontSize:13,color:V.textSoft,margin:'4px 0 12px'}}>We&apos;ll text you stats every Monday and alert you about new reviews. Nothing else.</p>
            <input type="tel" value={phone} onChange={e=>{setPhone(e.target.value);setPhoneErr('')}} placeholder="07712 345 678"
              style={{width:'100%',padding:'12px 14px',border:phoneErr?`2px solid ${V.red}`:`1px solid ${V.border}`,borderRadius:12,fontSize:16,fontFamily:sans,background:V.card2,color:V.text,boxSizing:'border-box',outline:'none'}}/>
            {phoneErr && <p style={{color:V.red,fontSize:12,marginTop:4}}>{phoneErr}</p>}
          </div>

          {freeTenant ? (
            /* Free tenant: no price, and nothing is automatic until asked for.
               Replaces the Stripe block rather than sitting beside it — a
               "£0/month · Billed monthly via Stripe" panel is meaningless here. */
            <div style={card}>
              <div style={lbl}>What would you like us to do?</div>
              <p style={{fontSize:13,color:V.textSoft,margin:'0 0 14px'}}>
                Both are off. Turn on what you want — you can change either one at any time in Settings.
              </p>
              {([
                { on: optPost, set: setOptPost, title: 'Write and publish posts',
                  desc: 'We write a post for your Google profile each week and publish it for you.' },
                { on: optReply, set: setOptReply, title: 'Reply to reviews',
                  desc: 'We reply to your 4-5 star reviews. Anything lower always comes to you first.' },
              ] as const).map((o) => (
                <button
                  key={o.title}
                  type="button"
                  role="switch"
                  aria-checked={o.on}
                  onClick={() => o.set(!o.on)}
                  style={{
                    display:'flex',alignItems:'flex-start',gap:12,width:'100%',textAlign:'left',
                    background:V.card2,border:`1px solid ${o.on ? V.orange : V.border}`,
                    borderRadius:12,padding:'12px 14px',marginBottom:8,cursor:'pointer',
                    fontFamily:sans,transition:'border-color .15s',
                  }}
                >
                  <span style={{
                    width:20,height:20,borderRadius:6,flexShrink:0,marginTop:1,
                    border:`1px solid ${o.on ? V.orange : V.border}`,
                    background:o.on ? V.orange : 'transparent',
                    display:'flex',alignItems:'center',justifyContent:'center',
                  }}>
                    {o.on && (
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 6.5L5 9L9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  <span>
                    <span style={{display:'block',fontSize:14,fontWeight:600,color:V.text}}>{o.title}</span>
                    <span style={{display:'block',fontSize:12,color:V.textSoft,marginTop:2}}>{o.desc}</span>
                  </span>
                </button>
              ))}
              <p style={{fontSize:12,color:V.textSoft,margin:'8px 0 0'}}>
                It&apos;s free{tenant.fundedBy ? ` — ${tenant.brandName} is paid for by ${tenant.fundedBy}` : ''}. You stay the owner of your profile.
              </p>
            </div>
          ) : (
            <div style={{background:V.text,borderRadius:12,padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div>
                <div style={{fontFamily:mono,fontSize:22,fontWeight:600,color:'#fff'}}>£{tenant.priceMonthlyGbp}<span style={{fontSize:12,color:'rgba(255,255,255,.4)'}}>/month</span></div>
                <div style={{fontSize:11,color:'rgba(255,255,255,.3)'}}>Cancel anytime · No contract</div>
              </div>
              <div style={{fontSize:11,color:'rgba(255,255,255,.3)',textAlign:'right'}}>Billed monthly<br/>via Stripe</div>
            </div>
          )}

          <button onClick={submitPhone} style={btn}>{freeTenant ? 'Continue →' : 'Continue To Payment →'}</button>
        </div>
      </div>
    );
  }

  /* ── WHAT WE COULD IMPROVE: tick, apply, checked results ── */
  if (phase === 'improve' && audit) {
    return (
      <ImproveListing
        audit={audit}
        hours={hoursInfo}
        manual={manual}
        // Offering to queue careful replies posts nothing: each waits on the dashboard for the shop to approve.
        offerLowStar
        wordmark={tenant.wordmark}
        onFinished={() => router.push('/dashboard')}
        onSkip={async () => { await fetch('/api/profile-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'finish' }) }).catch(() => {}); router.push('/dashboard'); }}
      />
    );
  }

  return null;
}
