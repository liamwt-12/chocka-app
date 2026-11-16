import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { welcomeEmail, welcomeEmailEnabled, sendWelcomeOnce } from './welcome';
import { getTenantBySlug } from './tenant';

const tenant = getTenantBySlug('stellar');

/** users table with the one conditional update this module makes. */
function fakeDb(sentAt: string | null = null, fail = false) {
  const row = { id: 'u1', welcome_email_sent_at: sentAt };
  return { row, from: () => ({ update: (p: any) => ({ eq: () => ({ is: () => ({ select: async () => {
    if (fail) return { data: null, error: { message: 'db down' } };
    if (row.welcome_email_sent_at) return { data: [], error: null };
    Object.assign(row, p); return { data: [{ id: 'u1' }], error: null };
  } }) }) }) }) };
}

describe('the welcome email is off unless switched on', () => {
  it('only the exact word "on" turns it on', () => {
    expect(welcomeEmailEnabled({})).toBe(false);
    for (const v of ['true', '1', 'yes', 'off', ' ']) expect(welcomeEmailEnabled({ WELCOME_EMAIL: v })).toBe(false);
    expect(welcomeEmailEnabled({ WELCOME_EMAIL: 'on' })).toBe(true);
    expect(welcomeEmailEnabled({ WELCOME_EMAIL: ' ON ' })).toBe(true);
  });

  it('sends nothing and claims nothing while off', async () => {
    const db = fakeDb(); const sent: any[] = [];
    expect(await sendWelcomeOnce(db, { id: 'u1', email: 'a@b.test' }, 'Shop', tenant, { enabled: false, send: async (m) => { sent.push(m); return true; } })).toBe('off');
    expect(sent).toEqual([]);
    expect(db.row.welcome_email_sent_at).toBeNull();
  });
});

describe('once, and only to a shop that has connected', () => {
  const send = (sent: any[]) => async (m: any) => { sent.push(m); return true; };

  it('sends once; a second call sends nothing', async () => {
    const db = fakeDb(); const sent: any[] = [];
    expect(await sendWelcomeOnce(db, { id: 'u1', email: 'a@b.test' }, 'Bare Carpets', tenant, { enabled: true, send: send(sent) })).toBe('sent');
    expect(await sendWelcomeOnce(db, { id: 'u1', email: 'a@b.test' }, 'Bare Carpets', tenant, { enabled: true, send: send(sent) })).toBe('already');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@b.test');
  });

  it('claims the marker BEFORE sending, so a failed send is one missed email, never two sent', async () => {
    const db = fakeDb(); let claimedWhenSending: string | null = null;
    const r = await sendWelcomeOnce(db, { id: 'u1', email: 'a@b.test' }, 'Shop', tenant, { enabled: true, send: async () => { claimedWhenSending = db.row.welcome_email_sent_at; return false; } });
    expect(r).toBe('failed');
    expect(claimedWhenSending).not.toBeNull();
    expect(await sendWelcomeOnce(db, { id: 'u1', email: 'a@b.test' }, 'Shop', tenant, { enabled: true, send: async () => true })).toBe('already');
  });

  it('never throws, whatever goes wrong', async () => {
    expect(await sendWelcomeOnce(fakeDb(null, true), { id: 'u1', email: 'a@b.test' }, 'Shop', tenant, { enabled: true, send: async () => true })).toBe('failed');
    expect(await sendWelcomeOnce(fakeDb(), { id: 'u1', email: 'a@b.test' }, 'Shop', tenant, { enabled: true, send: async () => { throw new Error('boom'); } })).toBe('failed');
    expect(await sendWelcomeOnce(fakeDb(), { id: 'u1', email: null }, 'Shop', tenant, { enabled: true })).toBe('no_address');
  });

  it('is only called from the two places a listing becomes connected', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    const callers = ['../app/api/auth/callback/google/route.ts', '../app/api/listings/select/route.ts'];
    for (const f of callers) expect(src(f)).toMatch(/sendWelcomeOnce\(/);
    // Not from a scheduled job, and not from anything that lists shops.
    for (const f of ['../app/api/cron/onboarding-sequence/route.ts', '../app/api/admin/pilot/route.ts', './pilot.ts']) expect(src(f)).not.toMatch(/sendWelcomeOnce|welcomeEmail\(/);
  });
});

describe('what it says', () => {
  const { subject, html } = welcomeEmail({ shopName: 'Bare <Carpets> & Co', tenant });
  it('names the shop safely and says nothing has changed', () => {
    expect(subject).toBe('Bare <Carpets> & Co is connected to Stellar Local');
    expect(html).toContain('Bare &lt;Carpets&gt; &amp; Co is connected');
    expect(html).toMatch(/Nothing has been changed on your Google listing/);
    expect(html).toContain(`${tenant.appUrl}/dashboard`);
  });
  it('makes no promise about results and mentions no price', () => {
    expect(html).not.toMatch(/£|\bfree\b|more calls|more customers|guarantee|ranking|first page/i);
  });
  it('says why they got it, and that it is once', () => {
    expect(html).toMatch(/You are getting this once/);
  });
});
