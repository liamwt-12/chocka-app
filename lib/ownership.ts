/**
 * Ownership detection: when a shop signs in through its invite, which of the
 * listings its Google account manages is the shop we expected?
 *
 * The expected shop is the retailer row the invite was minted for, and its
 * `place_id` from the June baseline. Each listing carries a placeId too
 * (lib/google.ts getManageableListings), so the match is exact where both exist.
 *
 * STATUSES (stored on retailers.connection_status):
 *   invited         link issued, not used yet (set when the invite is minted)
 *   connected       the expected listing was found and bound
 *   check_listing   connected, but to a listing that is not the one we expected
 *                   (or we had no place_id to check against): a person should look
 *   no_access       the Google account manages no listings at all
 *   waiting_google  the expected listing was found but Google has not verified it
 *                   yet, so we cannot manage it until Google finishes
 *
 * A mismatch never blocks the shop. Place IDs can change when Google merges or
 * moves a listing, so it is flagged for a person rather than refused.
 */
import type { Listing } from './google';

export type ConnectionStatus = 'invited' | 'connected' | 'check_listing' | 'no_access' | 'waiting_google';

export interface OwnershipResult {
  status: ConnectionStatus;
  /** The listing to bind, when one should be bound automatically. */
  bind: Listing | null;
  /** Several listings and none matched: show the picker. */
  needsPicker: boolean;
  detail: string;
}

/**
 * Decide what happens at sign-in. Pure.
 *
 * `expectedPlaceId` is null for an ordinary sign-in (no invite) or a retailer
 * with no baseline place_id; then the old behaviour applies (one listing binds,
 * several show the picker), and nothing is claimed about whether it matches.
 */
export function detectOwnership(listings: Listing[], expectedPlaceId: string | null): OwnershipResult {
  if (listings.length === 0) {
    return { status: 'no_access', bind: null, needsPicker: false, detail: 'this Google account manages no Business Profile listings' };
  }

  if (expectedPlaceId) {
    const match = listings.find((l) => l.placeId === expectedPlaceId);
    if (match) {
      if (match.hasVoiceOfMerchant === false) {
        return { status: 'waiting_google', bind: match, needsPicker: false, detail: `found ${match.title}, but Google has not finished verifying it` };
      }
      const others = listings.length - 1;
      return { status: 'connected', bind: match, needsPicker: false, detail: `matched ${match.title} by place ID${others ? ` (account also manages ${others} other listing${others === 1 ? '' : 's'})` : ''}` };
    }
  }

  const unchecked = expectedPlaceId ? 'none of the listings matches the expected shop' : 'no baseline place ID to check against';
  if (listings.length === 1) {
    const only = listings[0];
    if (only.hasVoiceOfMerchant === false) {
      return { status: 'waiting_google', bind: only, needsPicker: false, detail: `${only.title} is not verified by Google yet; ${unchecked}` };
    }
    return { status: expectedPlaceId ? 'check_listing' : 'connected', bind: only, needsPicker: false, detail: `bound ${only.title}; ${unchecked}` };
  }
  return { status: 'check_listing', bind: null, needsPicker: true, detail: `${listings.length} listings, ${unchecked}; the shop chooses` };
}

/** After the shop picks from the list: was it the shop we expected? */
export function statusForChosenListing(chosen: Listing, expectedPlaceId: string | null): { status: ConnectionStatus; detail: string } {
  if (chosen.hasVoiceOfMerchant === false) return { status: 'waiting_google', detail: `${chosen.title} is not verified by Google yet` };
  if (!expectedPlaceId) return { status: 'connected', detail: `chose ${chosen.title}; no baseline place ID to check against` };
  return chosen.placeId === expectedPlaceId
    ? { status: 'connected', detail: `chose ${chosen.title}, which matches the expected shop` }
    : { status: 'check_listing', detail: `chose ${chosen.title}, which is not the listing we expected` };
}

/** What the shop sees for each status, and what to do next. Plain English. */
export const SHOP_MESSAGES: Record<ConnectionStatus, { title: string; message: string; nextStep: string }> = {
  invited: {
    title: 'Ready when you are',
    message: 'Your link is ready. Connecting takes a couple of minutes.',
    nextStep: 'Tap "Connect my Google profile" and sign in with the Google account you use for your shop on Google Maps.',
  },
  connected: {
    title: "You're connected",
    message: "We've found your shop on Google and connected it.",
    nextStep: 'Nothing else to do. We will email you before anything is posted.',
  },
  check_listing: {
    title: 'Is this the right shop?',
    message: "We expected a different listing from the one we can see on this Google account. That's often fine: Google sometimes changes how a listing is recorded.",
    nextStep: "Check the shop name and address. If it isn't yours, sign out and try the Google account that manages your shop, or tell your Tarkett rep.",
  },
  no_access: {
    title: "We couldn't find your shop on this Google account",
    message: "This Google account doesn't manage any Business Profile listings.",
    nextStep: 'Sign in with the account you use for your shop on Google Maps. If someone else set up your listing, ask them to add you as an owner or manager in Google, then try again.',
  },
  waiting_google: {
    title: 'Waiting on Google',
    message: "We've found your shop, but Google hasn't finished verifying the listing, so it can't be managed yet.",
    nextStep: "Finish Google's verification for the listing (Google will have sent instructions by post, phone or email). Once Google has verified it, tell your Tarkett rep and we'll check it again.",
  },
};

/** Short labels for /admin/pilot. */
export const ADMIN_LABELS: Record<ConnectionStatus, string> = {
  invited: 'Invited',
  connected: 'Connected',
  check_listing: 'Check listing',
  no_access: 'No access found',
  waiting_google: 'Waiting on Google',
};
