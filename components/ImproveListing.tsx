'use client';

/**
 * "Here is what we could change. Tick what you want."
 *
 * One screen, three states:
 *   choose    every proposed change is shown in full, with a tick beside it.
 *             Opening hours are the shop's own: seven days to fill in, never a
 *             default. Every review reply is shown before it can be posted.
 *   working   each ticked change is sent on its own and checked against Google.
 *   results   what is now on the listing, what did not go through and why, and
 *             the score as measured from Google afterwards. Not a prediction.
 *
 * Nothing is sent to Google until the button on the first state is pressed, and
 * only what is ticked, exactly as shown, is sent. See lib/listing-fixes.ts.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import HoursEditor from './HoursEditor';
import { validateHoursDraft, describeHours, type HoursDraft } from '@/lib/opening-hours';

const V = { card: '#FAFAF8', card2: '#F5F3EF', brand: 'var(--brand-strong)', brandLight: 'var(--brand-strong-light)', green: '#2D7A4F', greenLight: '#E8F5EE', amber: '#B8860B', amberLight: '#FFF8E6', red: '#D93025', redLight: '#FDECEA', text: '#1A1A1A', mid: '#555', soft: '#8A8A8A', border: 'rgba(0,0,0,0.09)', shadow: '0 2px 12px rgba(0,0,0,0.06)', star: '#FBBC04' };
const sans = "'DM Sans',sans-serif";
const mono = "'DM Mono',monospace";
const barlow = "'Barlow Condensed',sans-serif";

interface Fix { key: string; label: string; description: string; pointsGain: number }
interface Item { key: string; label: string; score: number; maxScore: number; status: string; detail: string }
interface ManualGap { key: string; label: string; why: string; how: string }
interface Draft { reviewId: string; reviewerName: string; rating: number; comment: string; text: string; on: boolean }
interface StepResult { step: string; ok: boolean; message: string; nextStep?: string; retryable?: boolean }
interface Job { id: string; label: string; body: Record<string, unknown>; state: 'waiting' | 'working' | 'done' | 'failed'; result?: StepResult }

export interface ImproveProps {
  audit: { score: number; band: string; fixes: Fix[]; items: Item[] };
  hours: { draft: HoursDraft; daysSet: number; complex: boolean } | null;
  manual: ManualGap[];
  /** Offer to queue careful holding replies for recent lower-rated reviews (posts nothing). */
  offerLowStar: boolean;
  wordmark: string;
  onFinished: () => void;
  /** Leave without changing anything. */
  onSkip?: () => void;
}

const card: CSSProperties = { background: V.card, borderRadius: 16, padding: 16, boxShadow: V.shadow, marginBottom: 12 };
const btn: CSSProperties = { background: V.brand, color: 'white', border: 'none', padding: '15px 24px', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: sans };
const ghost: CSSProperties = { background: 'none', border: 'none', color: V.mid, fontSize: 14, cursor: 'pointer', fontFamily: sans, width: '100%', padding: 12, marginTop: 4, textDecoration: 'underline' };
const area: CSSProperties = { width: '100%', background: V.card2, color: V.text, border: `1px solid ${V.border}`, borderRadius: 12, padding: 12, fontSize: 16, lineHeight: 1.5, resize: 'vertical', fontFamily: sans, outline: 'none', boxSizing: 'border-box' };

function Tick({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, border: `2px solid ${on ? V.brand : 'rgba(0,0,0,0.25)'}`, background: on ? V.brand : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, padding: 0 }}>
      {on && <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5L5 9L9.5 3.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </button>
  );
}

function Section({ title, on, onChange, disabled, note, children }: { title: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ ...card, border: `1px solid ${on ? V.brand : 'transparent'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <Tick on={on} onChange={onChange} label={title} disabled={disabled} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: V.text }}>{title}</div>
          {note && <div style={{ fontSize: 13, color: V.soft, marginTop: 1 }}>{note}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

const Stars = ({ n }: { n: number }) => <span style={{ color: V.star, fontSize: 13 }} aria-label={`${n} stars`}>{'★'.repeat(n)}<span style={{ color: '#DDD' }}>{'★'.repeat(Math.max(0, 5 - n))}</span></span>;

export default function ImproveListing({ audit, hours, manual, offerLowStar, wordmark, onFinished, onSkip }: ImproveProps) {
  const has = (k: string) => audit.fixes.some((f) => f.key === k);
  const [stage, setStage] = useState<'choose' | 'working' | 'results'>('choose');

  // What the model drafted, for the shop to read and edit.
  const [loading, setLoading] = useState(true);
  const [desc, setDesc] = useState(''); const [descOn, setDescOn] = useState(false);
  const [svcs, setSvcs] = useState<string[]>([]); const [svcsOn, setSvcsOn] = useState(false);
  const [cats, setCats] = useState<string[]>([]); const [catsOn, setCatsOn] = useState(false);
  const [post, setPost] = useState(''); const [postOn, setPostOn] = useState(false);
  const [lowStar, setLowStar] = useState(0); const [lowOn, setLowOn] = useState(false);
  // The shop's own hours. Starts from what Google holds; never from a default.
  const [hrs, setHrs] = useState<HoursDraft | null>(hours && !hours.complex ? hours.draft : null);
  const [hrsOn, setHrsOn] = useState(false);
  const hrsCheck = useMemo(() => (hrs ? validateHoursDraft(hrs) : null), [hrs]);
  // Every reply, in full, before any of them can be posted.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLeft, setDraftsLeft] = useState(0);
  const [draftsNote, setDraftsNote] = useState('');
  const [moreFound, setMoreFound] = useState(0);
  const draftsRef = useRef<Draft[]>([]);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [measured, setMeasured] = useState<{ score: number; band: string; manual: ManualGap[] } | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch('/api/audit/previews', { method: 'POST' });
        const d = res.ok ? await res.json() : { previews: {} };
        if (dead) return;
        const p = d.previews || {};
        if (p.description && has('description')) { setDesc(p.description); setDescOn(true); }
        if (p.services?.length && has('services')) { setSvcs(p.services); setSvcsOn(true); }
        if (p.categories?.length && has('categories')) { setCats(p.categories); setCatsOn(true); }
        if (p.firstPost && has('firstPost')) { setPost(p.firstPost); setPostOn(true); }
        if (p.lowStarUnreplied && offerLowStar) { setLowStar(p.lowStarUnreplied); setLowOn(true); }
      } catch { /* nothing drafted: nothing offered */ }
      if (!dead) setLoading(false);
      if (has('reviews')) loadDrafts(() => dead);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drafts arrive three at a time, so a shop with twenty reviews is never left
  // waiting on one long request, and can start reading at once.
  async function loadDrafts(isDead: () => boolean) {
    for (let round = 0; round < 12; round++) {
      try {
        const res = await fetch('/api/onboarding/reply-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ have: draftsRef.current.map((x) => x.reviewId) }) });
        const d = await res.json();
        if (isDead()) return;
        if (d.problem) { setDraftsNote(d.problem); setDraftsLeft(0); return; }
        const fresh: Draft[] = (d.drafts || []).map((x: any) => ({ ...x, on: !!x.text }));
        draftsRef.current = [...draftsRef.current, ...fresh];
        setDrafts(draftsRef.current);
        setDraftsLeft(d.remaining || 0);
        setMoreFound(Math.max(0, (d.total || 0) - (d.offered || 0)));
        if (!d.remaining || !fresh.length) return;
      } catch { if (!isDead()) { setDraftsNote('We could not finish drafting replies. The ones shown can still be posted.'); setDraftsLeft(0); } return; }
    }
  }

  const repliesOn = drafts.filter((d) => d.on && d.text.trim());
  const chosen = [descOn && desc.trim(), svcsOn && svcs.length, catsOn && cats.length, hrsOn && hrsCheck?.ok, postOn && post.trim(), lowOn && lowStar].filter(Boolean).length + repliesOn.length;

  function buildJobs(): Job[] {
    const j: Job[] = [];
    if (descOn && desc.trim()) j.push({ id: 'description', label: 'Business description', body: { step: 'description', text: desc }, state: 'waiting' });
    if (svcsOn && svcs.length) j.push({ id: 'services', label: `${svcs.length} services`, body: { step: 'services', names: svcs }, state: 'waiting' });
    if (catsOn && cats.length) j.push({ id: 'categories', label: `${cats.length} extra categor${cats.length === 1 ? 'y' : 'ies'}`, body: { step: 'categories', names: cats }, state: 'waiting' });
    if (hrsOn && hrsCheck?.ok) j.push({ id: 'hours', label: 'Opening hours', body: { step: 'hours', hours: hrsCheck.value }, state: 'waiting' });
    for (const d of repliesOn) j.push({ id: `reply:${d.reviewId}`, label: `Reply to ${d.reviewerName}`, body: { step: 'reply', reviewId: d.reviewId, text: d.text }, state: 'waiting' });
    if (lowOn && lowStar) j.push({ id: 'lowStar', label: 'Careful replies for you to approve', body: { step: 'lowStar' }, state: 'waiting' });
    if (postOn && post.trim()) j.push({ id: 'firstPost', label: 'Your first post', body: { step: 'firstPost', text: post }, state: 'waiting' });
    return j;
  }

  async function runJob(job: Job): Promise<Job> {
    try {
      const res = await fetch('/api/profile-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.body) });
      const d = await res.json().catch(() => null);
      // Done means the server said so after checking. Anything else is not done.
      if (d?.result) return { ...job, state: d.result.ok ? 'done' : 'failed', result: d.result };
      const lost = d?.code === 'google_disconnected' || d?.code === 'not_authenticated';
      return { ...job, state: 'failed', result: { step: job.id, ok: false, message: lost ? 'We have lost the connection to your Google account.' : 'We could not make this change.', nextStep: lost ? 'Sign in with Google again, then come back to this.' : 'Press "Try again".', retryable: !lost } };
    } catch {
      return { ...job, state: 'failed', result: { step: job.id, ok: false, message: 'We could not reach our own server.', nextStep: 'Check your signal and press "Try again".', retryable: true } };
    }
  }

  async function finish() {
    setFinishing(true);
    try {
      const res = await fetch('/api/profile-fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'finish' }) });
      const d = await res.json().catch(() => null);
      setMeasured(d?.measured ?? null);
      setBefore(d?.scoreAtActivation ?? null);
    } catch { setMeasured(null); }
    setFinishing(false);
    setStage('results');
  }

  async function start() {
    const list = buildJobs();
    setJobs(list); setStage('working');
    window.scrollTo(0, 0);
    const out = [...list];
    for (let i = 0; i < out.length; i++) {
      out[i] = { ...out[i], state: 'working' }; setJobs([...out]);
      out[i] = await runJob(out[i]); setJobs([...out]);
    }
    await finish();
  }

  async function retry(id: string) {
    const i = jobs.findIndex((j) => j.id === id); if (i < 0) return;
    const out = [...jobs];
    out[i] = { ...out[i], state: 'working' }; setJobs([...out]);
    out[i] = await runJob(out[i]); setJobs([...out]);
    await finish();
  }

  const wrap: CSSProperties = { minHeight: '100vh', fontFamily: sans, display: 'flex', justifyContent: 'center', background: '#F0EDE8', color: V.text };
  const box: CSSProperties = { width: '100%', maxWidth: 480, padding: '2rem 1.1rem 3rem' };
  const logo = <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 14, letterSpacing: '0.12em', color: V.brand }}>{wordmark}</div>;
  const h2: CSSProperties = { fontFamily: barlow, fontSize: 30, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1, margin: '12px 0 6px' };

  /* ── WORKING ── */
  if (stage === 'working') {
    return (
      <div style={wrap}><div style={box}>
        {logo}
        <h2 style={h2}>Updating your<br />listing</h2>
        <p style={{ fontSize: 15, color: V.mid, margin: '0 0 18px' }}>We make each change, then check Google has it. Please keep this page open.</p>
        <div style={{ ...card, padding: '6px 16px' }} aria-live="polite">
          {jobs.map((j) => (
            <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: `1px solid ${V.border}` }}>
              <span style={{ width: 22, textAlign: 'center', fontSize: 16, fontWeight: 700, color: j.state === 'done' ? V.green : j.state === 'failed' ? V.red : j.state === 'working' ? V.brand : V.soft }}>{j.state === 'done' ? '✓' : j.state === 'failed' ? '!' : j.state === 'working' ? '…' : '·'}</span>
              <span style={{ fontSize: 15, color: j.state === 'waiting' ? V.soft : V.text, flex: 1 }}>{j.label}</span>
              <span style={{ fontSize: 13, color: V.soft }}>{j.state === 'done' ? 'Checked' : j.state === 'failed' ? 'Not done' : j.state === 'working' ? 'Working' : 'Waiting'}</span>
            </div>
          ))}
          <div style={{ padding: '11px 0', fontSize: 14, color: V.soft }}>{finishing ? 'Reading your listing back from Google…' : 'Then we read your listing back from Google.'}</div>
        </div>
      </div></div>
    );
  }

  /* ── RESULTS ── */
  if (stage === 'results') {
    const done = jobs.filter((j) => j.state === 'done');
    const bad = jobs.filter((j) => j.state === 'failed');
    return (
      <div style={wrap}><div style={box}>
        {logo}
        <h2 style={h2}>{bad.length === 0 ? 'All done.' : done.length === 0 ? 'That did not work.' : 'Mostly done.'}</h2>
        <p style={{ fontSize: 15, color: V.mid, margin: '0 0 18px' }}>
          {bad.length === 0 ? `${done.length} change${done.length === 1 ? '' : 's'} made, and each one checked on Google.` : `${done.length} of ${jobs.length} changes made and checked. ${bad.length} did not go through.`}
        </p>

        <div style={{ ...card, textAlign: 'center' }}>
          {measured ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: V.soft }}>Your listing scores</div>
              <div style={{ fontFamily: mono, fontSize: 52, fontWeight: 600, lineHeight: 1.1, color: V.text }}>{measured.score}<span style={{ fontSize: 18, color: V.soft }}>/100</span></div>
              <div style={{ fontSize: 14, color: V.mid }}>
                {before !== null && before !== measured.score ? `It was ${before} when you joined. ` : ''}Measured from Google just now.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 15, color: V.mid }}>We could not read your listing back from Google just now, so there is no new score to show. Your dashboard will show it next time you look.</div>
          )}
        </div>

        {bad.length > 0 && (
          <div style={{ ...card, border: `1px solid ${V.red}`, background: V.redLight }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Not done</div>
            {bad.map((j) => (
              <div key={j.id} style={{ padding: '10px 0', borderTop: `1px solid ${V.border}` }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{j.label}</div>
                <div style={{ fontSize: 14, color: V.text, marginTop: 2 }}>{j.result?.message}</div>
                {j.result?.nextStep && <div style={{ fontSize: 14, color: V.mid, marginTop: 2 }}>{j.result.nextStep}</div>}
                {j.result?.retryable && <button onClick={() => retry(j.id)} style={{ ...btn, width: 'auto', padding: '9px 16px', fontSize: 14, marginTop: 8 }}>Try again</button>}
              </div>
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Done and checked</div>
            {done.map((j) => (
              <div key={j.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${V.border}` }}>
                <span style={{ color: V.green, fontWeight: 700 }}>✓</span>
                <span style={{ fontSize: 14, color: V.text }}>{j.result?.message || j.label}</span>
              </div>
            ))}
            <p style={{ fontSize: 13, color: V.soft, margin: '10px 0 0' }}>We keep a record of what each of these replaced. If you want any of them put back, tell us and we will.</p>
          </div>
        )}

        <ManualList gaps={measured?.manual ?? manual} />
        <button onClick={onFinished} style={btn}>Go to my dashboard</button>
      </div></div>
    );
  }

  /* ── CHOOSE ── */
  const nothingToOffer = !loading && !desc && !svcs.length && !cats.length && !post && !has('hours') && !has('reviews') && !lowStar;
  return (
    <div style={wrap}><div style={box}>
      {logo}
      <h2 style={h2}>What we could<br />improve</h2>
      <p style={{ fontSize: 15, color: V.mid, margin: '0 0 6px' }}>Read each one. Untick anything you do not want. <b>Nothing changes on Google until you press the button at the bottom.</b></p>
      {loading && <p style={{ fontSize: 14, color: V.soft }} aria-live="polite">Writing suggestions for you. This takes a few seconds…</p>}
      <div style={{ height: 12 }} />

      {has('hours') && (hours?.complex ? (
        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Opening hours</div>
          <p style={{ fontSize: 14, color: V.mid, margin: '6px 0 0' }}>Your hours on Google are more detailed than we can edit here (for example closed for lunch, or open late), so we will leave them exactly as they are.</p>
        </div>
      ) : hrs && (
        <Section title="Opening hours" on={hrsOn} onChange={(v) => setHrsOn(v && !!hrsCheck?.ok)} disabled={!hrsCheck?.ok}
          note={hours?.daysSet ? 'These are the hours Google has now. Change any that are wrong.' : 'Google has no hours for your shop. Fill in yours, or leave this unticked.'}>
          <HoursEditor value={hrs} onChange={(d) => { setHrs(d); const ok = validateHoursDraft(d).ok; setHrsOn(ok); }} />
          {!hrsCheck?.ok && <p style={{ fontSize: 13, color: V.soft, margin: '8px 0 0' }}>{hours?.daysSet || hrs.some((d) => d.open) ? (hrsCheck as any)?.error : 'We never guess your hours. If you leave this, your hours stay as they are.'}</p>}
          {hrsCheck?.ok && hrsOn && <p style={{ fontSize: 13, color: V.green, margin: '8px 0 0' }}>We will put exactly these hours on your listing.</p>}
        </Section>
      ))}

      {desc && (
        <Section title="Business description" on={descOn} onChange={setDescOn} note="Shown under “From the business” on Google. Edit it so it is true for you.">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={7} maxLength={750} style={area} aria-label="Business description" />
          <div style={{ fontSize: 12, color: desc.length > 730 ? V.red : V.soft, textAlign: 'right' }}>{desc.length} of 750</div>
        </Section>
      )}

      {svcs.length > 0 && (
        <Section title={`Services (${svcs.length})`} on={svcsOn} onChange={setSvcsOn} note="Added to any you already list. Tap one to remove it.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {svcs.map((s) => <button key={s} type="button" onClick={() => setSvcs(svcs.filter((x) => x !== s))} aria-label={`Remove ${s}`} style={{ background: V.card2, border: `1px solid ${V.border}`, borderRadius: 20, padding: '8px 12px', fontSize: 14, fontFamily: sans, cursor: 'pointer', color: V.text }}>{s} <span style={{ color: V.soft }}>×</span></button>)}
          </div>
        </Section>
      )}

      {cats.length > 0 && (
        <Section title="Extra categories" on={catsOn} onChange={setCatsOn} note="Your main category does not change. Tap one to remove it.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {cats.map((s) => <button key={s} type="button" onClick={() => setCats(cats.filter((x) => x !== s))} aria-label={`Remove ${s}`} style={{ background: V.card2, border: `1px solid ${V.border}`, borderRadius: 20, padding: '8px 12px', fontSize: 14, fontFamily: sans, cursor: 'pointer', color: V.text }}>{s} <span style={{ color: V.soft }}>×</span></button>)}
          </div>
        </Section>
      )}

      {has('reviews') && (
        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Replies to your good reviews</div>
          <p style={{ fontSize: 13, color: V.soft, margin: '2px 0 10px' }}>Each reply is shown here. Only the ticked ones are posted, exactly as written. You can change the wording.</p>
          {drafts.map((d, i) => (
            <div key={d.reviewId} style={{ borderTop: `1px solid ${V.border}`, padding: '12px 0' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Tick on={d.on} disabled={!d.text} label={`Post the reply to ${d.reviewerName}`} onChange={(v) => { const n = [...drafts]; n[i] = { ...d, on: v }; draftsRef.current = n; setDrafts(n); }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{d.reviewerName} <Stars n={d.rating} /></div>
                  <div style={{ fontSize: 14, color: V.mid, margin: '2px 0 8px' }}>{d.comment || '(no words, just a rating)'}</div>
                  {d.text ? (
                    <textarea value={d.text} rows={3} onChange={(e) => { const n = [...drafts]; n[i] = { ...d, text: e.target.value }; draftsRef.current = n; setDrafts(n); }} style={{ ...area, fontSize: 15, borderLeft: `3px solid ${V.brand}` }} aria-label={`Reply to ${d.reviewerName}`} />
                  ) : <div style={{ fontSize: 13, color: V.soft }}>We could not write a reply for this one, so nothing will be posted to it.</div>}
                </div>
              </div>
            </div>
          ))}
          {draftsLeft > 0 && <p style={{ fontSize: 14, color: V.soft, margin: '8px 0 0' }} aria-live="polite">Writing {draftsLeft} more…</p>}
          {!drafts.length && !draftsLeft && !draftsNote && <p style={{ fontSize: 14, color: V.soft, margin: 0 }} aria-live="polite">Writing replies…</p>}
          {draftsNote && <p style={{ fontSize: 14, color: V.amber, margin: '8px 0 0' }}>{draftsNote}</p>}
          {moreFound > 0 && <p style={{ fontSize: 13, color: V.soft, margin: '8px 0 0' }}>You have {moreFound} more unanswered reviews than we show here. We start with the newest and leave the older ones alone.</p>}
        </div>
      )}

      {lowStar > 0 && (
        <Section title={`${lowStar} lower-rated review${lowStar === 1 ? '' : 's'} with no reply`} on={lowOn} onChange={setLowOn} note="We never post a reply to these for you.">
          <p style={{ fontSize: 14, color: V.mid, margin: 0 }}>If ticked, we put a short, careful reply for each recent one on your dashboard. You read it and decide. Nothing is posted until you approve it there.</p>
        </Section>
      )}

      {post && (
        <Section title="Your first post" on={postOn} onChange={setPostOn} note="Goes up tomorrow at about 10am. You can cancel it from your dashboard before then.">
          <textarea value={post} onChange={(e) => setPost(e.target.value)} rows={4} style={area} aria-label="Your first post" />
        </Section>
      )}

      {nothingToOffer && <div style={card}><p style={{ fontSize: 15, color: V.mid, margin: 0 }}>There is nothing here we would change for you. Your listing already has the things we can fill in.</p></div>}

      <ManualList gaps={manual} />

      <div style={{ position: 'sticky', bottom: 0, background: 'linear-gradient(rgba(240,237,232,0), #F0EDE8 30%)', padding: '18px 0 6px' }}>
        {chosen > 0 && (
          <div style={{ fontSize: 13, color: V.mid, textAlign: 'center', marginBottom: 8 }}>
            {[descOn && desc.trim() && 'description', svcsOn && svcs.length && `${svcs.length} services`, catsOn && cats.length && `${cats.length} categories`, hrsOn && hrsCheck?.ok && `hours (${describeHours(hrsCheck.value).filter((l) => !l.endsWith('closed')).length} days open)`, repliesOn.length && `${repliesOn.length} repl${repliesOn.length === 1 ? 'y' : 'ies'}`, postOn && post.trim() && 'first post'].filter(Boolean).join(' · ')}
          </div>
        )}
        <button onClick={start} disabled={chosen === 0 || loading || draftsLeft > 0} style={{ ...btn, opacity: chosen === 0 || loading || draftsLeft > 0 ? 0.5 : 1 }}>
          {loading || draftsLeft > 0 ? 'Still writing…' : chosen === 0 ? 'Nothing ticked' : `Make ${chosen === 1 ? 'this 1 change' : `these ${chosen} changes`}`}
        </button>
        {onSkip && <button onClick={onSkip} style={ghost}>Not now. Change nothing.</button>}
      </div>
    </div></div>
  );
}

/** What the score counts that we do not do, and how the shop can. */
function ManualList({ gaps }: { gaps: ManualGap[] }) {
  if (!gaps?.length) return null;
  return (
    <div style={{ ...card, background: V.amberLight }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Things we do not do for you</div>
      <p style={{ fontSize: 13, color: V.mid, margin: '2px 0 6px' }}>These count towards your score, but only you can do them. Each takes a couple of minutes in Google.</p>
      {gaps.map((g) => (
        <details key={g.key} style={{ borderTop: `1px solid ${V.border}`, padding: '9px 0' }}>
          <summary style={{ fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{g.label}</summary>
          <div style={{ fontSize: 14, color: V.mid, marginTop: 4 }}>{g.why} {g.how}</div>
        </details>
      ))}
    </div>
  );
}
