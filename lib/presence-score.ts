/**
 * The live presence score for the monthly report.
 *
 * One-pager item 3 promises "a monthly report: presence score and what it
 * delivered". The score is the same 0-100 scorer the retailer sees at
 * onboarding (lib/audit.ts scoreProfile), computed fresh from Google at send
 * time, with the same reads /api/audit makes.
 *
 * The comparison is against the score at activation (profiles.audit_score,
 * written by the onboarding audit). It is NEVER compared against the 21 June
 * batch scores in `retailers` / `score_history`: those came from the public
 * scorer on a different scale, and putting the two side by side would report a
 * change that is really a change of ruler.
 */
import { scoreProfile, type AuditResult } from './audit';
import {
  getLocationFull, getGoogleUpdated, getAttributes, getMedia, getReviews, getLocalPosts,
} from './google';

/** Throws only if the listing itself cannot be read; every other read just lowers the score, as in /api/audit. */
export async function livePresenceScore(accessToken: string, locationName: string, accountId?: string): Promise<AuditResult> {
  const location = await getLocationFull(accessToken, locationName);
  const [googleUpdated, attributes, media, reviews, posts] = await Promise.all([
    getGoogleUpdated(accessToken, locationName).catch(() => null),
    getAttributes(accessToken, locationName).catch(() => ({ attributes: [] })),
    getMedia(accessToken, locationName, accountId).catch(() => ({ mediaItems: [] })),
    getReviews(accessToken, locationName, accountId).catch(() => ({ reviews: [] })),
    getLocalPosts(accessToken, locationName, accountId).catch(() => ({ localPosts: [] })),
  ]);
  return scoreProfile({ location, attributes, media, reviews, posts, googleUpdated });
}

/** One plain sentence comparing now with activation. Pure, for the email and tests. */
export function presenceComparison(current: number, atActivation: number | null | undefined): string {
  if (atActivation === null || atActivation === undefined || !Number.isFinite(atActivation)) {
    return 'This is your first presence score with us; next month shows the change.';
  }
  const diff = Math.round(current - atActivation);
  if (diff > 0) return `Up ${diff} point${diff === 1 ? '' : 's'} from ${atActivation} when we started.`;
  if (diff < 0) return `Down ${-diff} point${diff === -1 ? '' : 's'} from ${atActivation} when we started.`;
  return `The same as when we started (${atActivation}).`;
}
