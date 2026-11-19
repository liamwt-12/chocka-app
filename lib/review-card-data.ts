/**
 * Which shops get a review card, and what goes on each. Reads only the shop's
 * name, town and the place ID of its listing: nothing about its customers, no
 * contact details.
 */
import { googleReviewLink, reviewPlaceId, type PlaceIdSource } from './review-link';
import { reviewCardsPdf, type CardInput, type CardColours } from './review-card-pdf';
import type { Tenant } from './tenant';

export interface CardDb { from(table: string): any }
/** 'unconfirmed': the shop connected a listing that is not the one expected, and nobody has confirmed it yet. */
export type CardSource = PlaceIdSource | 'unconfirmed';
export interface ShopCard extends CardInput { retailerId: string; source: CardSource }

/** A connected listing nobody has confirmed is not treated as checked: the app acts on it nowhere else either. */
function sourceFor(place: { source: PlaceIdSource }, shop: { connection_status?: string | null; listing_confirmed_at?: string | null }): CardSource {
  return place.source === 'connected' && shop.connection_status === 'check_listing' && !shop.listing_confirmed_at ? 'unconfirmed' : place.source;
}

/** The card's colours and wordmark, from the tenant's own palette. */
export function cardStyle(tenant: Tenant): { colours: CardColours; wordmark: string } {
  const p = tenant.palette;
  return { colours: { ink: p.charcoal, paper: p.cream, accent: p.gold, soft: p.text }, wordmark: tenant.wordmark };
}

/** One shop's card, or null if the shop is gone, delisted, or has no listing to point at. */
export async function loadShopCard(db: CardDb, retailerId: string): Promise<ShopCard | null> {
  const { data: shop, error } = await db.from('retailers').select('id, name, town, place_id, user_id, delisted_at, connection_status, listing_confirmed_at').eq('id', retailerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!shop || shop.delisted_at) return null;
  let connected: string | null = null;
  if (shop.user_id) {
    const { data: profiles } = await db.from('profiles').select('google_place_id').eq('user_id', shop.user_id).limit(1);
    connected = profiles?.[0]?.google_place_id ?? null;
  }
  const place = reviewPlaceId({ connected, baseline: shop.place_id });
  const link = place && googleReviewLink(place.placeId);
  return link && place ? { retailerId: shop.id, name: shop.name, town: shop.town ?? null, link, source: sourceFor(place, shop) } : null;
}

export interface BulkCards {
  cards: ShopCard[];
  /** Shops left out, by name, and why. */
  leftOut: { noListing: string[]; notConnected: string[]; /** Connected to a listing nobody has confirmed is the shop's. */ unconfirmed: string[] };
}

/**
 * Every card for a tenant's shops, in name order.
 *
 * BY DEFAULT ONLY SHOPS THAT HAVE CONNECTED are included: their link comes
 * from the listing they chose themselves. For a shop that has not connected
 * the only link we have is the listing matched from the funder's store list
 * by name and address, which could be a different business; a printed card
 * that sends a shop's customers to someone else's listing is worse than no
 * card. The same goes for a shop that connected a listing other than the one
 * expected and has not had it confirmed. `includeUnchecked` adds both kinds,
 * for someone who will check each one.
 */
export async function loadBulkCards(db: CardDb, tenantId: string, opts: { includeUnchecked?: boolean } = {}): Promise<BulkCards> {
  const { data: shops, error } = await db.from('retailers').select('id, name, town, place_id, user_id, delisted_at, connection_status, listing_confirmed_at').eq('tenant_id', tenantId).is('delisted_at', null).order('name');
  if (error) throw new Error(error.message);
  const rows: any[] = shops || [];
  const userIds = rows.map((r) => r.user_id).filter(Boolean);
  const placeByUser = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles, error: profileError } = await db.from('profiles').select('user_id, google_place_id').in('user_id', userIds);
    if (profileError) throw new Error(profileError.message);
    for (const p of profiles || []) if (!placeByUser.get(p.user_id)) placeByUser.set(p.user_id, p.google_place_id ?? null);
  }
  const out: BulkCards = { cards: [], leftOut: { noListing: [], notConnected: [], unconfirmed: [] } };
  for (const r of rows) {
    const place = reviewPlaceId({ connected: r.user_id ? placeByUser.get(r.user_id) : null, baseline: r.place_id });
    const link = place && googleReviewLink(place.placeId);
    if (!place || !link) { out.leftOut.noListing.push(r.name); continue; }
    const source = sourceFor(place, r);
    if (source !== 'connected' && !opts.includeUnchecked) { (source === 'unconfirmed' ? out.leftOut.unconfirmed : out.leftOut.notConnected).push(r.name); continue; }
    out.cards.push({ retailerId: r.id, name: r.name, town: r.town ?? null, link, source });
  }
  return out;
}

/** The PDF for a set of cards, in the tenant's style. */
export function cardsPdfFor(tenant: Tenant, cards: CardInput[], title: string): Buffer {
  return reviewCardsPdf(cards.map((c) => ({ name: c.name, town: c.town, link: c.link })), { ...cardStyle(tenant), title });
}
