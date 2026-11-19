/**
 * Loads what lib/report-narrative.ts needs beyond the counts the monthly
 * report already has: listing changes made in the month and still in place,
 * and what is waiting on the dashboard. Reads only.
 */
import { maskFields } from './change-log';
import type { Did } from './report-narrative';

const FIELD_WORDS: Record<string, string> = { profile: 'description', serviceItems: 'services', categories: 'categories', regularHours: 'opening hours', specialHours: 'holiday hours', websiteUri: 'website' };
export async function loadNarrativeFacts(db: { from(table: string): any }, profileId: string, fromIso: string, toIso: string): Promise<Pick<Did, 'listingChanges' | 'repliesWaiting' | 'postsWaiting'>> {
  // A failed read throws, and the caller leaves the section out: better no summary than "nothing needed doing".
  const must = <T,>(r: { data?: T | null; count?: number | null; error?: { message: string } | null }, what: string) => { if (r.error) throw new Error(`could not read ${what}: ${r.error.message}`); return r; };
  const log = must(await db.from('change_log').select('target').eq('profile_id', profileId).eq('action', 'update_location').eq('status', 'applied').neq('source', 'revert').is('reverted_at', null).gte('created_at', fromIso).lt('created_at', toIso), 'the change log').data as any[] | null;
  const listingChanges: string[] = [];
  for (const row of log || []) for (const f of maskFields(row.target || '')) if (FIELD_WORDS[f]) listingChanges.push(FIELD_WORDS[f]);
  const replies = must(await db.from('review_replies').select('id, reviews!inner(profile_id)', { count: 'exact', head: true }).eq('reviews.profile_id', profileId).eq('status', 'pending'), 'waiting replies');
  const posts = must(await db.from('scheduled_posts').select('id', { count: 'exact', head: true }).eq('profile_id', profileId).eq('status', 'awaiting_approval'), 'waiting posts');
  return { listingChanges, repliesWaiting: replies.count || 0, postsWaiting: posts.count || 0 };
}
