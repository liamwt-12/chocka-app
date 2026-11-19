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
  /** A designed email. Give this or `text`. */
  html?: string;
  /** A plain-text email (lib/shop-notices.ts). Sent with no HTML part at all. */
  text?: string;
  /** Sender identity. Defaults to the primary tenant. */
  tenant?: Tenant;
  /**
   * A display name to put in front of the tenant's own sending address, in
   * place of the tenant's usual one. The ADDRESS never changes: it is always
   * the tenant's, so nothing can go out as if from someone else's domain.
   * Used by review requests (lib/review-requests.ts): "<Shop> via Stellar Local".
   */
  fromName?: string;
  /** Where replies go. Review requests set the shop's own address. */
  replyTo?: string;
  /** Extra headers, such as List-Unsubscribe. Only plain names and single-line values are passed on. */
  headers?: Record<string, string>;
}

/** The tenant's sending address with another display name in front. Quotes, brackets and line breaks are taken out of the name. */
export function fromWithName(emailFrom: string, name: string): string {
  const address = (emailFrom.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? emailFrom).trim();
  const clean = name.replace(/[\r\n"<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean ? `"${clean}" <${address}>` : emailFrom;
}

/** Well-formed, single-line headers only. A value with a line break in it could add headers of its own. */
export function safeHeaders(h: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (/^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(k) && typeof v === 'string' && !/[\r\n]/.test(v)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export async function sendEmail({ to, subject, html, text, tenant, fromName, replyTo, headers }: SendEmailParams): Promise<boolean> {
  try {
    if (!html && !text) { console.error('Email not sent: it had no content'); return false; }
    const t = tenant ?? getTenant();
    const extra = safeHeaders(headers);
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromName ? fromWithName(t.emailFrom, fromName) : t.emailFrom,
        to,
        subject,
        ...(text ? { text } : { html }),
        ...(replyTo && !/[\r\n]/.test(replyTo) ? { reply_to: replyTo } : {}),
        ...(extra ? { headers: extra } : {}),
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
