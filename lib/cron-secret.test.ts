import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyCronSecret } from './cron';

const URL_BASE = 'https://app.example/api/cron/post-publisher';
const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret-value';
  delete process.env.CRON_ACCEPT_QUERY_SECRET;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.CRON_SECRET; delete process.env.CRON_ACCEPT_QUERY_SECRET; });

describe('verifyCronSecret', () => {
  it('accepts Authorization: Bearer', () => {
    expect(verifyCronSecret(req(URL_BASE, { authorization: 'Bearer s3cret-value' }))).toBe(true);
  });
  it('accepts x-cron-secret', () => {
    expect(verifyCronSecret(req(URL_BASE, { 'x-cron-secret': 's3cret-value' }))).toBe(true);
  });
  it('still accepts ?secret= during the transition, with a warning', () => {
    expect(verifyCronSecret(req(`${URL_BASE}?secret=s3cret-value`))).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
  it('refuses ?secret= once CRON_ACCEPT_QUERY_SECRET=false, but the header still works', () => {
    process.env.CRON_ACCEPT_QUERY_SECRET = 'false';
    expect(verifyCronSecret(req(`${URL_BASE}?secret=s3cret-value`))).toBe(false);
    expect(verifyCronSecret(req(URL_BASE, { authorization: 'Bearer s3cret-value' }))).toBe(true);
  });
  it('refuses a wrong secret in every position', () => {
    expect(verifyCronSecret(req(`${URL_BASE}?secret=nope`, { authorization: 'Bearer nope', 'x-cron-secret': 'nope' }))).toBe(false);
  });
  it('refuses everything when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret(req(URL_BASE))).toBe(false);
    expect(verifyCronSecret(req(`${URL_BASE}?secret=`, { authorization: 'Bearer ' }))).toBe(false);
  });
});
