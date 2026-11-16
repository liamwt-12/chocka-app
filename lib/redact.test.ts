import { describe, it, expect } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('removes email addresses', () => {
    expect(redact('The address dave@example.co.uk is not valid, nor is A.B+c@Mail.Example.com.')).toBe('The address [email] is not valid, nor is [email].');
  });
  it('removes phone numbers however they are written', () => {
    expect(redact("The 'To' number +447700900123 is not a valid phone number")).toBe("The 'To' number [phone] is not a valid phone number");
    expect(redact('number 07700 900123 unreachable')).toBe('number [phone] unreachable');
    expect(redact('to=+44 (0)7700-900-123;')).toBe('to=[phone];');
  });
  it('keeps what explains the failure: codes, statuses, ids, dates', () => {
    const msg = '{"code":21211,"status":400,"more_info":"https://www.twilio.com/docs/errors/21211","date":"2026-11-16T09:00:00Z"}';
    expect(redact(msg)).toBe(msg);
    expect(redact('profile 3f2b6c1e-8a4d-4f0b-9c1a-2d5e7f809a1b failed with 429 after 1200 ms')).toBe('profile 3f2b6c1e-8a4d-4f0b-9c1a-2d5e7f809a1b failed with 429 after 1200 ms');
  });
  it('copes with anything, and keeps log lines short', () => {
    expect(redact(null)).toBe('');
    expect(redact(undefined)).toBe('');
    expect(redact({ toString: () => 'x@y.zz' })).toBe('[email]');
    expect(redact('a'.repeat(2000))).toHaveLength(500);
  });
});
