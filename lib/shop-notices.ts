/**
 * Short notices to a shop, in plain text: a new review, a post waiting for its
 * approval, and (hands-off) the week's post before it goes up.
 *
 * WHY PLAIN TEXT. These are the messages a shop gets most often, and each asks
 * for at most one thing. A plain note from a person-sized address is read; a
 * designed email about a two-star review looks like marketing. The invitation
 * and the monthly report stay as designed emails (lib/email.ts).
 *
 * WHO GETS THEM. The shop's own address: the one on the account the shop
 * itself signed in with. NEVER a rep's or an operator's. An account that is
 * looked after through an operator account (lib/managed-access.ts) was set up
 * by someone else, so the address on it is not known to be the shop's, and no
 * notice is sent to it (shopContactEmail returns null, and the caller logs
 * that it was not sent).
 *
 * Plain text needs no escaping: what a customer wrote is shown as written and
 * cannot become markup. Line breaks inside it are kept; anything that would
 * let it pass for part of our own message (a run of blank lines) is closed up.
 *
 * Pure: builds text, sends nothing.
 */
import type { Tenant } from './tenant';

export interface Notice { subject: string; text: string }

/** The address a notice may go to, or null if there is none that is certainly the shop's own. */
export function shopContactEmail(user: { email?: string | null; managed_by_user_id?: string | null } | null | undefined): string | null {
  if (!user || user.managed_by_user_id) return null;
  const email = (user.email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

const stars = (n: number) => `${n} star${n === 1 ? '' : 's'}`;
/** A customer's words, kept on their own lines and never able to look like ours. */
const quoted = (s: string | null | undefined) => {
  const clean = String(s ?? '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
  return clean ? clean.split('\n').map((l) => `  ${l}`).join('\n') : '  (no comment left)';
};
const oneLine = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
const sign = (t: Tenant) => `${t.brandName}\n${t.supportEmail}`;
const join = (parts: Array<string | null | false>) => parts.filter((p): p is string => typeof p === 'string').join('\n\n') + '\n';

/** A new 4 or 5 star review. Says plainly what we did about it. */
export function newReviewNotice(p: { businessName: string; reviewerName: string; rating: number; comment: string; replyState: 'posted' | 'waiting' | 'none'; reply?: string | null; paused?: boolean; dashboardUrl: string; settingsUrl: string; tenant: Tenant }): Notice {
  const what = p.replyState === 'posted' ? `We replied for you:\n${quoted(p.reply)}\n\nIf you would rather it said something else, you can undo our reply in Settings:\n${p.settingsUrl}`
    : p.replyState === 'waiting' ? `We wrote this reply but could not post it just now. It is waiting on your dashboard:\n${quoted(p.reply)}\n\n${p.dashboardUrl}`
    : `${p.paused ? 'You have paused us, so we have not replied.' : 'Replies are switched off, so we have not replied.'} You can reply on Google yourself, or ${p.paused ? 'press Resume' : 'turn on replies to good reviews'} in Settings and we will answer the next one for you:\n${p.settingsUrl}`;
  return {
    subject: `New ${p.rating}-star review for ${oneLine(p.businessName)}`,
    text: join([`${oneLine(p.businessName)} has a new review on Google: ${stars(p.rating)}, from ${oneLine(p.reviewerName)}.`, quoted(p.comment), what, sign(p.tenant)]),
  };
}

/** A new 1 to 3 star review, with the holding reply waiting for the shop to approve. Nothing has been posted. */
export function lowReviewNotice(p: { businessName: string; reviewerName: string; rating: number; comment: string; suggestedReply: string; approveUrl: string; rejectUrl: string; tenant: Tenant }): Notice {
  return {
    subject: `${p.rating}-star review for ${oneLine(p.businessName)}: needs your input`,
    text: join([
      `${oneLine(p.businessName)} has a new review on Google: ${stars(p.rating)}, from ${oneLine(p.reviewerName)}.`,
      quoted(p.comment),
      `We have NOT replied. This short reply is ready if you want it:\n${quoted(p.suggestedReply)}`,
      `To post that reply (you will be asked to confirm):\n${p.approveUrl}`,
      `To handle it yourself, so that we post nothing:\n${p.rejectUrl}`,
      'If you do nothing, nothing is posted.',
      sign(p.tenant),
    ]),
  };
}

/** Hands-off only: a 1 to 3 star review came in and the fixed holding reply HAS been posted, as the shop agreed. */
export function holdingReplyPostedNotice(p: { businessName: string; reviewerName: string; rating: number; comment: string; reply: string; settingsUrl: string; tenant: Tenant }): Notice {
  return {
    subject: `${p.rating}-star review for ${oneLine(p.businessName)}: we have replied for you`,
    text: join([
      `${oneLine(p.businessName)} has a new review on Google: ${stars(p.rating)}, from ${oneLine(p.reviewerName)}.`,
      quoted(p.comment),
      `You asked us to look after replies, so we have posted a short, polite reply that asks the customer to contact you. Nothing else has been said on your behalf. The reply:\n${quoted(p.reply)}`,
      `You may want to get in touch with this customer yourself. If you would rather the reply was not there, or want to write your own, you can undo it in Settings:\n${p.settingsUrl}`,
      'To have these wait for you instead, choose "Ask me first" in Settings. You can also pause everything there.',
      sign(p.tenant),
    ]),
  };
}

/**
 * Hands-off only: this week's post is booked and goes up at its time unless
 * the shop stops it. The shop agreed to that in advance, so this asks for
 * nothing; it shows the post, says when, and gives the one link to stop it.
 */
export function postBookedNotice(p: { businessName: string; postContent: string; scheduledFor: string; cancelUrl: string; tenant: Tenant }): Notice {
  const when = new Date(p.scheduledFor).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  return {
    subject: `Your Google post for this week: ${oneLine(p.businessName)}`,
    text: join([
      `Here is the Google post we have written for ${oneLine(p.businessName)}. You asked us to look after your posts, so it goes up on ${when} unless you stop it.`,
      quoted(p.postContent),
      `To stop it, so that nothing is posted this week (you will be asked to confirm):\n${p.cancelUrl}`,
      'If you are happy with it, you do not need to do anything.',
      sign(p.tenant),
    ]),
  };
}

/** A post is waiting for the shop's approval and is due within a day. Nothing goes up unless it approves. */
export function postWaitingNotice(p: { businessName: string; postContent: string; scheduledFor: string; approveUrl: string; skipUrl: string; approvalsLeft: number; tenant: Tenant }): Notice {
  const when = new Date(p.scheduledFor).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  const after = p.approvalsLeft > 1
    ? 'This is one of your first three posts, so it only goes up if you approve it.'
    : 'This is the last post we will ask you to approve. After this one, we will send you each post in advance and it goes up unless you cancel it.';
  return {
    subject: `Approve your Google post: ${oneLine(p.businessName)}`,
    text: join([
      `Here is the Google post we have written for ${oneLine(p.businessName)}. If you approve it, it goes up on ${when}.`,
      quoted(p.postContent),
      `To approve it (you will be asked to confirm):\n${p.approveUrl}`,
      `To skip this week:\n${p.skipUrl}`,
      `If you do nothing, nothing is posted. ${after}`,
      sign(p.tenant),
    ]),
  };
}
