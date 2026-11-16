import { describe, it, expect, beforeEach } from 'vitest';
import QRCode from 'qrcode';
import { isPlaceId, googleReviewLink, reviewPlaceId, reviewCardSignature, verifyReviewCardSignature, reviewCardPath, reviewQrSvg } from './review-link';

const PLACE = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const OTHER = 'ChIJrTLr-GyuEmsRBfy61i59si0';
const SHOP = '3f2b6c1e-8a4d-4f0b-9c1a-2d5e7f809a1b';

beforeEach(() => { process.env.CANCEL_HASH_SECRET = 'test-secret'; });

describe('googleReviewLink', () => {
  it('builds Google\'s write-a-review address from the place ID', () => {
    expect(googleReviewLink(PLACE)).toBe(`https://search.google.com/local/writereview?placeid=${PLACE}`);
    expect(googleReviewLink(` ${PLACE} `)).toBe(`https://search.google.com/local/writereview?placeid=${PLACE}`);
  });
  it('contains the place ID and nothing else: no customer, no email, no tracking', () => {
    const url = new URL(googleReviewLink(PLACE)!);
    expect(url.origin + url.pathname).toBe('https://search.google.com/local/writereview');
    expect(Array.from(url.searchParams.keys())).toEqual(['placeid']);
  });
  it('gives nothing for a missing or malformed place ID, so a bad value can never reach a link', () => {
    for (const bad of [null, undefined, '', 'short', 42, 'ChIJ with spaces in it', `${PLACE}&evil=1`, `${PLACE}"><script>`, 'https://evil.example/x']) {
      expect(googleReviewLink(bad)).toBeNull();
      expect(isPlaceId(bad)).toBe(false);
    }
  });
});

describe('reviewPlaceId: which listing the link points at', () => {
  it('uses the listing the shop has connected, over the one matched from Tarkett\'s list', () => {
    expect(reviewPlaceId({ connected: PLACE, baseline: OTHER })).toEqual({ placeId: PLACE, source: 'connected' });
  });
  it('falls back to Tarkett\'s list before the shop connects, and says so', () => {
    expect(reviewPlaceId({ connected: null, baseline: OTHER })).toEqual({ placeId: OTHER, source: 'baseline' });
    expect(reviewPlaceId({ connected: 'junk', baseline: OTHER })).toEqual({ placeId: OTHER, source: 'baseline' });
  });
  it('gives nothing when neither is known', () => {
    expect(reviewPlaceId({ connected: null, baseline: null })).toBeNull();
    expect(reviewPlaceId({})).toBeNull();
  });
});

describe('the card address is signed', () => {
  it('a card path verifies for its own shop only', () => {
    const path = reviewCardPath(SHOP);
    const k = new URL(`https://x.example${path}`).searchParams.get('k');
    expect(path.startsWith(`/review-card/${SHOP}?k=`)).toBe(true);
    expect(verifyReviewCardSignature(SHOP, k)).toBe(true);
    expect(verifyReviewCardSignature('11111111-2222-3333-4444-555555555555', k)).toBe(false);
  });
  it('refuses a missing, wrong or tampered signature, and a shop id that is not an id', () => {
    const k = reviewCardSignature(SHOP);
    for (const bad of [undefined, null, '', 'x', k.slice(0, -1), k.slice(0, -1) + (k.endsWith('0') ? '1' : '0'), k + '0']) expect(verifyReviewCardSignature(SHOP, bad)).toBe(false);
    expect(verifyReviewCardSignature('../../etc/passwd', k)).toBe(false);
    expect(verifyReviewCardSignature(undefined, k)).toBe(false);
  });
  it('changes with the secret, so a card address cannot be made without it', () => {
    const k = reviewCardSignature(SHOP);
    process.env.CANCEL_HASH_SECRET = 'another-secret';
    expect(reviewCardSignature(SHOP)).not.toBe(k);
    expect(verifyReviewCardSignature(SHOP, k)).toBe(false);
  });
});

describe('reviewQrSvg', () => {
  it('makes an SVG, here, that encodes exactly the review link', async () => {
    const link = googleReviewLink(PLACE)!;
    const svg = await reviewQrSvg(link);
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/<script|<image|href=|https?:\/\/(?!www\.w3\.org)/); // self-contained: no script, no outside image, no link
    // The same library, asked for the raw code, encodes the link byte for byte.
    const code = QRCode.create(link, { errorCorrectionLevel: 'Q' });
    expect(Buffer.concat(code.segments.map((s: any) => Buffer.from(s.data))).toString('utf8')).toBe(link);
    // And the picture is that code: same number of squares across.
    expect(svg).toContain(`viewBox="0 0 ${code.modules.size + 4} ${code.modules.size + 4}"`);
  });
  it('will only make a code for a Google review link', async () => {
    await expect(reviewQrSvg('https://evil.example/phish')).rejects.toThrow(/not a Google review link/);
    await expect(reviewQrSvg('javascript:alert(1)')).rejects.toThrow();
  });
});
