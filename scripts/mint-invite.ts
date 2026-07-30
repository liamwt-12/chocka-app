/**
 * Mint a single retailer invite and print its magic link.
 *
 * This is the manual counterpart to the sending job in Phase 4 — one retailer, one
 * link, printed to the terminal rather than emailed. It exists so the invite flow
 * can be walked end to end by a human before anything is sent to 176 real
 * businesses.
 *
 * WHAT IT WRITES
 *   retailer_invites  one 'pending' row: retailer_id, tenant_id, email (copied from
 *                     retailers.contact_email), token_hash, expires_at
 *
 * SAFETY
 *   - DRY RUN by default. It only writes with `--commit`.
 *   - Refuses if the retailer already has a pending invite. The partial unique
 *     index on (retailer_id) where status='pending' would reject it anyway, but a
 *     clear refusal beats a constraint error.
 *   - sent_at is left null. Minting is not sending; the row records that a link
 *     exists, not that anyone was contacted.
 *
 * THE TOKEN IS PRINTED ONCE AND NEVER STORED
 *   Only its HMAC goes to the database, so this output is the only copy. Lose it
 *   and the invite has to be revoked and re-minted — see lib/invite-token.
 *
 * USAGE (tsx does not read .env.local by itself):
 *   npx tsx --env-file=.env.local scripts/mint-invite.ts --source-ref 29438
 *   npx tsx --env-file=.env.local scripts/mint-invite.ts --source-ref 29438 --commit
 *   npx tsx --env-file=.env.local scripts/mint-invite.ts --name "Arbons" --commit
 */
import { createClient } from '@supabase/supabase-js';
import { generateInviteToken, hashInviteToken, inviteExpiresAt, DEFAULT_TTL_DAYS } from '../lib/invite-token';
import { getTenantBySlug } from '../lib/tenant';
import { resolveRetailerScore } from '../lib/retailer-score';

const TENANT_SLUG = 'stellar';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const commit = process.argv.includes('--commit');
  const sourceRef = arg('source-ref');
  const nameLike = arg('name');
  const ttlDays = Number(arg('ttl-days') ?? DEFAULT_TTL_DAYS);

  if (!sourceRef && !nameLike) {
    throw new Error('Give --source-ref <tarkett id> or --name <substring>');
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const tenant = getTenantBySlug(TENANT_SLUG);

  let q = db
    .from('retailers')
    .select('id,tenant_id,source_ref,name,town,contact_email,user_id,score,band,scored_at,match_confidence');
  q = sourceRef ? q.eq('source_ref', sourceRef) : q.ilike('name', `%${nameLike}%`);
  const { data: matches, error } = await q.limit(5);
  if (error) throw new Error(`retailer lookup failed: ${error.message}`);
  if (!matches || matches.length === 0) throw new Error('No retailer matched');
  if (matches.length > 1) {
    console.error('Ambiguous — matched several retailers:');
    for (const m of matches) console.error(`  ${m.source_ref}  ${m.name} (${m.town})`);
    throw new Error('Narrow it with --source-ref');
  }
  const r = matches[0];

  // Already claimed means someone has completed this flow for this retailer.
  if (r.user_id) {
    throw new Error(`Retailer ${r.name} is already linked to a user — nothing to invite`);
  }

  const { data: pending } = await db
    .from('retailer_invites')
    .select('id,expires_at')
    .eq('retailer_id', r.id)
    .eq('status', 'pending');
  if (pending && pending.length > 0) {
    throw new Error(
      `Retailer ${r.name} already has a pending invite (${pending[0].id}, expires ${pending[0].expires_at}). ` +
        `Revoke it before minting another.`,
    );
  }

  const resolved = resolveRetailerScore({
    score: r.score, band: r.band, scored_at: r.scored_at, match_confidence: r.match_confidence,
  });
  const willShowScore = resolved.score !== null && !resolved.needsVerification;

  console.log(`retailer      : ${r.name} (${r.town ?? 'no town'})  source_ref=${r.source_ref}`);
  console.log(`contact_email : ${r.contact_email ?? '(none — cannot be emailed later)'}`);
  console.log(`match_conf    : ${r.match_confidence}  score=${r.score ?? 'null'}`);
  console.log(`page will show a score: ${willShowScore}${willShowScore ? '' : '  (needsVerification or no score — by design)'}`);
  console.log(`expires       : ${inviteExpiresAt(new Date(), ttlDays).toISOString()} (${ttlDays} days)`);

  if (!commit) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to mint.');
    return;
  }

  const token = generateInviteToken();
  const { data: inv, error: insertError } = await db
    .from('retailer_invites')
    .insert({
      retailer_id: r.id,
      tenant_id: r.tenant_id,
      email: r.contact_email ?? 'unknown@invalid.example',
      token_hash: hashInviteToken(token),
      status: 'pending',
      expires_at: inviteExpiresAt(new Date(), ttlDays).toISOString(),
    })
    .select('id')
    .single();
  if (insertError) throw new Error(`insert failed: ${insertError.message}`);

  console.log(`\ninvite id     : ${inv!.id}`);
  console.log(`\n  ${tenant.appUrl}/invite/${token}\n`);
  console.log('That link is the only copy of the token. It is not recoverable from the database.');
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
