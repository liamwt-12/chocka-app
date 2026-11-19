import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/session';
import { describeChange, undoChange } from '@/lib/revert';

/**
 * The shop's own view of what we have changed on its listing, and its own Undo.
 *
 * The shop is told it can undo anything. Until now that meant writing to us and
 * waiting for a developer to run a script. This shows the shop every change,
 * with what it was and what it became, and lets it put one back itself. The
 * undoing is lib/revert.ts, the same code support uses: checked on Google,
 * logged, and refused in plain words when it would not be safe.
 *
 *   GET                         the signed-in shop's changes, newest first
 *   POST { changeId }           undo one of them
 *
 * Only ever the signed-in shop's own changes.
 */
async function ownProfileId(request: NextRequest): Promise<{ userId: string; profileId: string | null } | null> {
  const userId = getSessionUserId(request);
  if (!userId) return null;
  const { data } = await supabaseAdmin.from('profiles').select('id').eq('user_id', userId).maybeSingle();
  return { userId, profileId: data?.id ?? null };
}

export async function GET(request: NextRequest) {
  const me = await ownProfileId(request);
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!me.profileId) return NextResponse.json({ changes: [] });
  const { data, error } = await supabaseAdmin.from('change_log').select('*').eq('profile_id', me.profileId).order('created_at', { ascending: false }).limit(40);
  if (error) { console.error('[changes]', error.message); return NextResponse.json({ error: 'Could not load' }, { status: 500 }); }
  // A change that never went through is not something the shop needs to see.
  return NextResponse.json({ changes: (data || []).filter((r: any) => r.status !== 'failed').map((r: any) => describeChange(r)) });
}

export async function POST(request: NextRequest) {
  const me = await ownProfileId(request);
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (typeof body?.changeId !== 'string' || !me.profileId) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const { data: row } = await supabaseAdmin.from('change_log').select('id, profile_id').eq('id', body.changeId).maybeSingle();
  if (!row || row.profile_id !== me.profileId) return NextResponse.json({ error: 'That change could not be found.' }, { status: 404 });
  // A shop never overrides the "changed again since" check: that is for a person helping it, who can look first.
  const result = await undoChange(supabaseAdmin, row.id, { confirm: true });
  console.log(`[changes] shop ${me.userId} undo of ${row.id}: ${result.ok ? 'done' : `not done (${result.detail || result.message})`}`);
  return NextResponse.json({ undo: { ok: result.ok, message: result.message } });
}
