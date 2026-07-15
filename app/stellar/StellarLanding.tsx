'use client';

import { useEffect, useRef } from 'react';

// Decorative Stellar mark — aria-hidden so screen readers skip it.
const Star = () => (
  <svg className="st" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 1C12.8 8.2 15.8 11.2 23 12C15.8 12.8 12.8 15.8 12 23C11.2 15.8 8.2 12.8 1 12C8.2 11.2 11.2 8.2 12 1Z" />
  </svg>
);

// All styles scoped under `.stlr` so nothing leaks into the Chocka app.
const CSS = `
.stlr{
  --paper:#FCFBF9; --panel:#F1EFE9; --ink:#171717; --black:#000;
  --mute:#6E6E6E; --faint:#AEACA6;
  --gold:#B8923C; --gold-pale:#FFDFA4; --gold-soft:rgba(184,146,60,.12);
  --line:rgba(0,0,0,.10);
  --sans:var(--font-lato),system-ui,sans-serif;
  min-height:100vh;background:var(--paper);color:var(--ink);
  font-family:var(--sans);-webkit-font-smoothing:antialiased;scroll-behavior:smooth;
}
.stlr *{margin:0;padding:0;box-sizing:border-box}
.stlr ::selection{background:var(--gold);color:#fff}
.stlr .st{width:1em;height:1em;display:inline-block;vertical-align:-.06em;fill:currentColor}
.stlr .wrap{max-width:1040px;margin:0 auto;padding:0 26px}

.stlr nav{position:sticky;top:0;z-index:50;background:rgba(252,251,249,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.stlr nav .in{max-width:1040px;margin:0 auto;padding:14px 26px;display:flex;align-items:center;justify-content:space-between}
.stlr nav .wm{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
.stlr nav .wm .st{color:var(--gold);font-size:13px}
.stlr nav .wm em{font-style:normal;font-weight:300;letter-spacing:.16em;color:var(--mute)}
.stlr .btn{display:inline-flex;align-items:center;gap:9px;font-family:var(--sans);font-size:13px;font-weight:700;letter-spacing:.04em;color:#fff;background:var(--ink);border:none;padding:12px 20px;cursor:pointer;text-decoration:none;transition:.2s}
.stlr .btn:hover{background:var(--gold)}
.stlr .btn .g{width:16px;height:16px;background:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:var(--ink);font-size:11px;flex:none}
.stlr nav .btn{padding:10px 18px}
.stlr a:focus-visible,.stlr button:focus-visible{outline:2px solid var(--gold);outline-offset:3px}

.stlr .hero{background:#000;color:#fff;padding:clamp(70px,13vw,150px) 0 clamp(70px,12vw,130px);position:relative;overflow:hidden}
.stlr .hero .eye{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:var(--gold-pale);margin-bottom:30px}
.stlr .hero h1{font-weight:300;font-size:clamp(38px,8vw,76px);line-height:1.02;letter-spacing:-.02em;max-width:15ch}
.stlr .hero h1 b{font-weight:700;color:var(--gold-pale)}
.stlr .hero p{font-weight:300;font-size:clamp(18px,3vw,23px);line-height:1.55;color:#c9c9c9;margin-top:30px;max-width:44ch}
.stlr .hero .cta{margin-top:44px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.stlr .hero .micro{font-size:13px;color:#8f8f8f;letter-spacing:.02em}
.stlr .hero .btn{font-size:15px;padding:16px 26px;background:var(--gold-pale);color:#000}
.stlr .hero .btn:hover{background:#fff}
.stlr .hero .btn .g{background:#000;color:var(--gold-pale)}

.stlr .sec{padding:clamp(64px,11vw,110px) 0}
.stlr .eyebrow{font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);margin-bottom:20px}
.stlr .h2{font-weight:300;font-size:clamp(28px,5vw,44px);line-height:1.1;letter-spacing:-.01em;max-width:20ch}
.stlr .h2 b{font-weight:700}
.stlr .lead{font-weight:300;font-size:clamp(17px,2.6vw,20px);line-height:1.6;color:var(--mute);margin-top:22px;max-width:52ch}

.stlr .grid2{display:grid;grid-template-columns:1fr 1fr;gap:clamp(40px,7vw,80px);align-items:center}
@media(max-width:760px){.stlr .grid2{grid-template-columns:1fr;gap:40px}}

.stlr .scorecard{background:var(--panel);padding:clamp(28px,4vw,44px);border:1px solid var(--line)}
.stlr .scorecard .lab{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:16px}
.stlr .scorecard .sc{display:flex;align-items:flex-end;gap:10px;line-height:.8}
.stlr .scorecard .sc .n{font-weight:300;font-size:clamp(66px,12vw,96px);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stlr .scorecard .sc .of{font-weight:300;font-size:24px;color:var(--faint);padding-bottom:.4em}
.stlr .scorecard .track{height:3px;background:var(--line);margin-top:22px;position:relative;overflow:hidden}
.stlr .scorecard .track i{position:absolute;inset:0 auto 0 0;width:0;background:var(--gold);transition:width 1.8s cubic-bezier(.16,.84,.36,1)}
.stlr .scorecard .cl{margin-top:14px;font-size:14px;color:var(--mute)}
.stlr .scorecard .cl b{color:var(--ink);font-weight:700}

.stlr .do{list-style:none;margin-top:6px}
.stlr .do li{display:flex;align-items:baseline;gap:14px;padding:15px 0;border-top:1px solid var(--line);font-size:16px}
.stlr .do li .st{flex:none;color:var(--gold);font-size:12px}
.stlr .do li b{font-weight:700}
.stlr .do .none{margin-top:20px;font-weight:300;font-size:19px}

.stlr .rea{list-style:none;margin-top:6px}
.stlr .rea li{display:flex;align-items:baseline;gap:14px;padding:16px 0;border-top:1px solid var(--line);font-size:16px;line-height:1.5}
.stlr .rea li .st{flex:none;color:var(--gold);font-size:12px;position:relative;top:2px}
.stlr .rea li b{font-weight:700}
.stlr .rea li span{color:var(--mute)}
.stlr .rea li.key{background:var(--gold-soft);border-top-color:var(--gold);padding-left:16px;padding-right:16px;margin:0 -16px}

.stlr .win{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin-top:12px}
.stlr .win .w{background:var(--paper);padding:22px 18px}
.stlr .win .w .k{font-weight:700;font-size:16px;margin-bottom:8px}
.stlr .win .w .d{font-size:13.5px;color:var(--mute);line-height:1.5}
@media(max-width:760px){.stlr .win{grid-template-columns:1fr 1fr}}

.stlr .free{background:#000;color:#fff;padding:clamp(64px,11vw,110px) 0;text-align:center}
.stlr .free h2{font-weight:300;font-size:clamp(28px,5.5vw,48px);line-height:1.15;max-width:20ch;margin:0 auto}
.stlr .free h2 b{color:var(--gold-pale);font-weight:700}
.stlr .free .btn{margin-top:40px;font-size:15px;padding:16px 26px;background:var(--gold-pale);color:#000}
.stlr .free .btn:hover{background:#fff}
.stlr .free .btn .g{background:#000;color:var(--gold-pale)}
.stlr .free .micro{margin-top:18px;font-size:13px;color:#8f8f8f}

.stlr footer{padding:40px 0;border-top:1px solid var(--line);text-align:center}
.stlr footer .wm{display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
.stlr footer .wm .st{color:var(--gold);font-size:12px}
.stlr footer .wm em{font-style:normal;font-weight:300;letter-spacing:.16em;color:var(--mute)}
.stlr footer .claim{font-style:italic;font-weight:300;font-size:15px;color:var(--gold);margin-top:12px}
.stlr footer .by{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-top:14px}
.stlr footer .legal{margin-top:18px;font-size:12px;color:var(--mute)}
.stlr footer .legal a{color:var(--mute);text-decoration:underline;text-underline-offset:2px}
.stlr footer .legal a:hover{color:var(--ink)}

.stlr .rv{opacity:0;transform:translateY(16px);transition:opacity .8s,transform .8s}
.stlr .rv.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.stlr *{transition:none!important}.stlr .rv{opacity:1;transform:none}}
`;

export default function StellarLanding({ fontClass }: { fontClass: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Reveal-on-scroll for .rv elements.
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }),
      { threshold: 0.14 },
    );
    root.querySelectorAll('.rv').forEach((el) => io.observe(el));

    // Score climb when the card scrolls in.
    const card = root.querySelector('.scorecard');
    const scoreN = root.querySelector<HTMLElement>('#scoreN');
    const scoreFill = root.querySelector<HTMLElement>('#scoreFill');
    let so: IntersectionObserver | null = null;
    if (card && scoreN && scoreFill) {
      so = new IntersectionObserver(
        (es) => es.forEach((e) => {
          if (!e.isIntersecting) return;
          scoreFill.style.width = '85%';
          if (reduce) { scoreN.textContent = '85'; }
          else {
            const t0 = performance.now(), dur = 1800, ease = (x: number) => 1 - Math.pow(1 - x, 3);
            const tick = (now: number) => {
              const p = Math.min((now - t0) / dur, 1);
              scoreN.textContent = String(Math.round(42 + (85 - 42) * ease(p)));
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
          so!.unobserve(e.target);
        }),
        { threshold: 0.4 },
      );
      so.observe(card);
    }

    return () => { io.disconnect(); so?.disconnect(); };
  }, []);

  return (
    <div className={`stlr ${fontClass}`} lang="en-GB" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav><div className="in">
        <div className="wm"><Star /> Stellar <em>Local</em></div>
        <a className="btn" href="/api/auth/callback/google"><span className="g" aria-hidden="true">G</span> Connect</a>
      </div></nav>

      <header className="hero"><div className="wrap">
        <div className="eye"><Star /> Stellar Local &middot; a brand by Tarkett</div>
        <h1>Get found. Get the phone ringing. <b>Do nothing.</b></h1>
        <p>We look after your shop&rsquo;s presence on Google, so more local customers find you and call. It&rsquo;s free, because Tarkett pays for it.</p>
        <div className="cta">
          <a className="btn" href="/api/auth/callback/google"><span className="g" aria-hidden="true">G</span> Connect with Google</a>
          <span className="micro">Takes two minutes. You stay in control.</span>
        </div>
      </div></header>

      <section className="sec"><div className="wrap">
        <div className="eyebrow rv">Why it matters</div>
        <h2 className="h2 rv">Most people find a flooring shop <b>on Google now.</b></h2>
        <p className="lead rv">When someone nearby searches, Google shows the shops with the strongest, busiest profiles first. A quiet listing means you lose customers you never even knew were looking. We make sure you&rsquo;re the shop they find, and call.</p>
      </div></section>

      <section className="sec" style={{ background: 'var(--panel)' }}><div className="wrap">
        <div className="grid2">
          <div>
            <div className="eyebrow rv">What we do</div>
            <h2 className="h2 rv">We run it all for you. <b>In your voice.</b></h2>
            <ul className="do rv">
              <li><Star /><span><b>Post regularly</b>, so your profile stays active.</span></li>
              <li><Star /><span><b>Reply to every review</b>, quickly and politely.</span></li>
              <li><Star /><span><b>Add photos of your work</b> from the snaps you send.</span></li>
              <li><Star /><span><b>Ask your happy customers</b> for reviews, at the right moment.</span></li>
            </ul>
            <p className="do none rv">You do nothing. We handle all of it.</p>
          </div>
          <div className="scorecard rv">
            <div className="lab">Your Google presence</div>
            <div className="sc"><span className="n" id="scoreN">42</span><span className="of">/ 100</span></div>
            <div className="track"><i id="scoreFill" /></div>
            <div className="cl">Climbing from <b>42</b> to <b>85</b> in the first months.</div>
          </div>
        </div>
      </div></section>

      <section className="sec"><div className="wrap">
        <div className="eyebrow rv">You stay in control</div>
        <h2 className="h2 rv">Yours. <b>Always.</b></h2>
        <ul className="rea rv">
          <li><Star /><div><b>You stay the owner.</b> <span>We&rsquo;re a manager, like a member of staff, and you remove us in two taps.</span></div></li>
          <li className="key"><Star /><div><b>Undo anything, instantly.</b> <span>Every change is logged and reversible. Nothing is permanent without you.</span></div></li>
          <li><Star /><div><b>No money, no spam, no lock-in.</b> <span>We never touch your money or your customers&rsquo; details, and you can leave whenever you like.</span></div></li>
        </ul>
      </div></section>

      <section className="sec" style={{ background: 'var(--panel)' }}><div className="wrap">
        <div className="eyebrow rv">How you win</div>
        <h2 className="h2 rv">The better you look, <b>the more you win.</b></h2>
        <div className="win rv">
          <div className="w"><div className="k">Found</div><div className="d">More local buyers see you first.</div></div>
          <div className="w"><div className="k">Called</div><div className="d">More of them pick up the phone.</div></div>
          <div className="w"><div className="k">Reviewed</div><div className="d">More five-star reviews come in.</div></div>
          <div className="w"><div className="k">Rewarded</div><div className="d">Improve most in a month, win Tarkett product credit.</div></div>
        </div>
      </div></section>

      <section className="free"><div className="wrap">
        <h2 className="rv">It&rsquo;s free because Tarkett pays for it. <b>You just get found.</b></h2>
        <a className="btn rv" href="/api/auth/callback/google"><span className="g" aria-hidden="true">G</span> Connect with Google</a>
        <div className="micro rv">Two minutes. Your rep can do it with you.</div>
      </div></section>

      <footer>
        <div className="wm"><Star /> Stellar <em>Local</em></div>
        <div className="claim">Beauty in detail</div>
        <div className="by">A brand by Tarkett</div>
        <div className="legal"><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></div>
      </footer>
    </div>
  );
}
