/**
 * What a shop can do to a post from its dashboard: approve it, change its
 * wording, skip it, or cancel one that is booked.
 *
 * WHY. A new shop's first three posts wait for approval. The only way to
 * approve one was a link in an email that is switched off, so posts piled up
 * for ever with nobody able to let one through. Now the dashboard shows each
 * waiting post with three buttons, and the email can stay off.
 *
 * Every action is conditional on the post still being in the state the shop saw
 * it in, so pressing twice, or pressing after it has been published, changes
 * nothing and says so. Pure decision here; the route does the reading and writing.
 */
import { validateContent } from './ai';
import { AWAITING_APPROVAL, PUBLISHABLE } from './safe-automation';

export type PostAction = 'approve' | 'skip' | 'edit' | 'cancel';
export const POST_ACTIONS: PostAction[] = ['approve', 'skip', 'edit', 'cancel'];

export interface PostRow { id: string; status: string; content: string; scheduled_for: string }

export type Decision =
  | { ok: true; fromStatus: string; patch: Record<string, unknown>; message: string }
  | { ok: false; status: number; message: string };

export function decidePostAction(post: PostRow | null, action: PostAction, content: unknown, now: Date = new Date()): Decision {
  if (!post) return { ok: false, status: 404, message: 'That post could not be found.' };
  const waiting = post.status === AWAITING_APPROVAL;
  const booked = post.status === PUBLISHABLE;
  if (post.status === 'published') return { ok: false, status: 409, message: 'This post has already gone up on Google.' };
  if (post.status === 'cancelled') return { ok: false, status: 409, message: 'This post was already skipped.' };

  if (action === 'edit' || (action === 'approve' && typeof content === 'string')) {
    const text = typeof content === 'string' ? content.trim() : '';
    const check = validateContent(text, 'post');
    if (!check.valid) return { ok: false, status: 400, message: check.reason === 'length out of range' ? 'The post needs to be between a couple of sentences and a short paragraph.' : `That wording cannot go up (${check.reason}). Please change it.` };
    if (!waiting && !booked) return { ok: false, status: 409, message: 'This post can no longer be changed.' };
    // "Save" keeps it waiting; "Save and approve" lets it through with the new words.
    return action === 'approve'
      ? { ok: true, fromStatus: post.status, patch: { content: text, status: PUBLISHABLE, approved_at: now.toISOString() }, message: 'Saved and approved. It goes up at the time shown.' }
      : { ok: true, fromStatus: post.status, patch: { content: text }, message: 'Saved.' };
  }
  if (action === 'approve') {
    if (!waiting) return { ok: false, status: 409, message: booked ? 'This post is already approved.' : 'This post can no longer be approved.' };
    return { ok: true, fromStatus: AWAITING_APPROVAL, patch: { status: PUBLISHABLE, approved_at: now.toISOString() }, message: 'Approved. It goes up at the time shown.' };
  }
  if (action === 'skip' || action === 'cancel') {
    if (!waiting && !booked) return { ok: false, status: 409, message: 'This post can no longer be changed.' };
    return { ok: true, fromStatus: post.status, patch: { status: 'cancelled' }, message: 'Skipped. This post will not go up.' };
  }
  return { ok: false, status: 400, message: 'Unknown action.' };
}

/**
 * When an approved post should go up. A post approved after its slot has
 * passed goes at the next 10am-ish rather than at once in the middle of the
 * night, so the publisher's normal run picks it up. Pure.
 */
export function publishTimeAfterApproval(scheduledFor: string, now: Date = new Date()): string | null {
  return Date.parse(scheduledFor) > now.getTime() ? null : new Date(now.getTime() + 5 * 60_000).toISOString();
}
