/**
 * Loads what lib/report-narrative.ts needs beyond the counts the monthly
 * report already has: listing changes made in the month and still in place,
 * and what is waiting on the dashboard. Reads only.
 */
import { maskFields } from './change-log';
import type { Did } from './report-narrative';

const FIELD_WORDS: Record<string, string> = { profile: 'description', serviceItems: 'services', categories: 'categories', regularHours: 'opening hours', specialHours: 'holiday hours', websiteUri: 'website' };
/** Code paths where the shop itself chose the change (ticked a suggestion, or saved it in Settings). */
const SHOP_SOURCES = new Set(['onboarding']);

export async function loadNarrativeFacts(db: { from(table: string): any }, profileId: string, fromIso: string, toIso: string): Promise<Pick<Did, 'listingChanges' | 'repliesWaiting' | 'postsWaiting'>> {
  const { data: log } = await db.from('change_log').select('source, target').eq('profile_id', profileId).eq('action', 'update_location').eq('status', 'applied').neq('source', 'revert').is('reverted_at', null).gte('created_at', fromIso).lt('created_at', toIso);
  const listingChanges: Did['listingChanges'] = [];
  for (const row of log || []) for (const f of maskFields(row.target || '')) if (FIELD_WORDS[f]) listingChanges.push({ what: FIELD_WORDS[f], by: SHOP_SOURCES.has(row.source) ? 'shop' : 'us' });
  const { count: repliesWaiting } = await db.from('review_replies').select('id, reviews!inner(profile_id)', { count: 'exact', head: true }).eq('reviews.profile_id', profileId).eq('status', 'pending');
  const { count: postsWaiting } = await db.from('scheduled_posts').select('id', { count: 'exact', head: true }).eq('profile_id', profileId).eq('status', 'awaiting_approval');
  return { listingChanges, repliesWaiting: repliesWaiting || 0, postsWaiting: postsWaiting || 0 };
}
