import { getTenant, type Tenant } from './tenant';
import { redact } from './redact';
import { presenceComparison } from './presence-score';

const RESEND_API = 'https://api.resend.com/emails';

// Every export here takes an OPTIONAL tenant and falls back to getTenant().
//
// Optional rather than required on purpose: this module is called from cron
// routes, request routes and scripts, and making it required would be a
// breaking change across all of them at once. The fallback reproduces exactly
// the behaviour these functions had before tenancy existed, so an un-migrated
// caller is unchanged rather than broken.
//
// The cost is that forgetting to pass one is silent — a Stellar retailer gets
// Chocka's sender and wordmark. Any per-user send must pass the tenant resolved
// from the user's row via getTenantForRow(). See FOLLOWUPS "Pre-pilot — Stellar
// tenancy".

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Sender identity. Defaults to the primary tenant. */
  tenant?: Tenant;
}

export async function sendEmail({ to, subject, html, tenant }: SendEmailParams): Promise<boolean> {
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: (tenant ?? getTenant()).emailFrom,
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      // The provider's error can quote the address it refused. Keep the reason, not the address.
      console.error('Resend email failed:', res.status, redact(await res.text()));
      return false;
    }
    return true;
  } catch (err) {
    console.error('Email error:', err);
    return false;
  }
}

function emailWrapper(content: string, tenant?: Tenant): string {
  const t = tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const host = t.marketingUrl.replace(/^https?:\/\//, '');
  return `
    <div style="font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #1A1A1A;">
      <div style="font-size: 13px; font-weight: 600; letter-spacing: 0.12em; color: ${brand}; margin-bottom: 32px; font-family: 'Courier New', monospace;">${t.wordmark}</div>
      ${content}
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
        ${t.brandName} &middot; <a href="${t.marketingUrl}" style="color: #999;">${host}</a>
      </div>
    </div>
  `;
}

export function postPreviewEmail(
  businessName: string,
  postContent: string,
  cancelUrl: string,
  tenant?: Tenant,
): string {
  const t = tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const firstName = businessName.split(' ')[0];
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">Here's your Google post for this week. It goes live on Monday morning &mdash; if you're happy with it, do nothing.</p>

    <div style="background: #F0EDE8; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 20px 20px 20px 18px; margin-bottom: 28px;">
      <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${brand}; margin-bottom: 10px;">Your Google Post</div>
      <p style="font-size: 15px; line-height: 1.65; margin: 0; color: #1A1A1A;">${postContent}</p>
    </div>

    <p style="font-size: 14px; color: #555; margin: 0 0 20px; line-height: 1.6;">Not happy with it? No worries &mdash; just hit the button below and we'll scrap it.</p>

    <a href="${cancelUrl}" style="display: inline-block; background: #1A1A1A; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Cancel This Post</a>

    <p style="font-size: 13px; color: #bbb; margin: 20px 0 0;">If you do nothing, it goes up automatically. Sorted.</p>
  `, t);
}

export function reviewAlertEmail(params: {
  businessName: string;
  reviewerName: string;
  rating: number;
  comment: string;
  suggestedReply: string;
  approveUrl: string;
  rejectUrl: string;
  tenant?: Tenant;
}): string {
  const t = params.tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const stars = '★'.repeat(params.rating) + '☆'.repeat(5 - params.rating);
  const firstName = escHtml(params.businessName.split(' ')[0]);
  const isPositive = params.rating >= 4;

  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #555;">
      ${isPositive ? "A new review just came in &mdash; a good one." : "You've got a new review. Not a great one, but we've drafted a reply."}
    </p>

    <div style="background: #F0EDE8; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
      <div style="margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 14px;">${escHtml(params.reviewerName)}</span>
        <span style="color: ${isPositive ? brand : '#B8860B'}; font-size: 14px; margin-left: 8px;">${stars}</span>
      </div>
      <p style="font-size: 14px; color: #555; line-height: 1.55; margin: 0;">${escHtml(params.comment) || '(no comment left)'}</p>
    </div>

    <p style="font-size: 13px; color: #999; margin: 0 0 8px;">Our suggested reply:</p>
    <div style="background: #FFF0EB; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 16px 16px 16px 14px; margin-bottom: 28px;">
      <p style="font-size: 14px; color: #1A1A1A; line-height: 1.55; margin: 0;">${escHtml(params.suggestedReply)}</p>
    </div>

    <a href="${params.approveUrl}" style="display: inline-block; background: ${brand}; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; margin-right: 8px;">Publish This Reply</a>
    <a href="${params.rejectUrl}" style="display: inline-block; background: #1A1A1A; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">I'll Handle It</a>
  `, t);
}

export function monthlyReportEmail(params: {
  businessName: string;
  month: string;
  postsPublished: number;
  reviewsReplied: number;
  /** Google Search plus Maps impressions for the month; null = not enough stored days to report. */
  totalViews: number | null;
  totalCalls: number | null;
  /** The Search share of totalViews, shown under it when known. */
  searchViews?: number | null;
  totalWebsiteClicks?: number | null;
  /** Direction requests from weekly_stats. Optional so older callers still compile. */
  totalDirections?: number | null;
  /** Live presence score 0-100, or null if Google could not be reached this month. */
  presenceScore?: number | null;
  presenceBand?: string | null;
  /** Score at activation (profiles.audit_score), for the comparison line. */
  presenceScoreAtStart?: number | null;
  /** Pre-rendered "Change during your ads" section (lib/ad-comparison.ts), or empty. */
  adComparisonHtml?: string;
  /** Pre-rendered "What we did / What changed" in words (lib/report-narrative.ts), or empty. */
  narrativeHtml?: string;
  tenant?: Tenant;
}): string {
  const t = params.tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const firstName = params.businessName.split(' ')[0];
  const scoreBlock = typeof params.presenceScore === 'number' ? `
    <div style="background: #F0EDE8; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 12px;">
      <div style="font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;">Your Google presence score</div>
      <div style="font-size: 40px; font-weight: 700; color: ${brand}; font-family: 'Courier New', monospace;">${params.presenceScore}<span style="font-size: 18px; color: #999;">/100</span></div>
      ${params.presenceBand ? `<div style="font-size: 13px; color: #555; margin-top: 2px;">${params.presenceBand}</div>` : ''}
      <div style="font-size: 13px; color: #555; margin-top: 8px;">${presenceComparison(params.presenceScore, params.presenceScoreAtStart)}</div>
    </div>` : '';
  const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : '&ndash;');
  const metricsKnown = typeof params.totalViews === 'number';
  const extraRow = metricsKnown && (typeof params.totalDirections === 'number' || typeof params.totalWebsiteClicks === 'number') ? `
      <tr><td colspan="3" style="padding: 5px 0;"></td></tr>
      <tr>
        <td width="48%" style="background: #F0EDE8; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: #1A1A1A; font-family: 'Courier New', monospace;">${fmt(params.totalDirections)}</div>
          <div style="font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">Direction Requests</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background: #F0EDE8; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: #1A1A1A; font-family: 'Courier New', monospace;">${fmt(params.totalWebsiteClicks)}</div>
          <div style="font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">Website Clicks</div>
        </td>
      </tr>` : '';
  const searchLine = metricsKnown && typeof params.searchViews === 'number'
    ? `<div style="font-size: 11px; color: #999; margin-top: 2px;">${params.searchViews.toLocaleString()} from Google Search</div>` : '';
  const notYet = metricsKnown ? '' : `<p style="font-size: 13px; color: #999; margin: -16px 0 24px;">Google hasn't given us a full month of figures for you yet. They'll appear in next month's report.</p>`;
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">Here's what ${t.brandName} did for ${params.businessName} in ${params.month}.</p>${params.narrativeHtml ? `\n${params.narrativeHtml}` : ''}
${scoreBlock}
${params.adComparisonHtml ?? ''}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
      <tr>
        <td width="48%" style="background: #F0EDE8; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: ${brand}; font-family: 'Courier New', monospace;">${params.postsPublished}</div>
          <div style="font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">Posts Published</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background: #F0EDE8; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: ${brand}; font-family: 'Courier New', monospace;">${params.reviewsReplied}</div>
          <div style="font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">Reviews Replied</div>
        </td>
      </tr>
      <tr><td colspan="3" style="padding: 5px 0;"></td></tr>
      <tr>
        <td width="48%" style="background: #F0EDE8; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: #1A1A1A; font-family: 'Courier New', monospace;">${fmt(params.totalViews)}</div>
          <div style="font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">People Found You</div>${searchLine}
        </td>
        <td width="4%"></td>
        <td width="48%" style="background: #E8F5EE; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: #2D7A4F; font-family: 'Courier New', monospace;">${fmt(params.totalCalls)}</div>
          <div style="font-size: 11px; color: #2D7A4F; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">Phone Calls</div>
        </td>
      </tr>${extraRow}
    </table>
${notYet}

    <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0;">All handled automatically. No effort from you. That's the point.</p>
  `, t);
}

/**
 * The 24-hour preview for a post awaiting approval (a shop's first three). Sent
 * only by /api/cron/post-previews, and only when EARLY_POST_PREVIEW_EMAILS=on.
 * Unlike postPreviewEmail, nothing happens if the shop does nothing.
 */
export function postApprovalEmail(params: {
  businessName: string;
  postContent: string;
  scheduledFor: string;
  approveUrl: string;
  skipUrl: string;
  approvalsLeft: number;
  tenant?: Tenant;
}): string {
  const t = params.tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const firstName = params.businessName.split(' ')[0];
  const when = new Date(params.scheduledFor).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  const after = params.approvalsLeft > 1
    ? `This is one of your first ${params.approvalsLeft === 3 ? 'three' : params.approvalsLeft === 2 ? 'two' : ''} posts, so it only goes up if you approve it.`
    : 'This is the last post we will ask you to approve. After this one, we will email each post in advance and it goes up unless you cancel it.';
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #555;">Here's the Google post we've written for ${params.businessName}. If you approve it, it goes up on ${when}.</p>

    <div style="background: #F0EDE8; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 20px 20px 20px 18px; margin-bottom: 24px;">
      <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${brand}; margin-bottom: 10px;">Your Google Post</div>
      <p style="font-size: 15px; line-height: 1.65; margin: 0; color: #1A1A1A;">${params.postContent}</p>
    </div>

    <a href="${params.approveUrl}" style="display: inline-block; background: ${brand}; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; margin-right: 8px;">Approve this post</a>
    <a href="${params.skipUrl}" style="display: inline-block; background: #1A1A1A; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Skip this week</a>

    <p style="font-size: 13px; color: #777; margin: 20px 0 0; line-height: 1.6;"><strong>If you do nothing, nothing is posted.</strong> ${after}</p>
  `, t);
}

function escHtml(v: string): string { return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]); }

/**
 * Hands-off only (lib/automation-mode.ts): a 1 to 3 star review came in and
 * the fixed holding reply has ALREADY been posted, as the shop agreed. This
 * tells the shop what was said, and that it can undo it or reply itself.
 */
export function holdingReplyPostedEmail(params: {
  businessName: string;
  reviewerName: string;
  rating: number;
  comment: string;
  reply: string;
  settingsUrl: string;
  tenant?: Tenant;
}): string {
  const t = params.tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const stars = '★'.repeat(params.rating) + '☆'.repeat(Math.max(0, 5 - params.rating));
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hello,</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #555;">${escHtml(params.businessName)} has a new ${params.rating}-star review. You asked us to look after replies for you, so we have posted a short, polite reply that asks the customer to contact you. Nothing else has been said on your behalf.</p>

    <div style="background: #F0EDE8; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
      <div style="margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 14px;">${escHtml(params.reviewerName)}</span>
        <span style="color: #B8860B; font-size: 14px; margin-left: 8px;">${stars}</span>
      </div>
      <p style="font-size: 14px; color: #555; line-height: 1.55; margin: 0;">${escHtml(params.comment) || '(no comment left)'}</p>
    </div>

    <p style="font-size: 13px; color: #999; margin: 0 0 8px;">The reply we posted:</p>
    <div style="background: #FFF0EB; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 16px 16px 16px 14px; margin-bottom: 24px;">
      <p style="font-size: 14px; color: #1A1A1A; line-height: 1.55; margin: 0;">${escHtml(params.reply)}</p>
    </div>

    <p style="font-size: 14px; color: #555; margin: 0 0 20px; line-height: 1.6;">You may want to get in touch with this customer yourself. If you would rather the reply was not there, or want to write your own, you can undo it in Settings.</p>
    <a href="${params.settingsUrl}" style="display: inline-block; background: #1A1A1A; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Open Settings</a>
    <p style="font-size: 13px; color: #777; margin: 20px 0 0; line-height: 1.6;">To have these wait for you instead, choose &ldquo;Ask me first&rdquo; in Settings. You can also pause everything there.</p>
  `, t);
}

/**
 * "You have a new 4 or 5 star review." Sent only when REVIEW_ALERT_EMAILS=on
 * (lib/review-alerts.ts). Says plainly what we did about it:
 *   posted   we replied, and this is what we said
 *   waiting  we wrote a reply but could not post it; it is on the dashboard
 *   none     replies are off (or paused), so nothing was replied
 */
export function newReviewEmail(params: {
  businessName: string;
  reviewerName: string;
  rating: number;
  comment: string;
  replyState: 'posted' | 'waiting' | 'none';
  reply?: string | null;
  paused?: boolean;
  dashboardUrl: string;
  settingsUrl: string;
  tenant?: Tenant;
}): string {
  const t = params.tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const stars = '★'.repeat(params.rating) + '☆'.repeat(Math.max(0, 5 - params.rating));
  const replyBlock = (label: string) => `
    <p style="font-size: 13px; color: #999; margin: 0 0 8px;">${label}</p>
    <div style="background: #FFF0EB; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 16px 16px 16px 14px; margin-bottom: 24px;">
      <p style="font-size: 14px; color: #1A1A1A; line-height: 1.55; margin: 0;">${escHtml(params.reply || '')}</p>
    </div>`;
  const what = params.replyState === 'posted' ? replyBlock('We replied for you:') + `<p style="font-size: 13px; color: #777; margin: 0 0 20px; line-height: 1.6;">If you would rather it said something else, you can undo our reply in <a href="${params.settingsUrl}" style="color: #777;">Settings</a>.</p>`
    : params.replyState === 'waiting' ? replyBlock('We wrote this reply but could not post it just now. It is waiting on your dashboard:')
    : `<p style="font-size: 14px; color: #555; margin: 0 0 20px; line-height: 1.6;">${params.paused ? 'You have paused us, so we have not replied.' : 'Replies are switched off, so we have not replied.'} You can reply on Google yourself, or ${params.paused ? 'press Resume' : 'turn on replies to good reviews'} in <a href="${params.settingsUrl}" style="color: #555;">Settings</a> and we will answer the next one for you.</p>`;
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hello,</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #555;">${escHtml(params.businessName)} has a new ${params.rating}-star review on Google.</p>

    <div style="background: #F0EDE8; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
      <div style="margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 14px;">${escHtml(params.reviewerName)}</span>
        <span style="color: ${brand}; font-size: 14px; margin-left: 8px;">${stars}</span>
      </div>
      <p style="font-size: 14px; color: #555; line-height: 1.55; margin: 0;">${escHtml(params.comment) || '(no comment left)'}</p>
    </div>
    ${what}
    <a href="${params.dashboardUrl}" style="display: inline-block; background: #1A1A1A; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Open my dashboard</a>
  `, t);
}
