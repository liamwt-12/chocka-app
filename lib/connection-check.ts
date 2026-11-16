/**
 * The daily look at each connected shop: is it still the right listing, has
 * Google verified it yet, do we still have access?
 *
 * Until now a shop marked "check listing" or "waiting on Google" at sign-in
 * stayed that way for ever: nothing looked again, and the screen told the shop
 * to "tell your Tarkett rep". And a shop whose listing was removed from its
 * Google account afterwards stayed "connected".
 *
 * This runs once a day per shop, alongside the daily figures (the sign-in has
 * already been refreshed there, so it costs two reads). It only ever updates
 * our own record of the shop. It never writes to Google and never messages
 * anyone.
 */
import type { Listing } from './google';
import type { ConnectionStatus } from './ownership';

export interface Recheck { status: ConnectionStatus; detail: string }

/** Decide the status from what Google says now. Pure. */
export function decideRecheck(listings: Listing[], boundLocationName: string, expectedPlaceId: string | null): Recheck {
  const bound = listings.find((l) => l.locationName === boundLocationName);
  if (!bound) {
    return { status: 'check_listing', detail: listings.length
      ? 'the Google account no longer manages the listing that was connected'
      : 'the Google account no longer manages any listing' };
  }
  if (bound.hasVoiceOfMerchant === false) return { status: 'waiting_google', detail: `${bound.title} is still not verified by Google` };
  if (expectedPlaceId && bound.placeId && bound.placeId !== expectedPlaceId) {
    return { status: 'check_listing', detail: `connected to ${bound.title}, which is not the listing we expected` };
  }
  if (expectedPlaceId && !bound.placeId) return { status: 'connected', detail: `${bound.title}; Google gave no place ID to compare` };
  return { status: 'connected', detail: expectedPlaceId ? `${bound.title} matches the expected shop` : `${bound.title}; no baseline place ID to check against` };
}

export interface RecheckDb { from(table: string): any }

/**
 * Re-check one shop and record the result. Returns what was decided, or null if
 * Google could not be asked (nothing is changed then: a busy Google is not news
 * about the shop).
 */
export async function recheckConnection(
  db: RecheckDb,
  retailer: { id: string; place_id: string | null; connection_status?: string | null },
  boundLocationName: string,
  listListings: () => Promise<Listing[]>,
  now: Date = new Date(),
): Promise<Recheck | null> {
  let listings: Listing[];
  try { listings = await listListings(); }
  catch (e) { console.warn(`[recheck] could not ask Google about shop ${retailer.id}; leaving it as it is: ${String((e as any)?.message).slice(0, 160)}`); return null; }
  const r = decideRecheck(listings, boundLocationName, retailer.place_id);
  const patch: Record<string, unknown> = { connection_status: r.status, connection_detail: r.detail, connection_checked_at: now.toISOString() };
  // A listing that has gone from the account is a new situation: an earlier
  // "this is right" from a person was about a listing that is no longer there.
  if (r.detail.startsWith('the Google account no longer manages')) patch.listing_confirmed_at = null;
  const { error } = await db.from('retailers').update(patch).eq('id', retailer.id);
  if (error) console.error(`[recheck] could not record the result for shop ${retailer.id}: ${error.message}`);
  if (retailer.connection_status && retailer.connection_status !== r.status) console.log(`[recheck] shop ${retailer.id}: ${retailer.connection_status} -> ${r.status} (${r.detail})`);
  return r;
}
