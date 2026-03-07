'use client';

import { useState, useEffect } from 'react';

const V = { bg:'#F0EDE8',card:'#FAFAF8',card2:'#F5F3EF',orange:'#E8541A',orangeLight:'#FFF0EB',green:'#2D7A4F',greenLight:'#E8F5EE',amber:'#B8860B',amberLight:'#FFF8E6',text:'#1A1A1A',textMid:'#555',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)',star:'#FBBC04' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const card: React.CSSProperties = { background:V.card, borderRadius:16, padding:16, boxShadow:V.shadow };
const lbl: React.CSSProperties = { fontFamily:sans, fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:V.textSoft, marginBottom:10 };
const bdg = (bg:string,c:string): React.CSSProperties => ({ display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,padding:'3px 8px',borderRadius:20,background:bg,color:c,marginTop:6 });

export default function DashboardPage() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch('/api/dashboard').then(r=>r.ok?r.json():Promise.reject()).then(x=>{setD(x);setLoading(false)}).catch(()=>setLoading(false)); }, []);

  if (loading) return <div style={{display:'flex',justifyContent:'center',padding:'5rem 0'}}><div style={{width:24,height:24,border:`3px solid ${V.card2}`,borderTopColor:V.orange,borderRadius:'50%',animation:'spin .8s linear infinite'}}/></div>;
  if (!d) return <div style={{textAlign:'center',padding:'5rem 1rem',fontFamily:sans}}><p style={{color:V.textSoft}}>Could not load dashboard</p></div>;

  const p=d.profile, g=d.google, hasScore=p?.audit_score!=null;
  const sc=(s:number)=>s>=76?V.green:s>=56?V.amber:s>=31?V.orange:'#E05050';
  const estCalls=g?.metrics?.calls||0, avgJob=180, estValue=estCalls*avgJob, roi=estValue>0?Math.round(estValue/29):0;
  const totalActions=(p?.total_posts||0)+(p?.total_replies||0);
  const timeSaved=((p?.total_posts||0)*0.25+(p?.total_replies||0)*0.08+((p?.streak_weeks||0)*0.5)).toFixed(1);
  const comps=g?.competitors;

  return (
    <>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.85)}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Business header */}
      <div style={{padding:'4px 0 8px',animation:'fadeUp .5s ease both'}}>
        <div style={{fontSize:20,fontWeight:600,display:'flex',alignItems:'center',gap:8,fontFamily:sans}}>{p?.business_name||d.user.name}<span style={{width:8,height:8,background:V.green,borderRadius:'50%',animation:'pulse 2s infinite',flexShrink:0}}/></div>
        <div style={{fontSize:13,color:V.textSoft,marginTop:2,fontFamily:sans}}>{g?.profile?.primaryCategory||p?.category}{p?.city?` · ${p.city}`:''}</div>
      </div>

      {/* Score + Managed */}
      {hasScore&&(<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,animation:'fadeUp .5s .05s ease both'}}>
        <div style={{...card,padding:'14px 16px'}}>
          <div style={lbl}>Profile Score</div>
          <div style={{fontSize:38,fontWeight:600,lineHeight:1,marginTop:6,fontFamily:mono,color:sc(p.audit_score_after||p.audit_score)}}>{p.audit_score_after||p.audit_score}<span style={{fontSize:16,color:V.textSoft}}>/100</span></div>
          {p.audit_score_after&&p.audit_score&&<div style={bdg(V.greenLight,V.green)}>↑ +{p.audit_score_after-p.audit_score} from setup</div>}
          <div style={{marginTop:8,display:'flex',alignItems:'flex-end',gap:3,height:28}}>
            {[20,30,35,45,55,65,72,(p.audit_score_after||p.audit_score)].map((h,i)=>(<div key={i} style={{flex:1,height:`${h}%`,borderRadius:'3px 3px 0 0',background:i===7?V.orange:V.orangeLight}}/>))}
          </div>
        </div>
        <div style={{...card,padding:'14px 16px'}}>
          <div style={lbl}>Managed For</div>
          <div style={{fontSize:38,fontWeight:600,lineHeight:1,marginTop:6,fontFamily:mono,color:V.text}}>{p.streak_weeks||0}<span style={{fontSize:14,color:V.textSoft}}> wks</span></div>
          <div style={bdg(V.greenLight,V.green)}>0 tasks missed</div>
          <div style={{marginTop:10}}><div style={{fontSize:11,color:V.textSoft}}>Actions taken</div><div style={{fontSize:18,fontWeight:600,fontFamily:mono,marginTop:2}}>{totalActions}</div></div>
        </div>
      </div>)}

      {/* Value banner */}
      {estCalls>0&&(<div style={{background:V.text,color:'white',borderRadius:16,padding:'16px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',animation:'fadeUp .5s .1s ease both'}}>
        <div>
          <div style={{fontSize:11,opacity:.5,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4,fontFamily:sans}}>Est. work generated</div>
          <div style={{fontSize:28,fontWeight:600,fontFamily:mono,color:'#fff'}}>£{estValue.toLocaleString()}</div>
          <div style={{fontSize:11,opacity:.4,marginTop:2,fontFamily:sans}}>Based on {estCalls} calls × £{avgJob} avg job</div>
        </div>
        <div style={{textAlign:'right'}}><div style={{fontSize:22,fontWeight:600,fontFamily:mono,color:'#7DFF9B'}}>{roi}×</div><div style={{fontSize:10,opacity:.4,textTransform:'uppercase',letterSpacing:'0.06em',fontFamily:sans}}>return on £29/mo</div></div>
      </div>)}

      {/* Google Stats */}
      {g?.metrics&&(g.metrics.views+g.metrics.calls+g.metrics.directions+g.metrics.websiteClicks>0)&&(
        <div style={{...card,animation:'fadeUp .5s .15s ease both'}}>
          <div style={lbl}>Google Stats · Last 28 days</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <SC num={g.metrics.views.toLocaleString()} label="Profile views"/>
            <SC num={String(g.metrics.calls)} label="Calls from profile" hl/>
            <SC num={String(g.metrics.directions)} label="Directions"/>
            <SC num={String(g.metrics.websiteClicks)} label="Website clicks"/>
            <SC num={String(g.metrics.totalActions)} label="Total actions" hl/>
            {g.reviews&&<SC num={String(g.reviews.avgRating)} label="Star rating" star/>}
          </div>
          <div style={{background:V.greenLight,borderRadius:12,padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:10}}>
            <span style={{fontSize:12,color:V.green,fontWeight:500,fontFamily:sans}}>⏱ Time saved this month</span>
            <span style={{fontSize:16,fontWeight:600,fontFamily:mono,color:V.green}}>{timeSaved} hrs</span>
          </div>
        </div>
      )}

      {/* Competitor Ranking */}
      {comps&&comps.list?.length>0&&(
        <div style={{...card,animation:'fadeUp .5s .2s ease both'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <span style={{...lbl,marginBottom:0}}>Competitor Ranking · {p?.city||'Local'}</span>
            <span style={{fontSize:11,color:V.orange,fontWeight:500,fontFamily:sans}}>{g?.profile?.primaryCategory||p?.category}</span>
          </div>
          {/* You */}
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:600,color:V.text,width:110,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:sans}}>You ({p?.business_name?.split(' ')[0]})</span>
            <div style={{flex:1,height:6,background:V.card2,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',borderRadius:3,background:V.orange,width:`${comps.own.score}%`}}/></div>
            <span style={{fontSize:11,fontFamily:mono,color:V.orange,fontWeight:600,width:24,textAlign:'right'}}>{comps.own.score}</span>
          </div>
          {/* Competitors */}
          {comps.list.map((c:any,i:number)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
              <span style={{fontSize:12,color:V.textMid,width:110,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:sans}}>{c.name}</span>
              <div style={{flex:1,height:6,background:V.card2,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',borderRadius:3,background:'#ddd',width:`${c.score}%`}}/></div>
              <span style={{fontSize:11,fontFamily:mono,color:V.textSoft,width:24,textAlign:'right'}}>{c.score}</span>
            </div>
          ))}
          {comps.own.score>=Math.max(...comps.list.map((c:any)=>c.score))&&<div style={bdg(V.greenLight,V.green)}>🏆 You&apos;re leading your local area</div>}
        </div>
      )}

      {/* This week */}
      {d.plan&&(<div style={{...card,animation:'fadeUp .5s .25s ease both'}}>
        <div style={lbl}>This Week</div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {d.plan.map((item:any,i:number)=>(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{width:8,height:8,borderRadius:'50%',flexShrink:0,background:item.status==='done'?V.green:item.status==='today'?V.amber:item.status==='ongoing'?V.green:'#ddd'}}/>
                <span style={{fontSize:13.5,fontWeight:400,fontFamily:sans,color:item.status==='done'?V.textSoft:V.text,textDecoration:item.status==='done'?'line-through':'none'}}>{item.action}</span>
              </div>
              <span style={{fontSize:12,color:V.textSoft,fontFamily:sans}}>{item.day}</span>
            </div>
          ))}
        </div>
      </div>)}

      {/* Reviews */}
      {g?.reviews&&g.reviews.total>0&&(
        <div style={{...card,animation:'fadeUp .5s .3s ease both'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{...lbl,marginBottom:0}}>Reviews</span>
            {g.reviews.unreplied>0&&<span style={{fontSize:11,fontWeight:600,color:V.orange,background:V.orangeLight,padding:'3px 8px',borderRadius:20}}>{g.reviews.unreplied} need reply</span>}
          </div>
          <div style={{display:'flex',gap:24,marginBottom:12}}>
            <div><div style={{fontSize:10,color:V.textSoft,fontFamily:sans}}>Total</div><div style={{fontSize:22,fontWeight:600,fontFamily:mono}}>{g.reviews.total}</div></div>
            <div><div style={{fontSize:10,color:V.textSoft,fontFamily:sans}}>Average</div><div style={{fontSize:22,fontWeight:600,fontFamily:mono}}>{g.reviews.avgRating} <span style={{color:V.star,fontSize:14}}>{'\u2605'}</span></div></div>
            <div><div style={{fontSize:10,color:V.textSoft,fontFamily:sans}}>Replied</div><div style={{fontSize:22,fontWeight:600,fontFamily:mono,color:g.reviews.replied===g.reviews.total?V.green:V.orange}}>{g.reviews.replied}/{g.reviews.total}</div></div>
          </div>
          {g.reviews.list?.slice(0,5).map((r:any,i:number)=>(
            <div key={i} style={{padding:'8px 0',borderTop:`1px solid ${V.border}`}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:2}}>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{fontWeight:600,fontSize:13,fontFamily:sans}}>{r.name}</span>
                  <span style={{color:V.star,fontSize:11}}>{'\u2605'.repeat(r.rating)}<span style={{color:'#E0DDD8'}}>{'\u2605'.repeat(5-r.rating)}</span></span>
                </div>
                <span style={{fontSize:11,color:V.textSoft,fontFamily:sans}}>{timeAgo(r.date)}</span>
              </div>
              {r.comment&&<p style={{fontSize:12.5,color:V.textMid,lineHeight:1.45,margin:'2px 0 0',fontFamily:sans}}>{r.comment.slice(0,140)}{r.comment.length>140?'...':''}</p>}
              {r.hasReply&&<p style={{fontSize:11,color:V.green,fontWeight:500,margin:'4px 0 0',fontFamily:sans}}>✓ Replied</p>}
            </div>
          ))}
        </div>
      )}

      {/* Profile health */}
      {g?.profile&&(
        <div style={{...card,animation:'fadeUp .5s .35s ease both'}}>
          <div style={lbl}>Profile Health</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <HI ok={g.profile.descriptionLength>=100} label="Description" val={g.profile.descriptionLength>0?'Set ✓':'Missing'}/>
            <HI ok={g.profile.hoursSet} label="Hours" val={g.profile.hoursSet?'Set ✓':'Not set'}/>
            <HI ok={g.profile.servicesCount>=3} label="Services" val={`${g.profile.servicesCount} listed`}/>
            <HI ok={g.profile.categoriesCount>=2} label="Categories" val={`${g.profile.categoriesCount} set`}/>
            <HI ok={g.profile.hasPhone} label="Phone" val={g.profile.hasPhone?'Set ✓':'Missing'}/>
            <HI ok={g.profile.hasWebsite} label="Website" val={g.profile.hasWebsite?'Set ✓':'Missing'}/>
            <HI ok={(g.photos?.total||0)>=3} label="Photos" val={`${g.photos?.total||0} up`}/>
            <HI ok={!!g.posts?.lastPostDate} label="Last post" val={g.posts?.lastPostDate?timeAgo(g.posts.lastPostDate):'Never'}/>
          </div>
          {g.reviews?.unreplied>0&&(
            <div style={{background:V.amberLight,borderRadius:12,padding:'11px 14px',display:'flex',gap:10,alignItems:'flex-start',marginTop:10}}>
              <span style={{fontSize:14,marginTop:1}}>⚠️</span>
              <span style={{fontSize:12,color:V.amber,lineHeight:1.4,fontWeight:500,fontFamily:sans}}>{g.reviews.unreplied} unanswered review{g.reviews.unreplied>1?'s':''} — we&apos;ll handle {g.reviews.unreplied>1?'these':'this'} once review management is active.</span>
            </div>
          )}
        </div>
      )}

      {/* Activity feed */}
      {d.activity?.length>0&&(
        <div style={{...card,animation:'fadeUp .5s .4s ease both'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <span style={{...lbl,marginBottom:0}}>Recent Activity</span>
            <span style={{fontSize:11,color:V.orange,fontWeight:500,cursor:'pointer',fontFamily:sans}}>View all</span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {d.activity.slice(0,4).map((a:any,i:number)=>(
              <div key={i} style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,marginTop:1,background:a.type==='post'?V.orangeLight:a.type==='reply'?V.greenLight:a.type==='scheduled'?'#EEF2FF':'#FFF0F5'}}>
                  {a.type==='post'?'📝':a.type==='reply'?'⭐':a.type==='scheduled'?'📋':'📊'}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,lineHeight:1.3,fontFamily:sans}}>{a.action}</div>
                  <div style={{fontSize:11,color:V.textSoft,marginTop:2,fontFamily:sans}}>{a.detail?`${a.detail} · `:''}{timeAgo(a.date)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Posts + Replies */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,animation:'fadeUp .5s .45s ease both'}}>
        <div style={{...card,padding:'14px 16px'}}><div style={lbl}>Posts by us</div><div style={{fontSize:38,fontWeight:600,lineHeight:1,fontFamily:mono,color:V.text}}>{p?.total_posts||0}</div><div style={{fontSize:12,color:V.textSoft,marginTop:1,fontFamily:sans}}>since you joined</div></div>
        <div style={{...card,padding:'14px 16px'}}><div style={lbl}>Replies by us</div><div style={{fontSize:38,fontWeight:600,lineHeight:1,fontFamily:mono,color:V.text}}>{p?.total_replies||0}</div><div style={{fontSize:12,color:V.textSoft,marginTop:1,fontFamily:sans}}>reviews handled</div></div>
      </div>

      {/* Empty state */}
      {!g&&d.recentPosts?.length===0&&(<div style={{...card,textAlign:'center',padding:'2rem'}}><p style={{fontWeight:600,fontSize:15,margin:'0 0 4px',fontFamily:sans}}>Your first post is on its way</p><p style={{fontSize:13,color:V.textSoft,margin:0,fontFamily:sans}}>We will write and publish to your Google profile this week.</p></div>)}

      {/* Refer */}
      <div style={{...card,animation:'fadeUp .5s .5s ease both'}}>
        <div style={{fontSize:15,fontWeight:600,fontFamily:sans}}>Refer a mate 👋</div>
        <div style={{fontSize:12,color:V.textSoft,marginTop:2,fontFamily:sans}}>You both get a free month.</div>
        <div style={{display:'flex',gap:8,marginTop:10,alignItems:'center'}}>
          <input readOnly value={`chocka.co.uk/ref/${d.user.referral_code||''}`} style={{flex:1,background:V.bg,border:'none',borderRadius:10,padding:'9px 12px',fontSize:12,fontFamily:mono,color:V.textSoft,outline:'none'}}/>
          <CopyBtn code={d.user.referral_code}/>
        </div>
      </div>
      <div style={{height:50}}/>
    </>
  );
}

function SC({num,label,hl,star}:{num:string;label:string;hl?:boolean;star?:boolean}) {
  return (<div style={{background:'#F5F3EF',borderRadius:12,padding:'12px 10px',textAlign:'center'}}>
    <div style={{fontSize:22,fontWeight:600,fontFamily:"'DM Mono',monospace",lineHeight:1,color:hl?'#E8541A':'#1A1A1A'}}>{num}{star&&<span style={{color:'#FBBC04',fontSize:14,marginLeft:2}}>{'\u2605'}</span>}</div>
    <div style={{fontSize:10,color:'#999',marginTop:4,lineHeight:1.3,fontFamily:"'DM Sans',sans-serif"}}>{label}</div>
  </div>);
}

function HI({ok,label,val}:{ok:boolean;label:string;val:string}) {
  return (<div style={{display:'flex',alignItems:'center',gap:8,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>
    <span style={{width:7,height:7,borderRadius:'50%',background:ok?'#2D7A4F':'#E8A020',flexShrink:0}}/>{label}<span style={{marginLeft:'auto',fontSize:11,color:'#999'}}>{val}</span>
  </div>);
}

function CopyBtn({code}:{code:string}) {
  const [copied,setCopied]=useState(false);
  return <button onClick={()=>{navigator.clipboard.writeText(`https://chocka.co.uk/ref/${code}`);setCopied(true);setTimeout(()=>setCopied(false),2000)}} style={{background:'#1A1A1A',color:'white',border:'none',borderRadius:10,padding:'9px 16px',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>{copied?'Copied!':'Copy'}</button>;
}

function timeAgo(ds:string):string {
  if(!ds)return '';const diff=Date.now()-new Date(ds).getTime();const m=Math.floor(diff/60000);
  if(m<1)return 'Just now';if(m<60)return`${m}m ago`;const h=Math.floor(m/60);if(h<24)return`${h}h ago`;
  const d=Math.floor(h/24);if(d===1)return'Yesterday';if(d<7)return`${d}d ago`;
  return new Date(ds).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
