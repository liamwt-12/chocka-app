/**
 * Live GBP test-matrix harness (semi-automated).
 *
 * You do the ONE manual step Google can't automate — the OAuth consent click —
 * once per throwaway account. This captures the resulting refresh token, then
 * runs the matrix assertions programmatically against the REAL Google Business
 * Profile API by calling getManageableListings and a faithful replica of the
 * audit path (getLocationFull → scoreProfile), asserting the expected result.
 *
 * What this DOES cover (backend decision logic): cases 1–8 at the library level,
 * incl. the three gating cases 2, 4, 8.
 * What it does NOT cover (needs a human in the browser): the UI/routing glue
 * (redirects, picker rendering, error-screen copy, Settings "Change listing"),
 * and case 5's "no bogus profiles row" DB side-effect. See TEST_MATRIX.md.
 *
 * ── One-time setup ─────────────────────────────────────────────────────────
 * 1. In the Google Cloud console, add this loopback redirect URI to the OAuth
 *    client's "Authorized redirect URIs":
 *        http://localhost:53682/oauth2callback
 *    (override the port with OAUTH_LOOPBACK_PORT if 53682 is taken.)
 * 2. Provide GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET — either exported in your
 *    shell or in a local .env file at the repo root (gitignored).
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   npm run live:connect -- <label>     # once per account; opens consent URL
 *   npm run live:run                    # runs all assertions for connected labels
 *
 * Labels drive which case each account is tested as:
 *   owner | manager | manager-multi | group | empty | revoked | mixed | denied
 *   (manager, group, denied are the gating cases 2, 4, 8.)
 *
 * Captured tokens live in .gbp-tokens.json (gitignored — refresh tokens).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getGoogleAuthUrl, exchangeCodeForTokens, refreshAccessToken,
  getManageableListings, getLocationFull, getGoogleUpdated, getAttributes,
  getMedia, getReviews, getLocalPosts,
} from '../lib/google';
import { scoreProfile, predictedScore } from '../lib/audit';

const TOKENS_PATH = fileURLToPath(new URL('../.gbp-tokens.json', import.meta.url));
const PORT = Number(process.env.OAUTH_LOOPBACK_PORT || 53682);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

function loadEnv() {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function fail(msg: string): never { console.error('\n✗ ' + msg + '\n'); process.exit(1); }

type Store = Record<string, { refresh_token: string; scope?: string; capturedAt: string }>;
function readStore(): Store { return existsSync(TOKENS_PATH) ? JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) : {}; }

// ── connect: capture a refresh token via the loopback OAuth flow ─────────────
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url || '', `http://localhost:${PORT}`);
      if (!u.pathname.startsWith('/oauth2callback')) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;padding:2rem">Captured. You can close this tab and return to the terminal.</body></html>');
      server.close();
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      if (err) reject(new Error('OAuth error: ' + err));
      else if (!code) reject(new Error('No code in callback'));
      else resolve(code);
    });
    server.listen(PORT, () => console.log(`\nWaiting for Google to redirect to ${REDIRECT_URI} …`));
  });
}

async function connect(label: string) {
  if (!label) fail('Usage: npm run live:connect -- <label>  (owner|manager|manager-multi|group|empty|revoked|mixed|denied)');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) fail('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (shell or .env).');
  process.env.GOOGLE_REDIRECT_URI = REDIRECT_URI; // force the loopback for auth + exchange

  const url = getGoogleAuthUrl(JSON.stringify({ label }));
  console.log(`\nOpen this URL, sign in as the "${label}" account, and grant access:\n\n${url}\n`);
  const code = await waitForCode();
  const tokens = await exchangeCodeForTokens(code);
  if (!tokens.refresh_token) fail('No refresh_token returned. Remove the app at myaccount.google.com/permissions and retry (prompt=consent forces one).');

  const store = readStore();
  store[label] = { refresh_token: tokens.refresh_token, scope: tokens.scope, capturedAt: new Date().toISOString() };
  writeFileSync(TOKENS_PATH, JSON.stringify(store, null, 2));
  console.log(`\n✓ Saved refresh token for "${label}". Run all cases with:  npm run live:run\n`);
}

// ── audit path: faithful replica of app/api/audit/route.ts's core ────────────
type AuditOutcome = { code: 'ok'; score: number; predicted: number } | { code: 'listing_access_denied' | 'listing_not_found' };
async function auditPath(accessToken: string, locationName: string, accountId?: string): Promise<AuditOutcome> {
  let location: any;
  try {
    location = await getLocationFull(accessToken, locationName);
  } catch (e: any) {
    if (e?.status === 403 || e?.googleStatus === 'PERMISSION_DENIED') return { code: 'listing_access_denied' };
    if (e?.status === 404 || e?.googleStatus === 'NOT_FOUND') return { code: 'listing_not_found' };
    throw e;
  }
  const [googleUpdated, attributes, media, reviews, posts] = await Promise.all([
    getGoogleUpdated(accessToken, locationName).catch(() => null),
    getAttributes(accessToken, locationName).catch(() => ({ attributes: [] })),
    getMedia(accessToken, locationName, accountId).catch(() => ({ mediaItems: [] })),
    getReviews(accessToken, locationName, accountId).catch(() => ({ reviews: [] })),
    getLocalPosts(accessToken, locationName, accountId).catch(() => ({ localPosts: [] })),
  ]);
  const audit = scoreProfile({ location, attributes, media, reviews, posts, googleUpdated });
  return { code: 'ok', score: audit.score, predicted: predictedScore(audit) };
}

// ── run: per-label assertions ────────────────────────────────────────────────
type Result = { pass: boolean | null; note: string }; // null = inconclusive

const CASES: Array<{ label: string; name: string; gating: boolean; run: (token: string) => Promise<Result> }> = [
  { label: 'owner', name: '1 — owner, one listing → auto-select', gating: false, run: async (tok) => {
    const at = await refreshAccessToken(tok);
    const ls = await getManageableListings(at);
    if (ls.length !== 1) return { pass: false, note: `expected 1 listing, got ${ls.length}` };
    const a = await auditPath(at, ls[0].locationName, ls[0].accountName);
    return a.code === 'ok' ? { pass: true, note: `1 listing, audit ok (score ${a.score})` } : { pass: false, note: `audit → ${a.code}` };
  } },
  { label: 'manager', name: '2 — manager, one listing (empty personal first) → managed one', gating: true, run: async (tok) => {
    const at = await refreshAccessToken(tok);
    const ls = await getManageableListings(at);
    if (ls.length !== 1) return { pass: false, note: `expected exactly 1 managed listing, got ${ls.length} (0 = empty-personal bug; >1 = mis-setup)` };
    const a = await auditPath(at, ls[0].locationName, ls[0].accountName);
    return a.code === 'ok'
      ? { pass: true, note: `bound to "${ls[0].title}" under ${ls[0].accountName}, audit ok (score ${a.score})` }
      : { pass: false, note: `audit → ${a.code}: the manager cannot read the bound listing` };
  } },
  { label: 'manager-multi', name: '3 — manager, several listings → picker', gating: false, run: async (tok) => {
    const at = await refreshAccessToken(tok);
    const ls = await getManageableListings(at);
    return ls.length > 1 ? { pass: true, note: `${ls.length} listings → picker path` } : { pass: false, note: `expected >1, got ${ls.length}` };
  } },
  { label: 'group', name: '4 — group-manager → grouped listing audits, no 403', gating: true, run: async (tok) => {
    const at = await refreshAccessToken(tok);
    const ls = await getManageableListings(at);
    const grp = ls.find((l) => l.accountType === 'LOCATION_GROUP');
    if (!grp) return { pass: false, note: `no LOCATION_GROUP listing enumerated (types seen: ${Array.from(new Set(ls.map((l) => l.accountType))).join(',') || 'none'})` };
    const a = await auditPath(at, grp.locationName, grp.accountName);
    return a.code === 'ok' ? { pass: true, note: `group listing "${grp.title}" audits ok (score ${a.score})` } : { pass: false, note: `audit → ${a.code}: the group location 403/404s` };
  } },
  { label: 'empty', name: '5 — no listings anywhere → no-profile', gating: false, run: async (tok) => {
    const at = await refreshAccessToken(tok);
    const ls = await getManageableListings(at);
    return ls.length === 0 ? { pass: true, note: `enumeration empty → no_profile (UI page + "no profiles row" still need a manual check)` } : { pass: false, note: `expected 0, got ${ls.length}` };
  } },
  { label: 'revoked', name: '6 — revoked/expired token → reconnect', gating: false, run: async (tok) => {
    try {
      await refreshAccessToken(tok);
      return { pass: false, note: 'refresh SUCCEEDED — token not revoked. Remove the app at myaccount.google.com/permissions, then re-run.' };
    } catch (e: any) {
      return String(e?.message).includes('invalid_grant')
        ? { pass: true, note: 'refresh throws invalid_grant → google_disconnected' }
        : { pass: null, note: `refresh failed but not invalid_grant: ${String(e?.message).slice(0, 80)}` };
    }
  } },
  { label: 'mixed', name: '7 — owner + group-manager → picker shows both', gating: false, run: async (tok) => {
    const at = await refreshAccessToken(tok);
    const ls = await getManageableListings(at);
    const accts = new Set(ls.map((l) => l.accountName));
    const hasGroup = ls.some((l) => l.accountType === 'LOCATION_GROUP');
    const hasNonGroup = ls.some((l) => l.accountType !== 'LOCATION_GROUP');
    return ls.length > 1 && accts.size > 1 && hasGroup && hasNonGroup
      ? { pass: true, note: `${ls.length} listings across ${accts.size} accounts (group + non-group)` }
      : { pass: false, note: `expected ≥2 listings spanning group+non-group accounts; got ${ls.length} across ${accts.size} accounts` };
  } },
  { label: 'denied', name: '8 — role-manageable but per-location denied → listing_access_denied', gating: true, run: async (tok) => {
    const at = await refreshAccessToken(tok);
    const ls = await getManageableListings(at);
    for (const l of ls) {
      const a = await auditPath(at, l.locationName, l.accountName);
      if (a.code === 'listing_access_denied') return { pass: true, note: `enumerated "${l.title}" but getLocationFull 403 → listing_access_denied (as designed)` };
    }
    return { pass: null, note: `no enumerated listing produced a 403 — the per-location-denial state isn't set up on this account. The synthetic mapping check below still exercises the 403/404→code path.` };
  } },
];

async function syntheticMappingCheck(store: Store): Promise<Result> {
  const first = Object.values(store)[0];
  if (!first) return { pass: null, note: 'no tokens connected' };
  const at = await refreshAccessToken(first.refresh_token);
  const a = await auditPath(at, 'locations/99999999999999999');
  return a.code === 'listing_access_denied' || a.code === 'listing_not_found'
    ? { pass: true, note: `getLocationFull on an inaccessible location → ${a.code} (mapping works)` }
    : { pass: false, note: `expected a denied/not-found mapping, got ${a.code}` };
}

async function run() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) fail('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (shell or .env).');
  const store = readStore();
  const connected = Object.keys(store);
  if (connected.length === 0) {
    console.log('\nNo accounts connected yet. Connect one (or more) first:\n  npm run live:connect -- manager   # gating case 2');
    console.log('  npm run live:connect -- group     # gating case 4');
    console.log('  npm run live:connect -- denied    # gating case 8');
    console.log('  (also: owner, manager-multi, empty, revoked, mixed)\n');
    return;
  }

  console.log(`\nConnected labels: ${connected.join(', ')}\n`);
  const rows: Array<{ name: string; gating: boolean; status: string; note: string }> = [];
  const gatingPass: boolean[] = [];

  for (const c of CASES) {
    if (!store[c.label]) { rows.push({ name: c.name, gating: c.gating, status: 'SKIP', note: `not connected (label "${c.label}")` }); continue; }
    let r: Result;
    try { r = await c.run(store[c.label].refresh_token); }
    catch (e: any) { r = { pass: false, note: `threw: ${String(e?.message).slice(0, 120)}` }; }
    const status = r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'INCONCLUSIVE';
    rows.push({ name: c.name, gating: c.gating, status, note: r.note });
    if (c.gating) gatingPass.push(r.pass === true);
  }

  let synth: Result;
  try { synth = await syntheticMappingCheck(store); }
  catch (e: any) { synth = { pass: false, note: `threw: ${String(e?.message).slice(0, 120)}` }; }

  console.log('Case                                                        Gating  Result        Note');
  console.log('─'.repeat(120));
  for (const r of rows) {
    console.log(`${r.name.padEnd(58)}  ${(r.gating ? 'YES' : '   ').padEnd(6)}  ${r.status.padEnd(12)}  ${r.note}`);
  }
  console.log(`${'(synthetic) 403/404 → code mapping'.padEnd(58)}  ${'   '.padEnd(6)}  ${(synth.pass === true ? 'PASS' : synth.pass === false ? 'FAIL' : 'INCONCLUSIVE').padEnd(12)}  ${synth.note}`);
  console.log('─'.repeat(120));

  const gatingRun = gatingPass.length;
  const gatingOk = gatingPass.every(Boolean);
  const gatingConnected = ['manager', 'group', 'denied'].filter((l) => store[l]);
  console.log(`\nGating cases (2 manager, 4 group, 8 denied): ${gatingConnected.length}/3 connected.`);
  if (gatingConnected.length < 3) console.log(`  Not yet connected: ${['manager', 'group', 'denied'].filter((l) => !store[l]).join(', ') || 'none'}`);
  console.log(gatingRun > 0 && gatingOk && gatingConnected.length === 3
    ? '\n✓ GO (logic level): all three gating cases PASS. Do one manual UI pass to confirm routing/screens.\n'
    : '\n✗ NO-GO (logic level): a gating case is not PASS or not connected. See rows above.\n');

  console.log('Reminder — the harness does NOT cover: OAuth consent, UI redirects/picker/error-screen copy,');
  console.log('Settings "Change listing", or case 5\'s "no profiles row" DB side-effect. Run those from TEST_MATRIX.md.\n');
}

// ── entry ────────────────────────────────────────────────────────────────────
loadEnv();
const [, , cmd, label] = process.argv;
if (cmd === 'connect') connect(label).catch((e) => fail(String(e?.message || e)));
else if (cmd === 'run') run().catch((e) => fail(String(e?.message || e)));
else fail('Usage:\n  npm run live:connect -- <label>\n  npm run live:run');
