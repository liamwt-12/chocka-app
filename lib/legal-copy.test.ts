import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The in-app notices used to promise that Tarkett is told only how many
// retailers use the service. Invoices name each retailer and the agreed console
// shows each participating retailer's health, so that promise was untrue. This
// guards against it coming back in either page.
const pages = ['app/privacy/page.tsx', 'app/terms/page.tsx'];

describe('funder visibility wording', () => {
  for (const p of pages) {
    const src = readFileSync(p, 'utf8').replace(/\s+/g, ' ');
    it(`${p} no longer promises a head count only`, () => {
      expect(src).not.toMatch(/told\s+how many retailers/);
      expect(src).not.toMatch(/we do not hand it back/);
    });
    it(`${p} says what the funder can see and what it is not given`, () => {
      expect(src).toMatch(/summary of how your Google listing is doing/);
      expect(src).toMatch(/not given your contact details/);
    });
  }
});
