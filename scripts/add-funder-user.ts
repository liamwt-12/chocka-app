/**
 * Give a person at Tarkett access to the console. Sends nothing.
 *
 *   npx tsx --env-file=.env.local scripts/add-funder-user.ts --email name@tarkett.com --name "Name"
 *   ...add --commit to write. Without it, nothing is written.
 *   --deactivate removes access (the row is kept, marked inactive).
 *
 * They sign in at /console with a one-time emailed link, which only works once
 * TARKETT_CONSOLE_ENABLED=on. Check the "Database" line before committing.
 */
import { createClient } from '@supabase/supabase-js';
import { normaliseEmail } from '../lib/funder-auth';

function arg(n: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const email = normaliseEmail(arg('email'));
  if (!email) throw new Error('Give --email <address>');
  const name = arg('name') ?? null;
  const commit = process.argv.includes('--commit');
  const deactivate = process.argv.includes('--deactivate');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase environment not set');
  console.log(`Database: ${new URL(url).host}`);
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: tenant } = await db.from('tenants').select('id').eq('slug', 'stellar').single();
  if (!tenant) throw new Error('Stellar tenant not found');
  const { data: existing } = await db.from('funder_users').select('id, active').ilike('email', email).maybeSingle();
  console.log(existing ? `Existing user, active=${existing.active}` : 'New user');
  if (!commit) { console.log(`DRY RUN: would ${deactivate ? 'deactivate' : 'grant access to'} ${email}. Add --commit.`); return; }
  if (deactivate) {
    if (!existing) throw new Error('No such user');
    await db.from('funder_users').update({ active: false }).eq('id', existing.id);
  } else if (existing) {
    await db.from('funder_users').update({ active: true, name: name ?? undefined }).eq('id', existing.id);
  } else {
    const { error } = await db.from('funder_users').insert({ email, name, tenant_id: tenant.id });
    if (error) throw error;
  }
  console.log('Done. Nothing was sent.');
}
main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
