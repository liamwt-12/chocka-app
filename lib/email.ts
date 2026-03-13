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

// Post preview email with cancel button
export function postPreviewEmail(businessName: string, postContent: string, cancelUrl: string): string {
  return `
    <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #FF6B35; margin-bottom: 4px;">Chocka</h2>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 24px;">Weekly post preview for ${businessName}</p>
      <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <p style="color: #1a1a2e; font-size: 15px; line-height: 1.6; margin: 0;">${postContent}</p>
      </div>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 16px;">This will be posted to your Google profile on Friday at 10am. If you're happy with it, do nothing.</p>
      <a href="${cancelUrl}" style="display: inline-block; background: #1a1a2e; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Cancel this post</a>
    </div>
  `;
}

// Review alert email
export function reviewAlertEmail(params: {
  businessName: string;
  reviewerName: string;
  rating: number;
  comment: string;
  suggestedReply: string;
  approveUrl: string;
  rejectUrl: string;
}): string {
  const stars = '⭐'.repeat(params.rating);
  return `
    <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #FF6B35; margin-bottom: 4px;">Chocka</h2>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 24px;">New review for ${params.businessName}</p>
      <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #1a1a2e;">${params.reviewerName} ${stars}</p>
        <p style="color: #374151; font-size: 14px; line-height: 1.5; margin: 0;">${params.comment || '(no comment)'}</p>
      </div>
      <p style="color: #6b7280; font-size: 13px; margin-bottom: 8px;">Our suggested reply:</p>
      <div style="background: #FFF3ED; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <p style="color: #1a1a2e; font-size: 14px; line-height: 1.5; margin: 0;">${params.suggestedReply}</p>
      </div>
      <a href="${params.approveUrl}" style="display: inline-block; background: #FF6B35; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; margin-right: 8px;">Publish this reply</a>
      <a href="${params.rejectUrl}" style="display: inline-block; background: #1a1a2e; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">I'll handle it</a>
    </div>
  `;
}

// Monthly report email
export function monthlyReportEmail(params: {
  businessName: string;
  month: string;
  postsPublished: number;
  reviewsReplied: number;
  totalViews: number;
  totalCalls: number;
}): string {
  return `
    <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #FF6B35; margin-bottom: 4px;">Chocka</h2>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 24px;">${params.month} report for ${params.businessName}</p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 16px; text-align: center; background: #f3f4f6; border-radius: 12px 0 0 0;">
            <div style="font-size: 28px; font-weight: 800; color: #1a1a2e;">${params.postsPublished}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Posts published</div>
          </td>
          <td style="padding: 16px; text-align: center; background: #f3f4f6; border-radius: 0 12px 0 0;">
            <div style="font-size: 28px; font-weight: 800; color: #1a1a2e;">${params.reviewsReplied}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Reviews replied</div>
          </td>
        </tr>
        <tr>
          <td style="padding: 16px; text-align: center; background: #f3f4f6; border-radius: 0 0 0 12px;">
            <div style="font-size: 28px; font-weight: 800; color: #1a1a2e;">${params.totalViews.toLocaleString()}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">People found you</div>
          </td>
          <td style="padding: 16px; text-align: center; background: #f3f4f6; border-radius: 0 0 12px 0;">
            <div style="font-size: 28px; font-weight: 800; color: #1a1a2e;">${params.totalCalls}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Phone calls</div>
          </td>
        </tr>
      </table>
      <p style="color: #6b7280; font-size: 14px; text-align: center;">Managed by Chocka · chocka.co.uk</p>
    </div>
  `;
}
