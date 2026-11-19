/**
 * The welcome email: one email, to a shop that has just connected its listing.
 *
 * NEVER COLD. It is only ever triggered by the shop connecting: there is no
 * list it is sent to, no schedule, no "reminder". A shop that has not connected
 * hears nothing from us; Tarkett makes first contact.
 *
 * OFF BY DEFAULT. Sends only when WELCOME_EMAIL is set to exactly "on".
 *
 * ONCE. users.welcome_email_sent_at is claimed with a conditional update before
 * anything is sent. If the claim does not win, nothing is sent. So it is safe
 * to call on every sign-in.
 *
 * It replaces the old day-by-day "onboarding sequence" for this purpose. That
 * job looked for a numbered step the app never writes, so it never sent
 * anything to anyone; it is left alone, and texts stay off.
 */
import { sendEmail } from './email';
import type { Tenant } from './tenant';

export function welcomeEmailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.WELCOME_EMAIL || '').trim().toLowerCase() === 'on';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

/** Subject and body. Pure. No promises about results, no prices, nothing the shop has not already been told on screen. */
export function welcomeEmail(params: { shopName: string; tenant: Tenant }): { subject: string; html: string } {
  const { tenant } = params;
  const shop = esc(params.shopName || 'your shop');
  const brand = tenant.palette.brandStrong;
  const p = 'font-size:16px;line-height:1.6;color:#333;margin:0 0 16px;';
  const html = `
    <div style="font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;padding:36px 22px;color:#1A1A1A;">
      <div style="font-size:13px;font-weight:600;letter-spacing:0.12em;color:${brand};margin-bottom:28px;font-family:'Courier New',monospace;">${tenant.wordmark}</div>
      <h1 style="font-size:22px;margin:0 0 14px;">${shop} is connected</h1>
      <p style="${p}">Thank you. That was the only thing we needed from you.</p>
      <p style="${p}"><strong>Nothing has been changed on your Google listing.</strong> We only change something when you have seen exactly what it is and said yes.</p>
      <p style="${p}"><strong>What you can do next, whenever suits you:</strong></p>
      <ul style="font-size:16px;line-height:1.6;color:#333;margin:0 0 16px;padding-left:20px;">
        <li>See what we could improve on your listing, and pick what you want.</li>
        <li>Check your opening hours are right.</li>
        <li>Choose whether you want us to write a short post each week, or reply to your good reviews. Both are off until you turn them on.</li>
      </ul>
      <p style="margin:0 0 22px;"><a href="${tenant.appUrl}/dashboard" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:13px 22px;border-radius:8px;">Open my dashboard</a></p>
      <p style="${p}"><strong>You stay in charge.</strong> You are still the owner of your listing. You can undo anything we do, and you can remove us at any time in Google or by deleting your account in Settings.</p>
      <p style="${p}">Stuck, or want something put back? Reply to this email or write to <a href="mailto:${tenant.supportEmail}" style="color:${brand};">${tenant.supportEmail}</a>.</p>
      <div style="margin-top:32px;padding-top:18px;border-top:1px solid #eee;font-size:12px;color:#999;">You are getting this once, because you connected ${shop} to ${tenant.brandName} just now.</div>
    </div>`;
  return { subject: `${params.shopName || 'Your shop'} is connected to ${tenant.brandName}`, html };
}

export interface WelcomeDb { from(table: string): any }

/**
 * Send the welcome email if it is switched on and has not been sent. Never
 * throws: connecting must not fail because an email did.
 */
export async function sendWelcomeOnce(
  db: WelcomeDb,
  user: { id: string; email?: string | null },
  shopName: string,
  tenant: Tenant,
  opts: { enabled?: boolean; send?: typeof sendEmail; now?: Date } = {},
): Promise<'sent' | 'off' | 'already' | 'no_address' | 'failed'> {
  try {
    if (!(opts.enabled ?? welcomeEmailEnabled())) return 'off';
    if (!user.email) return 'no_address';
    const now = (opts.now ?? new Date()).toISOString();
    // Claim it first. Only the request whose update changes a row may send.
    const { data, error } = await db.from('users').update({ welcome_email_sent_at: now }).eq('id', user.id).is('welcome_email_sent_at', null).select('id');
    if (error) { console.error(`[welcome] could not claim the welcome email for ${user.id}: ${error.message}`); return 'failed'; }
    if (!data?.length) return 'already';
    const { subject, html } = welcomeEmail({ shopName, tenant });
    const ok = await (opts.send ?? sendEmail)({ to: user.email, subject, html, tenant });
    if (!ok) console.error(`[welcome] the welcome email for ${user.id} was not accepted for sending; it will not be retried`);
    return ok ? 'sent' : 'failed';
  } catch (err) {
    console.error('[welcome] unexpected failure, sign-in unaffected:', err);
    return 'failed';
  }
}
