'use client';

import { useState, useEffect, useCallback } from 'react';

const V = { bg:'#F0EDE8',card:'#FAFAF8',card2:'#F5F3EF',orange:'#E8541A',orangeLight:'#FFF0EB',green:'#2D7A4F',greenLight:'#E8F5EE',red:'#D93025',text:'#1A1A1A',textMid:'#555',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const card: React.CSSProperties = { background:V.card, borderRadius:16, padding:16, boxShadow:V.shadow };
const lbl: React.CSSProperties = { fontFamily:sans, fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:V.textSoft, marginBottom:12 };

export default function SettingsPage() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoPost, setAutoPost] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [saving, setSaving] = useState<string|null>(null);
  const [toast, setToast] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  useEffect(() => {
    fetch('/api/dashboard').then(r=>r.ok?r.json():Promise.reject()).then(data=>{
      setD(data);
      setAutoPost(data.user.auto_post_enabled !== false);
      setAutoReply(data.user.auto_reply_enabled !== false);
      setSmsEnabled(data.user.sms_enabled !== false);
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);

  const save = useCallback(async (field:string, value:boolean) => {
    setSaving(field);
    try {
      await fetch('/api/account/delete', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({[field]:value}) });
      setToast('Updated'); setTimeout(()=>setToast(''),2000);
    } catch { setToast('Failed'); setTimeout(()=>setToast(''),2000); }
    setSaving(null);
  }, []);

  const handleBilling = async () => {
    setSaving('billing');
    try {
      const res = await fetch('/api/billing-portal', { method:'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { setToast('Failed to open billing'); setTimeout(()=>setToast(''),2000); }
    setSaving(null);
  };

  const handleDelete = async () => {
    if (deleteText !== 'DELETE') return;
    setSaving('delete');
    try {
      const res = await fetch('/api/account/delete', { method:'DELETE' });
      if (res.ok) window.location.href = '/login';
    } catch { setToast('Failed to delete'); setTimeout(()=>setToast(''),2000); }
    setSaving(null);
  };

  if (loading) return <div style={{display:'flex',justifyContent:'center',padding:'5rem 0'}}><div style={{width:24,height:24,border:`3px solid ${V.card2}`,borderTopColor:V.orange,borderRadius:'50%',animation:'spin .8s linear infinite'}}/></div>;
  if (!d) return null;

  return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div style={{fontSize:20,fontWeight:600,fontFamily:sans,marginBottom:20,animation:'fadeUp .5s ease both'}}>Settings</div>

      {/* Account info */}
      <div style={{...card,animation:'fadeUp .5s .05s ease both'}}>
        <div style={lbl}>Account</div>
        <InfoRow label="Business" value={d.profile?.business_name || '—'} />
        <InfoRow label="Email" value={d.user.email || '—'} />
        <InfoRow label="Phone" value={d.user.phone || '—'} />
        <InfoRow label="Plan" value={d.user.subscription_status === 'active' ? '£29/month' : 'No active plan'} />
        <InfoRow label="Member since" value={d.profile?.streak_weeks ? `${d.profile.streak_weeks} weeks` : 'New'} />
      </div>

      {/* Google connection */}
      <div style={{...card,animation:'fadeUp .5s .1s ease both'}}>
        <div style={lbl}>Google Connection</div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:V.green}}/>
            <span style={{fontSize:13,fontFamily:sans,color:V.text}}>Connected</span>
          </div>
          <button onClick={()=>window.location.href='/api/auth/callback/google?action=reconnect'} style={{background:V.card2,border:'none',borderRadius:10,padding:'7px 14px',fontSize:12,fontWeight:500,cursor:'pointer',fontFamily:sans,color:V.textMid}}>Reconnect</button>
        </div>
        <div style={{fontSize:11,color:V.textSoft,marginTop:6,fontFamily:sans}}>Profile: {d.profile?.business_name}</div>
      </div>

      {/* Automation */}
      <div style={{...card,animation:'fadeUp .5s .15s ease both'}}>
        <div style={lbl}>Automation</div>
        <Toggle label="Auto-posting" desc="We write and publish a post to your Google profile every week" enabled={autoPost} loading={saving==='auto_post_enabled'} onChange={v=>{setAutoPost(v);save('auto_post_enabled',v)}} />
        <div style={{height:1,background:V.border,margin:'8px 0'}}/>
        <Toggle label="Auto-reply to reviews" desc="We reply to 4-5 star reviews automatically. Bad reviews need your approval." enabled={autoReply} loading={saving==='auto_reply_enabled'} onChange={v=>{setAutoReply(v);save('auto_reply_enabled',v)}} />
        <div style={{height:1,background:V.border,margin:'8px 0'}}/>
        <Toggle label="SMS notifications" desc="Monday stats, review alerts, and post confirmations" enabled={smsEnabled} loading={saving==='sms_enabled'} onChange={v=>{setSmsEnabled(v);save('sms_enabled',v)}} />
      </div>

      {/* Billing */}
      <div style={{...card,animation:'fadeUp .5s .2s ease both'}}>
        <div style={lbl}>Subscription</div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div>
            <div style={{fontSize:14,fontWeight:600,fontFamily:sans}}>Chocka · £29/month</div>
            <div style={{fontSize:11,color:V.textSoft,marginTop:2,fontFamily:sans}}>Cancel anytime · No contract</div>
          </div>
        </div>
        <button onClick={handleBilling} disabled={saving==='billing'} style={{background:V.text,color:'white',border:'none',borderRadius:10,padding:'9px 16px',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:sans,width:'100%',opacity:saving==='billing'?.5:1}}>
          {saving==='billing'?'Opening...':'Manage billing'}
        </button>
      </div>

      {/* Danger zone */}
      <div style={{...card,animation:'fadeUp .5s .25s ease both'}}>
        <div style={{...lbl,color:V.red}}>Danger Zone</div>
        {!showDelete ? (
          <button onClick={()=>setShowDelete(true)} style={{background:'none',border:'none',fontSize:13,color:V.textSoft,cursor:'pointer',padding:0,fontFamily:sans}}>Delete my account</button>
        ) : (
          <div>
            <p style={{fontSize:13,color:V.textMid,lineHeight:1.5,margin:'0 0 10px',fontFamily:sans}}>This will permanently delete all your data, cancel your subscription, and disconnect your Google profile. Type <strong>DELETE</strong> to confirm.</p>
            <input value={deleteText} onChange={e=>setDeleteText(e.target.value)} placeholder="Type DELETE" style={{width:'100%',padding:'9px 12px',borderRadius:10,border:`2px solid rgba(217,48,37,0.2)`,fontSize:13,fontFamily:sans,color:V.text,outline:'none',background:'transparent',marginBottom:8}}/>
            <div style={{display:'flex',gap:8}}>
              <button onClick={handleDelete} disabled={deleteText!=='DELETE'||saving==='delete'} style={{background:V.red,color:'white',border:'none',borderRadius:10,padding:'9px 16px',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:sans,opacity:deleteText!=='DELETE'?.4:1}}>{saving==='delete'?'Deleting...':'Delete everything'}</button>
              <button onClick={()=>{setShowDelete(false);setDeleteText('')}} style={{background:'none',border:'none',fontSize:13,color:V.textSoft,cursor:'pointer',fontFamily:sans}}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast&&<div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:toast==='Failed'?V.red:V.green,color:'#fff',fontFamily:sans,fontSize:13,fontWeight:500,padding:'8px 20px',borderRadius:20,boxShadow:'0 4px 16px rgba(0,0,0,.15)',zIndex:1000}}>{toast}</div>}

      <div style={{height:40}}/>
    </>
  );
}

function InfoRow({label,value}:{label:string;value:string}) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0'}}>
      <span style={{fontSize:13,color:'#999',fontFamily:"'DM Sans',sans-serif"}}>{label}</span>
      <span style={{fontSize:13,fontWeight:500,color:'#1A1A1A',fontFamily:"'DM Sans',sans-serif"}}>{value}</span>
    </div>
  );
}

function Toggle({label,desc,enabled,loading,onChange}:{label:string;desc:string;enabled:boolean;loading:boolean;onChange:(v:boolean)=>void}) {
  return (
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,padding:'6px 0'}}>
      <div style={{flex:1}}>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:500,fontSize:14,color:'#1A1A1A',marginBottom:2}}>{label}</div>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:'#999',lineHeight:1.4}}>{desc}</div>
      </div>
      <button onClick={()=>onChange(!enabled)} style={{width:44,height:24,borderRadius:12,border:'none',cursor:'pointer',flexShrink:0,marginTop:2,background:enabled?'#2D7A4F':'#E0DDD8',position:'relative',opacity:loading?.5:1}}>
        <span style={{position:'absolute',top:2,left:enabled?22:2,width:20,height:20,borderRadius:10,background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.15)',transition:'left .2s'}}/>
      </button>
    </div>
  );
}
