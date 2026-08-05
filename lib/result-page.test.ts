import { describe, it, expect } from 'vitest';
import { resultPage } from './result-page';
import { getTenant, getTenantBySlug } from './tenant';

// The standalone HTML returned by the two link-click routes. It sat inline in
// both of them, byte-identical, calling getTenant() — so every screen on both
// routes rendered Chocka's wordmark and Chocka's accent to a Stellar retailer,
// on a link that arrived in Stellar-branded SMS. Shared and parameterised here
// so that cannot silently come back, and so the two copies cannot drift.

const chocka = getTenant();
const stellar = getTenantBySlug('stellar');

describe('resultPage', () => {
  it('renders the tenant it is given, not the primary one', () => {
    const html = resultPage(stellar, 'Post cancelled', 'Nothing will go out.');
    expect(html).toContain('Stellar Local');
    expect(html).not.toContain('Chocka');
  });

  it('uses the tenant accent for the heading', () => {
    // The regression is subtle when it happens: correct words, wrong colour.
    expect(resultPage(stellar, 'x', 'y')).toContain(`color: ${stellar.palette.routeAccent}`);
    expect(resultPage(chocka, 'x', 'y')).toContain(`color: ${chocka.palette.routeAccent}`);
    expect(stellar.palette.routeAccent).not.toBe(chocka.palette.routeAccent);
  });

  it('puts the brand in the document title, where the tab shows it', () => {
    expect(resultPage(stellar, 'Reply published', 'Live now.')).toContain(
      '<title>Reply published — Stellar Local</title>',
    );
  });

  it('renders Chocka exactly as before for the primary tenant', () => {
    // The value-preserving half: Chocka's pages must be unchanged by this.
    const html = resultPage(chocka, 'Post cancelled', 'Nothing will be published this week.');
    expect(html).toContain('<title>Post cancelled — Chocka</title>');
    expect(html).toContain('color: #FF6B35');
  });

  it('places the title and message in the card body', () => {
    const html = resultPage(chocka, 'That review is gone', 'Nothing left to reply to.');
    expect(html).toContain('<h1>That review is gone</h1>');
    expect(html).toContain('<p>Nothing left to reply to.</p>');
  });
});
