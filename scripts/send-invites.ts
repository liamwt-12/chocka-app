/**
 * Mint and send retailer invites in bulk.
 *
 * This is the only script here that contacts real businesses. Everything about it
 * is built to make a mistake small and recoverable rather than fast.
 *
 * WHAT IT WRITES
 *   retailer_invites  one 'pending' row per retailer (token_hash, email, expires_at)
 *                     then sent_at stamped IMMEDIATELY after that retailer's send
 *
 * SAFETY
 *   - DRY RUN by default. It only sends with `--commit`.
 *   - `--limit N` caps the run. Send 1 first, then 5, then the rest.
 *   - Serial with a pause between sends. Resend's standard limit is ~2 req/sec and
 *     this is 176 emails; Promise.all would trip it and half the retailers would
 *     silently never hear from us.
 *   - sent_at is the idempotency guard. A retailer that already has it is skipped,
 *     so a crashed run resumes rather than double-sending. Two invites from a
 *     stranger reads as spam, and there is no undo.
 *   - Stamped per send, never in bulk at the end. If send 40 fails, sends 1-39 stay
 *     recorded.
 *   - Reuses an existing pending invite rather than minting a second one, so a
 *     retry cannot leave a retailer holding two live tokens.
 *
 * THE SCORE IS WITHHELD WHERE IT IS NOT TRUSTWORTHY
 *   Retailers whose match_confidence is not 'high' get the no-score variant of the
 *   email. The 2026-07-30 verification found seven rows scoring a different
 *   business entirely. Quoting someone else's number at a retailer we are cold-
 *   emailing is the worst possible first impression, so resolveRetailerScore's
 *   needsVerification decides, not the raw column.
 *
 * USAGE (tsx does not read .env.local by itself):
 *   npx tsx --env-file=.env.local scripts/send-invites.ts                 # dry run, all
 *   npx tsx --env-file=.env.local scripts/send-invites.ts --limit 1       # dry run, one
 *   npx tsx --env-file=.env.local scripts/send-invites.ts --limit 1 --commit
 *   npx tsx --env-file=.env.local scripts/send-invites.ts --source-ref 29438 --commit
 */
import { createClient } from '@supabase/supabase-js';
import {
  generateInviteToken, hashInviteToken, inviteExpiresAt, signUnsubscribeRef, DEFAULT_TTL_DAYS,
} from '../lib/invite-token';
import { getTenantBySlug } from '../lib/tenant';
import { resolveRetailerScore } from '../lib/retailer-score';
import { sendEmail, retailerInviteEmail, retailerInviteSubject } from '../lib/email';

const TENANT_SLUG = 'stellar';

/**
 * Retailers excluded from sending, by source_ref, with the reason.
 *
 * Not a config file and not a database column on purpose: each entry is a specific
 * factual problem with that row, and it should be read — and argued with — by
 * whoever next runs this.
 */
const SUPPRESSED: Record<string, string> = {
  // Two independent signals say this row does not describe the business it names.
  // Its Places match was Balham Flooring Studio, an unrelated firm sharing the
  // SW12 9AZ postcode (2026-07-30 verification), AND Tarkett's own contact_email
  // for the row is balhamflooringstudio@gmail.com. Emailing it would cold-contact
  // the wrong company about a score that is not theirs.
  '30261': 'Amtico Flooring Installations Limited — row describes/contacts a different business',
};
/** ~1.7 sends/sec, under Resend's ~2/sec. 176 retailers ≈ 105 seconds. */
const PAUSE_MS = 600;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: string;
  tenant_id: string;
  source_ref: string;
  name: string;
  town: string | null;
  contact_email: string | null;
  user_id: string | null;
  score: number | null;
  band: string | null;
  scored_at: string | null;
  match_confidence: string | null;
}

async function main() {
  const commit = process.argv.includes('--commit');
  const limit = arg('limit') ? Number(arg('limit')) : Infinity;
  const sourceRef = arg('source-ref');
  const ttlDays = Number(arg('ttl-days') ?? DEFAULT_TTL_DAYS);

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const tenant = getTenantBySlug(TENANT_SLUG);

  let q = db
    .from('retailers')
    .select('id,tenant_id,source_ref,name,town,contact_email,user_id,score,band,scored_at,match_confidence')
    .order('name');
  if (sourceRef) q = q.eq('source_ref', sourceRef);
  const { data, error } = await q.limit(1000);
  if (error) throw new Error(`retailer query failed: ${error.message}`);
  const retailers = (data ?? []) as Row[];

  // Everything already invited, in one query rather than per retailer.
  const { data: existing, error: invErr } = await db
    .from('retailer_invites')
    .select('id,retailer_id,status,sent_at,expires_at');
  if (invErr) throw new Error(`invite query failed: ${invErr.message}`);
  const byRetailer = new Map<string, any[]>();
  for (const inv of existing ?? []) {
    if (!byRetailer.has(inv.retailer_id)) byRetailer.set(inv.retailer_id, []);
    byRetailer.get(inv.retailer_id)!.push(inv);
  }

  // Anyone who has opted out. Checked before anything is minted or sent — a
  // suppression that only bites at send time still creates an invite row for
  // someone who has said no.
  const { data: suppressed, error: supErr } = await db
    .from('email_suppressions')
    .select('email');
  if (supErr) throw new Error(`suppression query failed: ${supErr.message}`);
  const suppressedEmails = new Set((suppressed ?? []).map((s: any) => String(s.email).toLowerCase()));
  if (suppressedEmails.size) console.log(`suppression list      : ${suppressedEmails.size} address(es)`);

  const skipped: string[] = [];
  const targets: Row[] = [];
  for (const r of retailers) {
    const invites = byRetailer.get(r.id) ?? [];
    if (SUPPRESSED[r.source_ref]) { skipped.push(`${r.name}: SUPPRESSED — ${SUPPRESSED[r.source_ref]}`); continue; }
    if (r.user_id) { skipped.push(`${r.name}: already connected`); continue; }
    if (!r.contact_email) { skipped.push(`${r.name}: no contact_email`); continue; }
    if (suppressedEmails.has(r.contact_email.toLowerCase())) { skipped.push(`${r.name}: UNSUBSCRIBED`); continue; }
    if (invites.some((i) => i.sent_at)) { skipped.push(`${r.name}: already sent`); continue; }
    targets.push(r);
  }

  const capped = targets.slice(0, limit === Infinity ? targets.length : limit);

  console.log(`retailers            : ${retailers.length}`);
  console.log(`skipped              : ${skipped.length}`);
  for (const s of skipped) console.log(`   - ${s}`);
  console.log(`eligible to send     : ${targets.length}`);
  console.log(`this run             : ${capped.length}${limit !== Infinity ? ` (--limit ${limit})` : ''}`);
  console.log(`mode                 : ${commit ? 'COMMIT — WILL SEND REAL EMAIL' : 'DRY RUN'}`);
  console.log(`pacing               : ${PAUSE_MS}ms between sends`);
  console.log('');

  let sent = 0;
  let failed = 0;
  // Indexed rather than .entries(): this repo targets es5, where iterating an
  // array iterator needs downlevelIteration.
  for (let i = 0; i < capped.length; i++) {
    const r = capped[i];
    const resolved = resolveRetailerScore({
      score: r.score, band: r.band, scored_at: r.scored_at, match_confidence: r.match_confidence,
    });
    const showScore = resolved.score !== null && !resolved.needsVerification;
    const subject = retailerInviteSubject(r.name, showScore ? resolved.score : null);
    const label = `[${i + 1}/${capped.length}] ${r.name} <${r.contact_email}>`;

    if (!commit) {
      console.log(`${label}  score=${showScore ? resolved.score : 'WITHHELD (' + r.match_confidence + ')'}`);
      console.log(`      subject: ${subject}`);
      continue;
    }

    // Reuse a pending invite rather than minting a second live token.
    const invites = byRetailer.get(r.id) ?? [];
    const pending = invites.find((x) => x.status === 'pending' && !x.sent_at);
    let inviteId = pending?.id as string | undefined;
    let token: string | null = null;

    if (!inviteId) {
      token = generateInviteToken();
      const { data: created, error: insErr } = await db
        .from('retailer_invites')
        .insert({
          retailer_id: r.id, tenant_id: r.tenant_id, email: r.contact_email,
          token_hash: hashInviteToken(token), status: 'pending',
          expires_at: inviteExpiresAt(new Date(), ttlDays).toISOString(),
        })
        .select('id').single();
      if (insErr) { console.error(`${label}  MINT FAILED: ${insErr.message}`); failed++; continue; }
      inviteId = created!.id;
    } else {
      // A pending invite exists but its token was never recorded anywhere — only
      // the hash is stored. Re-minting is the only way to obtain a sendable link,
      // so replace the row rather than send a link we cannot construct.
      token = generateInviteToken();
      const { error: upErr } = await db
        .from('retailer_invites')
        .update({
          token_hash: hashInviteToken(token),
          expires_at: inviteExpiresAt(new Date(), ttlDays).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', inviteId);
      if (upErr) { console.error(`${label}  RE-TOKEN FAILED: ${upErr.message}`); failed++; continue; }
    }

    const inviteUrl = `${tenant.appUrl}/invite/${token}`;
    const html = retailerInviteEmail({
      retailerName: r.name, town: r.town,
      score: showScore ? resolved.score : null,
      band: showScore ? resolved.band : null,
      inviteUrl,
      unsubscribeUrl: `${tenant.appUrl}/unsubscribe/${signUnsubscribeRef(r.id)}`,
      tenant,
    });

    const ok = await sendEmail({ to: r.contact_email!, subject, html, tenant });
    if (!ok) { console.error(`${label}  SEND FAILED — sent_at NOT stamped, safe to re-run`); failed++; await sleep(PAUSE_MS); continue; }

    // Stamp immediately, per send. A later failure must not un-record this one.
    const { error: stampErr } = await db
      .from('retailer_invites')
      .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', inviteId);
    if (stampErr) {
      console.error(`${label}  SENT but sent_at FAILED (${stampErr.message}) — re-running would DOUBLE SEND this one`);
    }
    sent++;
    console.log(`${label}  sent`);
    await sleep(PAUSE_MS);
  }

  console.log('');
  if (!commit) {
    console.log(`DRY RUN — nothing sent, nothing written. Add --commit to send.`);
  } else {
    console.log(`sent: ${sent}   failed: ${failed}`);
  }
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
