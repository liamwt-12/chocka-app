import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/session';
import { decidePostAction, publishTimeAfterApproval, POST_ACTIONS, type PostAction } from '@/lib/post-actions';

/**
 * Approve, edit, skip or cancel one of the signed-in shop's own posts, from its
 * dashboard. See lib/post-actions.ts.
 *
 *   POST { id, action: 'approve' | 'skip' | 'cancel' }
 *   POST { id, action: 'edit', content }
 *   POST { id, action: 'approve', content }     save new wording and approve it
 *
 * Nothing here publishes. Approving only lets the scheduled publisher take the
 * post at its time; everything it does is still logged and reversible.
 */
export async function POST(request: NextRequest) {
  const userId = getSessionUserId(request);
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const action = body?.action as PostAction;
  if (typeof body?.id !== 'string' || !POST_ACTIONS.includes(action)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  try {
    // Only ever a post that belongs to this shop.
    const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('user_id', userId).maybeSingle();
    if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 400 });
    const { data: post } = await supabaseAdmin.from('scheduled_posts').select('id, status, content, scheduled_for').eq('id', body.id).eq('profile_id', profile.id).maybeSingle();

    const d = decidePostAction(post, action, body.content);
    if (!d.ok) return NextResponse.json({ error: d.message }, { status: d.status });

    const patch: Record<string, unknown> = { ...d.patch };
    if (patch.status === 'pending_approval') {
      const when = publishTimeAfterApproval(post!.scheduled_for);
      if (when) patch.scheduled_for = when;
    }
    // Conditional on the state the shop saw, so a second press changes nothing.
    const { data: changed, error } = await supabaseAdmin.from('scheduled_posts').update(patch).eq('id', post!.id).eq('profile_id', profile.id).eq('status', d.fromStatus).select('id, status, content, scheduled_for');
    if (error) throw new Error(error.message);
    if (!changed?.length) return NextResponse.json({ error: 'This post changed while you were looking at it. Refresh the page.' }, { status: 409 });
    return NextResponse.json({ ok: true, message: d.message, post: changed[0] });
  } catch (e: any) {
    console.error('[posts/manage]', String(e?.message).slice(0, 200));
    return NextResponse.json({ error: 'We could not save that. Please try again.' }, { status: 500 });
  }
}
