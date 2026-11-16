/**
 * A shop's Google review link, and the printable card that carries it.
 *
 * The link is Google's own "write a review" address for a listing, built from
 * the listing's place ID. It is the same for every customer and contains
 * nothing about anyone: no customer data, no email, no tracking, nothing sent.
 * The shop prints the card and puts it on the counter.
 *
 * The card page (/review-card/<shop id>?k=<signature>) needs no sign-in, so a
 * rep can pass its address to the shop to print. The signature stops anyone
 * who does not have the address from finding a shop's card by guessing, and it
 * is all the page will accept: it shows a shop's name, town and public Google
 * link, which are already public, and nothing else.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import QRCode from 'qrcode';

/** Google place IDs are URL-safe text, usually 27 characters and sometimes much longer. */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{16,300}$/;

export function isPlaceId(value: unknown): value is string {
  return typeof value === 'string' && PLACE_ID_RE.test(value);
}

/** Google's "write a review" address for a place, or null if the place ID is missing or malformed. */
export function googleReviewLink(placeId: unknown): string | null {
  const id = typeof placeId === 'string' ? placeId.trim() : '';
  return isPlaceId(id) ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}` : null;
}

export type PlaceIdSource = 'connected' | 'baseline';

/**
 * Which place ID to use for a shop. The listing the shop has actually connected
 * wins, because that is the one it manages. Before a shop connects, the place
 * ID from Tarkett's store list is used, which was matched by name and address
 * and so is worth a glance before the card is printed.
 */
export function reviewPlaceId(ids: { connected?: string | null; baseline?: string | null }): { placeId: string; source: PlaceIdSource } | null {
  const connected = (ids.connected || '').trim();
  if (isPlaceId(connected)) return { placeId: connected, source: 'connected' };
  const baseline = (ids.baseline || '').trim();
  if (isPlaceId(baseline)) return { placeId: baseline, source: 'baseline' };
  return null;
}

// ── The card's address ──────────────────────────────────────────────────────

function secret(): string {
  const raw = process.env.CANCEL_HASH_SECRET;
  if (!raw || !raw.trim()) throw new Error('CANCEL_HASH_SECRET is not set, so review card links can be neither made nor checked');
  return raw.trim();
}

export function reviewCardSignature(retailerId: string): string {
  return createHmac('sha256', secret()).update(`review-card:${retailerId}`).digest('hex').slice(0, 32);
}

export function verifyReviewCardSignature(retailerId: unknown, signature: unknown): boolean {
  if (typeof retailerId !== 'string' || typeof signature !== 'string' || !/^[0-9a-f-]{36}$/i.test(retailerId)) return false;
  const expected = Buffer.from(reviewCardSignature(retailerId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function reviewCardPath(retailerId: string): string {
  return `/review-card/${retailerId}?k=${reviewCardSignature(retailerId)}`;
}

// ── The QR code ─────────────────────────────────────────────────────────────

/**
 * The link as a QR code, as an SVG string. Made here, on our own server: the
 * link is never sent to an outside QR service. Only a Google review link is
 * accepted, so this cannot be used to make a code for anything else.
 */
export async function reviewQrSvg(link: string): Promise<string> {
  if (!link.startsWith('https://search.google.com/local/writereview?placeid=')) throw new Error('not a Google review link');
  // Level Q: still scans with a quarter of the code scuffed or covered, which
  // is what happens to a card on a shop counter.
  return QRCode.toString(link, { type: 'svg', errorCorrectionLevel: 'Q', margin: 2 });
}
