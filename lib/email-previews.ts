/**
 * The emails that are switched off, with made-up sample content, so they can
 * be read in /admin/pilot before anyone decides to switch them on.
 *
 * Nothing here sends anything: it returns the subject and the plain text,
 * exactly as a shop would get them. The links in a sample go nowhere.
 */
import { postWaitingNotice, postBookedNotice, lowReviewNotice, newReviewNotice, holdingReplyPostedNotice, connectionLostNotice, type Notice } from './shop-notices';
import { holdingReply } from './safe-automation';
import type { Tenant } from './tenant';

export const EMAIL_PREVIEWS = [
  { key: 'post_waiting', label: 'A post is waiting for approval', setting: 'EARLY_POST_PREVIEW_EMAILS' },
  { key: 'post_booked', label: 'A post is booked and goes up unless the shop stops it', setting: 'Already sent (hands-off shops, and every shop after its first three posts); shown here to read' },
  { key: 'good_review_replied', label: 'New good review, we replied', setting: 'REVIEW_ALERT_EMAILS' },
  { key: 'good_review_not_replied', label: 'New good review, replies are off', setting: 'REVIEW_ALERT_EMAILS' },
  { key: 'low_review_needs_input', label: 'New low review, reply waiting for the shop', setting: 'REVIEW_ALERT_EMAILS (for shops with replies off; already sent to shops with replies on)' },
  { key: 'low_review_replied', label: 'New low review, holding reply posted', setting: 'HANDS_OFF_MODE' },
  { key: 'connection_lost', label: 'Google connection lost (once, then weekly until reconnected)', setting: 'CONNECTION_LOST_EMAILS' },
] as const;
export type EmailPreviewKey = (typeof EMAIL_PREVIEWS)[number]['key'];

const SHOP = 'Example Flooring';
const NOWHERE = '(a link, in the real one)';

export function emailPreview(key: string, tenant: Tenant, now: Date = new Date()): Notice | null {
  const good = { businessName: SHOP, reviewerName: 'Sam Example', rating: 5, comment: 'Really pleased with the new floor. Fitted on time and left tidy.', dashboardUrl: NOWHERE, settingsUrl: NOWHERE, tenant };
  const low = { businessName: SHOP, reviewerName: 'Alex Example', rating: 2, comment: 'Waited a long time for the fitter to arrive.' };
  switch (key) {
    case 'post_waiting':
      return postWaitingNotice({ businessName: SHOP, postContent: 'Thinking about a new floor before the spring? Call in and see the samples in our showroom, or ring us for a free measure.', scheduledFor: new Date(now.getTime() + 86_400_000).toISOString(), approveUrl: NOWHERE, skipUrl: NOWHERE, approvalsLeft: 3, tenant });
    case 'post_booked':
      return postBookedNotice({ businessName: SHOP, postContent: 'Thinking about a new floor before the spring? Call in and see the samples in our showroom, or ring us for a free measure.', scheduledFor: new Date(now.getTime() + 3 * 86_400_000).toISOString(), cancelUrl: NOWHERE, tenant });
    case 'good_review_replied':
      return newReviewNotice({ ...good, replyState: 'posted', reply: 'Thank you, Sam. We are glad you are pleased with it, and we will pass that on to the fitters.' });
    case 'good_review_not_replied':
      return newReviewNotice({ ...good, replyState: 'none' });
    case 'low_review_needs_input':
      return lowReviewNotice({ ...low, suggestedReply: holdingReply(low.reviewerName), approveUrl: NOWHERE, rejectUrl: NOWHERE, tenant });
    case 'low_review_replied':
      return holdingReplyPostedNotice({ ...low, reply: holdingReply(low.reviewerName), settingsUrl: NOWHERE, tenant });
    case 'connection_lost':
      return connectionLostNotice({ businessName: SHOP, settingsUrl: NOWHERE, tenant });
    default: return null;
  }
}
