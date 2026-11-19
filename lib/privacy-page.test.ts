import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The public privacy page on stellarlocal.co.uk (stellar-site/privacy). It must
// describe only what the service does. Review requests are not live, so the page
// must not say customers' contact details are collected for them.
const html = readFileSync(new URL('../stellar-site/privacy/index.html', import.meta.url), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the public privacy page', () => {
  it('says nothing about review requests, or collecting customers\' contact details for them', () => {
    expect(text).not.toMatch(/review[- ]requests?/i);
    expect(text).not.toMatch(/Customer data/);
    expect(text).not.toMatch(/gentle reminder|STOP option|customer's contact details|customers whose details/i);
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
