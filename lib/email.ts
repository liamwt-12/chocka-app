const RESEND_API = 'https://api.resend.com/emails';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<boolean> {
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Chocka <hello@chocka.co.uk>',
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

function emailWrapper(content: string): string {
  return `
    <div style="font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #1A1A1A;">
      <div style="font-size: 13px; font-weight: 600; letter-spacing: 0.12em; color: #E8541A; margin-bottom: 32px; font-family: 'Courier New', monospace;">CHOCKA</div>
      ${content}
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
        Chocka &middot; <a href="https://chocka.co.uk" style="color: #999;">chocka.co.uk</a>
      </div>
    </div>
  `;
}

export function postPreviewEmail(businessName: string, postContent: string, cancelUrl: string): string {
  const firstName = businessName.split(' ')[0];
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">Here's your Google post for this week. Going live Friday at 10am &mdash; if you're happy with it, do nothing.</p>

    <div style="background: #F0EDE8; border-left: 3px solid #E8541A; border-radius: 0 12px 12px 0; padding: 20px 20px 20px 18px; margin-bottom: 28px;">
      <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #E8541A; margin-bottom: 10px;">Your Google Post</div>
      <p style="font-size: 15px; line-height: 1.65; margin: 0; color: #1A1A1A;">${postContent}</p>
    </div>

    <p style="font-size: 14px; color: #555; margin: 0 0 20px; line-height: 1.6;">Not happy with it? No worries &mdash; just hit the button below and we'll scrap it.</p>

    <a href="${cancelUrl}" style="display: inline-block; background: #1A1A1A; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Cancel This Post</a>

    <p style="font-size: 13px; color: #bbb; margin: 20px 0 0;">If you do nothing, it goes up automatically. Sorted.</p>
  `);
}

export function reviewAlertEmail(params: {
  businessName: string;
  reviewerName: string;
  rating: number;
  comment: string;
  suggestedReply: string;
  approveUrl: string;
  rejectUrl: string;
}): string {
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
        <span style="color: ${isPositive ? '#E8541A' : '#B8860B'}; font-size: 14px; margin-left: 8px;">${stars}</span>
      </div>
      <p style="font-size: 14px; color: #555; line-height: 1.55; margin: 0;">${params.comment || '(no comment left)'}</p>
    </div>

    <p style="font-size: 13px; color: #999; margin: 0 0 8px;">Our suggested reply:</p>
    <div style="background: #FFF0EB; border-left: 3px solid #E8541A; border-radius: 0 12px 12px 0; padding: 16px 16px 16px 14px; margin-bottom: 28px;">
      <p style="font-size: 14px; color: #1A1A1A; line-height: 1.55; margin: 0;">${params.suggestedReply}</p>
    </div>

    <a href="${params.approveUrl}" style="display: inline-block; background: #E8541A; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; margin-right: 8px;">Publish This Reply</a>
    <a href="${params.rejectUrl}" style="display: inline-block; background: #1A1A1A; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">I'll Handle It</a>
  `);
}

export function monthlyReportEmail(params: {
  businessName: string;
  month: string;
  postsPublished: number;
  reviewsReplied: number;
  totalViews: number;
  totalCalls: number;
}): string {
  const firstName = params.businessName.split(' ')[0];
  return emailWrapper(`
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 6px;">Hi ${firstName},</p>
    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #555;">Here's what Chocka did for ${params.businessName} in ${params.month}.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
      <tr>
        <td width="48%" style="background: #F0EDE8; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: #E8541A; font-family: 'Courier New', monospace;">${params.postsPublished}</div>
          <div style="font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em;">Posts Published</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background: #F0EDE8; border-radius: 12px; padding: 18px; text-align: center;">
          <div style="font-size: 32px; font-weight: 700; color: #E8541A; font-family: 'Courier New', monospace;">${params.reviewsReplied}</div>
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
  `);
}
