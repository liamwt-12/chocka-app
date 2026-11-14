import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCron, sendCronAlert } from './run-cron.mjs';

const calls: Array<{ url: string; init: any }> = [];
function mockFetch(route: (url: string) => Response | Promise<Response>) {
  global.fetch = vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return route(String(url)); }) as any;
}

beforeEach(() => {
  calls.length = 0;
  process.env.CRON_SECRET = 'cs';
  process.env.URL = 'https://app.example';
  process.env.CRON_ALERT_EMAIL = 'ops@example.com';
  process.env.RESEND_API_KEY = 'rk';
  delete process.env.CRON_ALERT_WEBHOOK_URL;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ['CRON_SECRET', 'URL', 'CRON_ALERT_EMAIL', 'RESEND_API_KEY', 'CRON_ALERT_WEBHOOK_URL']) delete process.env[k];
});

describe('runCron', () => {
  it('sends the secret in a header, not the URL, and sends no alert on success', async () => {
    mockFetch(() => new Response('{"success":true}', { status: 200 }));
    await runCron('post-publisher');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://app.example/api/cron/post-publisher');
    expect(calls[0].url).not.toContain('secret');
    expect(calls[0].init.headers.Authorization).toBe('Bearer cs');
  });

  it('alerts by email and rethrows on a non-2xx response', async () => {
    mockFetch((url) => url.includes('resend') ? new Response('{}', { status: 200 }) : new Response('boom', { status: 500 }));
    await expect(runCron('monthly-report')).rejects.toThrow(/responded 500/);
    const alert = calls.find((c) => c.url.includes('api.resend.com'));
    expect(alert).toBeTruthy();
    const body = JSON.parse(alert!.init.body);
    expect(body.to).toBe('ops@example.com');
    expect(body.subject).toContain('monthly-report');
    expect(body.text).toContain('responded 500');
  });

  it('alerts when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    mockFetch(() => new Response('{}', { status: 200 }));
    await expect(runCron('review-alerts')).rejects.toThrow(/CRON_SECRET is not set/);
    expect(calls.some((c) => c.url.includes('api.resend.com'))).toBe(true);
  });

  it('alerts on a timeout with a clear message', async () => {
    mockFetch((url) => {
      if (url.includes('resend')) return new Response('{}', { status: 200 });
      const e = new Error('timed out'); e.name = 'TimeoutError'; throw e;
    });
    await expect(runCron('post-generator')).rejects.toThrow(/no response after/);
    expect(calls.some((c) => c.url.includes('api.resend.com'))).toBe(true);
  });

  it('a failing alert never hides the original error', async () => {
    mockFetch(() => { throw new Error('network down'); });
    await expect(runCron('monday-stats')).rejects.toThrow(/request failed/);
  });
});

describe('sendCronAlert', () => {
  it('posts {text} to a webhook when one is configured', async () => {
    delete process.env.CRON_ALERT_EMAIL;
    process.env.CRON_ALERT_WEBHOOK_URL = 'https://hooks.example/abc';
    mockFetch(() => new Response('ok', { status: 200 }));
    await sendCronAlert('onboarding-sequence', 'it broke');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body).text).toContain('it broke');
  });

  it('warns when no channel is configured and sends nothing', async () => {
    delete process.env.CRON_ALERT_EMAIL;
    mockFetch(() => new Response('ok', { status: 200 }));
    await sendCronAlert('x', 'y');
    expect(calls).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });
});
