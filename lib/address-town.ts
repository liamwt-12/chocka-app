/**
 * The town a shop is in, for the "Location" line of the post and description
 * prompts.
 *
 * profiles.address is built by formatAddress (lib/google.ts) as
 * "address lines, locality, postcode", so taking the last comma-separated part
 * (what the post writer used to do) gave the model the POSTCODE, and posts came
 * out talking about "homes across LS1 4AB".
 *
 * Order of preference:
 *  1. A structured locality, when the caller has one (Google's
 *     storefrontAddress.locality, or profiles.city).
 *  2. The address string, read from the end: trailing postcodes and country
 *     names are skipped, a postcode stuck on the end of the town ("Leeds LS1
 *     4AB") is cut off, and the first part left that has no digits in it is the
 *     town. A part with digits is a street line ("1 High Street"), never a town.
 *  3. "your area".
 *
 * Pure: no database, no network.
 */

export const UNKNOWN_TOWN = 'your area';

// Full UK postcode (outward + inward), or an outward code on its own.
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i;
// A full postcode at the end of a part that also has the town in it.
const TRAILING_POSTCODE = /\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const COUNTRY = /^(uk|u\.k\.|united kingdom|great britain|gb|england|scotland|wales|northern ireland)$/i;

export function townFromAddress(address: string | null | undefined, locality?: string | null): string {
  const given = typeof locality === 'string' ? locality.trim() : '';
  if (given) return given;
  if (typeof address !== 'string') return UNKNOWN_TOWN;

  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].replace(TRAILING_POSTCODE, '').trim();
    if (!part || POSTCODE.test(part) || COUNTRY.test(part)) continue;
    // The first real part from the end decides: a town, or a street line
    // (meaning the address had no town in it at all).
    return /\d/.test(part) ? UNKNOWN_TOWN : part;
  }
  return UNKNOWN_TOWN;
}
