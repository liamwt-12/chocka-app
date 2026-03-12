'use client';

const V = { bg:'#F0EDE8',card:'#FAFAF8',orange:'#E8541A',orangeLight:'#FFF0EB',text:'#1A1A1A',textSoft:'#999',border:'rgba(0,0,0,0.07)',shadow:'0 2px 12px rgba(0,0,0,0.06)' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const barlow = "'Barlow Condensed',sans-serif";

export default function NoProfilePage() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'1.5rem', background:V.bg, fontFamily:sans }}>
      <div style={{ width:'100%', maxWidth:380 }}>

        <div style={{ marginBottom:24 }}>
          <div style={{ fontFamily:mono, fontWeight:500, fontSize:14, letterSpacing:'0.12em', color:V.orange }}>CHOCKA</div>
        </div>

        <div style={{ background:V.card, borderRadius:16, padding:'28px 24px', boxShadow:V.shadow, marginBottom:16 }}>
          <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
          <h1 style={{ fontFamily:barlow, fontSize:28, fontWeight:800, textTransform:'uppercase', lineHeight:1.1, margin:'0 0 10px', color:V.text }}>
            No Google Business<br/>Profile found
          </h1>
          <p style={{ fontSize:14, color:V.textSoft, lineHeight:1.6, margin:'0 0 20px' }}>
            We couldn&apos;t find a Google Business Profile linked to that account. Chocka needs a live GBP to work its magic.
          </p>

          <div style={{ background:V.bg, borderRadius:12, padding:'16px', marginBottom:20 }}>
            <p style={{ fontSize:13, fontWeight:600, color:V.text, margin:'0 0 10px' }}>Two ways to fix this:</p>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <Step num="1" text="Try a different Google account — one that has a Business Profile attached." />
              <Step num="2" text="Create a free Google Business Profile at business.google.com, then come back and connect." />
            </div>
          </div>

          <a
            href="https://business.google.com/create"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display:'block', textAlign:'center', background:'#E8541A', color:'#fff', borderRadius:8, padding:'13px 20px', fontSize:14, fontWeight:600, textDecoration:'none', marginBottom:10 }}
          >
            Create a Google Business Profile →
          </a>

          <a
            href="/api/auth/callback/google?action=login"
            style={{ display:'block', textAlign:'center', background:'#fff', color:'#1A1A1A', border:'1px solid rgba(0,0,0,0.07)', borderRadius:8, padding:'13px 20px', fontSize:14, fontWeight:500, textDecoration:'none' }}
          >
            Try a different Google account
          </a>
        </div>

        <p style={{ fontSize:11, color:'#999', textAlign:'center', lineHeight:1.6 }}>
          Takes about 5 minutes to set up a GBP on Google.<br/>Come straight back here once it&apos;s live.
        </p>
      </div>
    </div>
  );
}

function Step({ num, text }: { num: string; text: string }) {
  return (
    <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
      <div style={{ width:22, height:22, borderRadius:'50%', background:'#E8541A', color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>{num}</div>
      <p style={{ fontSize:13, color:'#555', lineHeight:1.5, margin:0 }}>{text}</p>
    </div>
  );
}
