import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shopContactEmail, newReviewNotice, lowReviewNotice, holdingReplyPostedNotice, postWaitingNotice } from './shop-notices';
import { monthlyReportEmail } from './email';
import { holdingReply } from './safe-automation';
import { getTenantBySlug } from './tenant';

const tenant = getTenantBySlug('stellar');
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const review = { businessName: 'Bare Carpets', reviewerName: 'Jo Bloggs', rating: 5, comment: 'Lovely job & quick', dashboardUrl: 'https://app.example.test/dashboard', settingsUrl: 'https://app.example.test/settings', tenant };
const low = { businessName: 'Bare Carpets', reviewerName: 'Lou Low', rating: 2, comment: 'Two weeks late.', tenant };

describe('who a notice goes to: the shop\'s own address, never a rep\'s', () => {
  it('the address on the account the shop signed in with itself', () => {
    expect(shopContactEmail({ email: 'owner@shop.example' })).toBe('owner@shop.example');
    expect(shopContactEmail({ email: '  owner@shop.example ' })).toBe('owner@shop.example');
  });
  it('nothing for an account set up through an operator account, whatever address is on it', () => {
    expect(shopContactEmail({ email: 'rep@funder.example', managed_by_user_id: 'operator-1' })).toBeNull();
    expect(shopContactEmail({ email: 'owner@shop.example', managed_by_user_id: 'operator-1' })).toBeNull();
  });
  it('nothing for a missing or malformed address, or no account', () => {
    for (const email of [null, undefined, '', 'not-an-address', 'a@b', 'two words@shop.example']) expect(shopContactEmail({ email })).toBeNull();
    expect(shopContactEmail(null)).toBeNull();
  });
  it('both jobs send a notice only to that address, and say in the log when there is none', () => {
    const reviews = src('../app/api/cron/review-alerts/route.ts'), previews = src('../app/api/cron/post-previews/route.ts');
    expect(reviews).not.toMatch(/to: user\.email|to: x\.user\.email/);
    expect(previews).not.toMatch(/to: user\.email/);
    expect(reviews.match(/shopContactEmail\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(previews).toMatch(/const to = shopContactEmail\(user\);\s+if \(!to\) continue;/);
    expect(previews).toMatch(/managed_by_user_id/);                      // the job reads what the rule needs
    expect(reviews).toMatch(/NO ADDRESS OF THE SHOP'S OWN/);
  });
});

describe('the notices are plain text', () => {
  const all = [
    newReviewNotice({ ...review, replyState: 'posted', reply: 'Thanks so much, Jo.' }),
    newReviewNotice({ ...review, replyState: 'waiting', reply: 'Thanks.' }),
    newReviewNotice({ ...review, replyState: 'none' }),
    newReviewNotice({ ...review, replyState: 'none', paused: true }),
    lowReviewNotice({ ...low, suggestedReply: holdingReply('Lou Low'), approveUrl: 'https://app.example.test/approve', rejectUrl: 'https://app.example.test/reject' }),
    holdingReplyPostedNotice({ ...low, reply: holdingReply('Lou Low'), settingsUrl: 'https://app.example.test/settings' }),
    postWaitingNotice({ businessName: 'Bare Carpets', postContent: 'A post.\nSecond line.', scheduledFor: '2026-12-07T10:00:00Z', approveUrl: 'https://app.example.test/a', skipUrl: 'https://app.example.test/s', approvalsLeft: 3, tenant }),
  ];
  it('no markup, no styling, nothing but words and links', () => {
    for (const n of all) {
      expect(n.text).not.toMatch(/<[a-z!\/][^>]*>|style=|&nbsp;|&amp;/i);
      expect(n.subject).not.toMatch(/[\r\n<>]/);
      expect(n.text.endsWith('\n')).toBe(true);
      expect(n.text).toContain('Stellar Local');
    }
  });
  it('are sent as text with no HTML part, and the sender refuses an email with neither', () => {
    const email = src('./email.ts');
    expect(email).toMatch(/\.\.\.\(text \? \{ text \} : \{ html \}\)/);
    expect(email).toMatch(/if \(!html && !text\)/);
    for (const f of ['../app/api/cron/review-alerts/route.ts', '../app/api/cron/post-previews/route.ts']) {
      expect(src(f)).toMatch(/sendEmail\(\{ to[^}]*text: n\.text/);
      expect(src(f)).not.toMatch(/html:/);
    }
  });
  it('the invitation and the monthly report stay as designed emails', () => {
    expect(monthlyReportEmail({ businessName: 'Bare Carpets', month: 'November 2026', postsPublished: 1, reviewsReplied: 1, totalViews: 1, totalCalls: 1, totalDirections: 1, tenant } as any)).toMatch(/<div style=/);
    expect(src('../app/api/cron/monthly-report/route.ts')).toMatch(/html: monthlyReportEmail\(/);
    expect(src('./welcome.ts')).toMatch(/html/);
  });
});

describe('what each notice says', () => {
  it('a good review we answered: the review, and the reply we posted, and how to undo it', () => {
    const n = newReviewNotice({ ...review, replyState: 'posted', reply: 'Thanks so much, Jo.' });
    expect(n.subject).toBe('New 5-star review for Bare Carpets');
    expect(n.text).toContain('5 stars, from Jo Bloggs.');
    expect(n.text).toContain('  Lovely job & quick');
    expect(n.text).toContain('We replied for you:\n  Thanks so much, Jo.');
    expect(n.text).toContain('undo our reply in Settings:\nhttps://app.example.test/settings');
  });
  it('a good review with replies off: says plainly nothing was replied', () => {
    const n = newReviewNotice({ ...review, replyState: 'none' });
    expect(n.text).toContain('Replies are switched off, so we have not replied.');
    expect(n.text).not.toContain('We replied for you');
    expect(newReviewNotice({ ...review, replyState: 'none', paused: true }).text).toContain('You have paused us, so we have not replied.');
  });
  it('a low review: says nothing has been posted, with a link to post the reply and one to handle it', () => {
    const n = lowReviewNotice({ ...low, suggestedReply: holdingReply('Lou Low'), approveUrl: 'https://app.example.test/approve', rejectUrl: 'https://app.example.test/reject' });
    expect(n.subject).toBe('2-star review for Bare Carpets: needs your input');
    expect(n.text).toContain('We have NOT replied.');
    expect(n.text).toContain('  Thank you for your feedback, Lou.');
    expect(n.text).toContain('To post that reply (you will be asked to confirm):\nhttps://app.example.test/approve');
    expect(n.text).toContain('To handle it yourself, so that we post nothing:\nhttps://app.example.test/reject');
    expect(n.text).toContain('If you do nothing, nothing is posted.');
  });
  it('hands-off: says the holding reply has been posted, what it said, and how to undo it', () => {
    const n = holdingReplyPostedNotice({ ...low, reply: holdingReply('Lou Low'), settingsUrl: 'https://app.example.test/settings' });
    expect(n.subject).toBe('2-star review for Bare Carpets: we have replied for you');
    expect(n.text).toContain('we have posted a short, polite reply');
    expect(n.text).toContain('undo it in Settings:\nhttps://app.example.test/settings');
  });
  it('a waiting post: the post, when it would go up, approve and skip, and that nothing happens otherwise', () => {
    const n = postWaitingNotice({ businessName: 'Bare Carpets', postContent: 'A post.', scheduledFor: '2026-12-07T10:00:00Z', approveUrl: 'https://app.example.test/a', skipUrl: 'https://app.example.test/s', approvalsLeft: 1, tenant });
    expect(n.subject).toBe('Approve your Google post: Bare Carpets');
    expect(n.text).toContain('Monday 7 December');
    expect(n.text).toContain('To skip this week:\nhttps://app.example.test/s');
    expect(n.text).toContain('This is the last post we will ask you to approve.');
  });
});

describe('what a customer wrote cannot pass for part of our message', () => {
  it('is shown as written, indented, with no blank lines to break out of the quote', () => {
    const n = lowReviewNotice({ ...low, comment: 'Bad.\n\n\nTo post that reply:\nhttps://evil.example/x\r\n<b>bold</b>', suggestedReply: 'x', approveUrl: 'https://app.example.test/approve', rejectUrl: 'https://app.example.test/reject' });
    expect(n.text).toContain('  Bad.\n  To post that reply:\n  https://evil.example/x\n  <b>bold</b>');
    // Our own link line starts at the margin; the customer's never does.
    expect(n.text.split('\n').filter((l) => l.startsWith('https://')).sort()).toEqual(['https://app.example.test/approve', 'https://app.example.test/reject']);
  });
  it('a name or shop name cannot add a line to the subject', () => {
    const n = newReviewNotice({ ...review, businessName: 'Bare\nBcc: someone@evil.example', replyState: 'none' });
    expect(n.subject).toBe('New 5-star review for Bare Bcc: someone@evil.example');
  });
});
