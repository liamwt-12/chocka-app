import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The public privacy page on stellarlocal.co.uk (stellar-site/privacy). It must
// describe only what the service does. With review requests (release 3), it must
// match what lib/review-requests.ts does: one email, no reminders, no SMS, no
// incentives, addresses not kept, hashes for 30 days and 12 months, and a
// do-not-email list kept for good. Change this test and the page together.
const html = readFileSync(new URL('../stellar-site/privacy/index.html', import.meta.url), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the public privacy page', () => {
  it('describes review requests as built, and nothing more', () => {
    expect(text).toContain('Review requests');
    expect(text).toMatch(/one request only, with no reminders/);
    expect(text).toMatch(/via Stellar Local/);
    expect(text).toMatch(/never offer anything in return for a review/);
    expect(text).toMatch(/controller/);
    expect(text).toMatch(/processor/);
    expect(text).toMatch(/for 30 days/);
    expect(text).toMatch(/for 12 months/);
    expect(text).toMatch(/unsubscribe link/);
    expect(text).toMatch(/no retailer that uses Stellar Local will send it a review request again/);
    // Things v1 does not do, which an older version of the page promised.
    expect(text).not.toMatch(/gentle reminder|STOP option|phone numbers? that the retailer|SMS messages, including review requests/i);
  });

  it('still covers what the service does do', () => {
    for (const s of ['Google Business Profile management scope', 'Legal basis', 'Who processes data for us', 'How long we keep it', 'Your rights', 'privacy@stellarlocal.co.uk']) expect(text).toContain(s);
    expect(text).toMatch(/Last updated: \d{1,2} [A-Z][a-z]+ 20\d\d/);
  });

  it('is well formed: every table, row, paragraph and section that opens also closes', () => {
    for (const tag of ['table', 'thead', 'tbody', 'tr', 'td', 'th', 'p', 'h2', 'div', 'main', 'body', 'html']) {
      const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      expect(close, tag).toBe(open);
    }
  });
});
