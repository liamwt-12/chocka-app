import { getTenant, type Tenant } from './tenant';

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
      console.error('Resend email failed:', await res.text());
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
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">Here's your Google post for this week. Going live Friday at 10am &mdash; if you're happy with it, do nothing.</p>

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
  const firstName = params.businessName.split(' ')[0];
  const isPositive = params.rating >= 4;

  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #555;">
      ${isPositive ? "A new review just came in &mdash; a good one." : "You've got a new review. Not a great one, but we've drafted a reply."}
    </p>

    <div style="background: #F0EDE8; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
      <div style="margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 14px;">${params.reviewerName}</span>
        <span style="color: ${isPositive ? brand : '#B8860B'}; font-size: 14px; margin-left: 8px;">${stars}</span>
      </div>
      <p style="font-size: 14px; color: #555; line-height: 1.55; margin: 0;">${params.comment || '(no comment left)'}</p>
    </div>

    <p style="font-size: 13px; color: #999; margin: 0 0 8px;">Our suggested reply:</p>
    <div style="background: #FFF0EB; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 16px 16px 16px 14px; margin-bottom: 28px;">
      <p style="font-size: 14px; color: #1A1A1A; line-height: 1.55; margin: 0;">${params.suggestedReply}</p>
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
  totalViews: number;
  totalCalls: number;
  tenant?: Tenant;
}): string {
  const t = params.tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const firstName = params.businessName.split(' ')[0];
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">Here's what ${t.brandName} did for ${params.businessName} in ${params.month}.</p>

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
          <div style="font-size: 32px; font-weight: 700; color: #1A1A1A; font-family: 'Courier New', monospace;">${params.totalViews.toLocaleString()}</div>
          <div style="font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">People Found You</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background: #E8F5EE; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: #2D7A4F; font-family: 'Courier New', monospace;">${params.totalCalls}</div>
          <div style="font-size: 11px; color: #2D7A4F; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">Phone Calls</div>
        </td>
      </tr>
    </table>

    <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0;">All handled automatically. No effort from you. That's the point.</p>
  `, t);
}

/**
 * Cold invite to a Tarkett retailer — the first thing they ever hear from us.
 *
 * DRAFT COPY, NOT APPROVED. Reviewed and edited by a human before any real send.
 *
 * THE SCORE IS OPTIONAL, AND THAT IS THE IMPORTANT PART. `score` must be omitted
 * for any retailer whose batch score rests on an unverified scrape match — the
 * 2026-07-30 verification found seven rows scoring a DIFFERENT business (Floor
 * Store U.K's 91 belonged to a neighbour on the same industrial estate). Telling a
 * retailer "your Google presence scored 91" when the 91 is someone else's is worse
 * than saying nothing, and it is the kind of error that ends a pilot. Callers get
 * this right by passing resolveRetailerScore(...).needsVerification through, never
 * by reading `retailers.score` directly. See scripts/source-data/MATCH_VERIFICATION.md.
 */
export function retailerInviteEmail(params: {
  retailerName: string;
  town?: string | null;
  /** Omit entirely when the match is unverified — see above. */
  score?: number | null;
  band?: string | null;
  inviteUrl: string;
  tenant?: Tenant;
}): string {
  const t = params.tenant ?? getTenant();
  const brand = t.palette.brandStrong;
  const showScore = typeof params.score === 'number';
  const where = params.town ? ` in ${params.town}` : '';

  // NO BAND LABEL, DELIBERATELY. The bands are "Strong", "OK", "Needs work" and
  // "At risk" — every one of them is a verdict, and three of the four are a poor
  // thing to open with in a cold email to a stranger about their own business. The
  // number alone is a measurement; the label is a judgement. Callers may still pass
  // `band`, and it is ignored here on purpose rather than removed from the type, so
  // the omission reads as a decision rather than an oversight.
  const hook = showScore
    ? `
      <div style="background: #F0EDE8; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 20px 20px 20px 18px; margin-bottom: 28px;">
        <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${brand}; margin-bottom: 10px;">Your Google presence</div>
        <div style="font-size: 40px; font-weight: 700; line-height: 1; color: #1A1A1A; margin-bottom: 6px;">${params.score}<span style="font-size: 18px; color: #999; font-weight: 400;">/100</span></div>
        <p style="font-size: 14px; line-height: 1.6; margin: 0; color: #555;">That's what a customer searching for you right now can actually see &mdash; your rating, how many reviews you have, and how complete your listing is. Most of it is quick to move.</p>
      </div>`
    : `
      <div style="background: #F0EDE8; border-left: 3px solid ${brand}; border-radius: 0 12px 12px 0; padding: 20px 20px 20px 18px; margin-bottom: 28px;">
        <p style="font-size: 15px; line-height: 1.65; margin: 0; color: #1A1A1A;">We've been looking at how Tarkett retailers show up on Google &mdash; the rating, the reviews, how complete the listing is. Connect your profile and we'll show you exactly where yours stands.</p>
      </div>`;

  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hello ${params.retailerName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">You're getting this because you're a Tarkett stockist${where}. ${t.brandName} is a service Tarkett has set up for its stockists, to help them get found on Google.</p>

    ${hook}

    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 12px; color: #1A1A1A;">Most flooring customers start on Google. If your listing is thin, out of date, or quiet on reviews, you lose them before they ever ring you &mdash; and you never know it happened.</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">${t.brandName} keeps your Google Business Profile working: posts going up, reviews answered, details right. You carry on fitting floors.</p>

    <a href="${params.inviteUrl}" style="display: inline-block; background: ${brand}; color: #fff; padding: 14px 26px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">See your profile &rarr;</a>

    <p style="font-size: 13px; color: #999; margin: 24px 0 0; line-height: 1.6;">Takes about a minute. It's free while we're piloting with Tarkett retailers. This link is just for ${params.retailerName} and works for 30 days.</p>

    <p style="font-size: 13px; color: #bbb; margin: 16px 0 0; line-height: 1.6;">Not interested? Ignore this and you won't hear from us again.</p>

    <p style="font-size: 12px; color: #bbb; margin: 12px 0 0; line-height: 1.6;">${t.brandName} is operated by ${t.legalEntity}. Reply to this email to be removed from the list.</p>
  `, t);
}

/** Subject line for the invite. Kept beside the body so the two stay consistent. */
export function retailerInviteSubject(retailerName: string, score?: number | null): string {
  return typeof score === 'number'
    ? `${retailerName} — your Google presence scores ${score}/100`
    : `${retailerName} — how you show up on Google`;
}
