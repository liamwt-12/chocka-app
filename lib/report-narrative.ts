/**
 * The monthly report, in words: what we did, and what changed.
 *
 * The report has always shown tiles of numbers. A shop owner reading it on a
 * phone wants two sentences first: what did you do for me this month, and did
 * anything change? This writes those sentences from the same records the tiles
 * come from, and nothing else.
 *
 * OFF unless MONTHLY_REPORT_PLAIN_SUMMARY=on. With it off the email is exactly
 * as it was.
 *
 * RULES
 * - Only things that are on record. "We published 4 posts" comes from the four
 *   published posts; if there were none, it says so.
 * - A change to the listing is one the shop approved (it ticked it, or typed
 *   it), and is described that way: "You approved changes to...".
 * - "What changed" gives this month's number and the same month last year's
 *   (lib/year-on-year.ts), so the time of year is not counted as a change.
 *   For a listing with no figures from last year it uses last month instead,
 *   and says "last month". It says "up" or "down", with a percentage, only on
 *   a base of 20 or more and a move of 10% or more; anything less is just the
 *   two numbers. It never says why.
 * - No money. Nothing about ads beyond the existing section. Nothing about spend.
 *
 * Pure: takes counts, returns sentences.
 */
import { MIN_BASE_FOR_PERCENT } from './ad-comparison';
import { movedEnough } from './year-on-year';

export function plainSummaryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.MONTHLY_REPORT_PLAIN_SUMMARY || '').trim().toLowerCase() === 'on';
}

export interface Did {
  postsPublished: number;
  repliesPosted: number;
  /** Listing fields changed this month and still in place. Every one was approved by the shop. */
  listingChanges: string[];
  /** Replies waiting on the dashboard for the shop to approve. */
  repliesWaiting: number;
  postsWaiting: number;
  postsOn: boolean;
  repliesOn: boolean;
}

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What happened on the listing this month, as plain sentences. */
export function whatWeDid(d: Did): string[] {
  const out: string[] = [];
  if (d.postsPublished) out.push(`We published ${n(d.postsPublished, 'post', 'posts')} on your Google listing.`);
  else if (d.postsOn) out.push('No post went up this month.');
  if (d.repliesPosted) out.push(`We replied to ${n(d.repliesPosted, 'review', 'reviews')}.`);
  const fields = Array.from(new Set(d.listingChanges.map((c) => c.toLowerCase())));
  if (fields.length) out.push(`You approved changes to your ${list(fields)}, and we put ${fields.length === 1 ? 'it' : 'them'} on your listing.`);
  if (d.repliesWaiting) out.push(`${n(d.repliesWaiting, 'reply is', 'replies are')} waiting on your dashboard for you to approve.`);
  if (d.postsWaiting) out.push(`${n(d.postsWaiting, 'post is', 'posts are')} waiting on your dashboard for you to approve.`);
  if (!d.postsOn && !d.repliesOn && !out.length) out.push('Posts and review replies are both switched off, so we did not post or reply for you this month. You can turn either on in Settings.');
  else if (!out.length) out.push('Nothing needed doing on your listing this month.');
  return out;
}

/** A move smaller than this is not called a rise or a fall. */
export const MIN_MOVE_PERCENT = 10;

export interface Figures { views: number; calls: number; websiteClicks: number; directions: number }

/** What the month is compared with, as it reads in a sentence. */
export type ComparedWith = 'last_year' | 'last_month';
const EARLIER: Record<ComparedWith, { the: string; inThe: string }> = {
  last_year: { the: 'the same month last year', inThe: 'in the same month last year' },
  last_month: { the: 'last month', inThe: 'last month' },
};

/** One line per figure: this month, the earlier month, and how they compare, in words. */
export function whatChanged(now: Figures | null, before: Figures | null, comparedWith: ComparedWith = 'last_month'): string[] {
  if (!now) return [];
  const w = EARLIER[comparedWith];
  const LINES: Array<[keyof Figures, string, string]> = [['calls', 'Calls from your listing', 'calls'], ['websiteClicks', 'Website clicks', 'clicks'], ['directions', 'Requests for directions', 'requests'], ['views', 'Times you were seen on Google', 'times']];
  return LINES.map(([key, label]) => {
    const a = now[key];
    if (!before) return `${label}: ${a.toLocaleString('en-GB')}.`;
    const b = before[key];
    // A rise or fall is only called one on a base of 20, a move of 10%, and at least three in number.
    const move = b >= MIN_BASE_FOR_PERCENT && movedEnough(b, a) ? Math.round(((a - b) / b) * 100) : 0;
    if (Math.abs(move) < MIN_MOVE_PERCENT) return a === b ? `${label}: ${a.toLocaleString('en-GB')}, the same as ${w.the}.` : `${label}: ${a.toLocaleString('en-GB')} (${b.toLocaleString('en-GB')} ${w.inThe}).`;
    return `${label}: ${a.toLocaleString('en-GB')}, ${move > 0 ? 'up from' : 'down from'} ${b.toLocaleString('en-GB')} ${w.inThe} (${move > 0 ? '+' : ''}${move}%).`;
  });
}

/**
 * Which earlier month to compare with. Last year's same month if it is
 * (nearly) all there; otherwise last month, if that is; otherwise nothing.
 * `nowComplete` is whether this month is itself nearly all there: a part month
 * against a whole one is not a change.
 */
export function chooseComparison<T>(nowComplete: boolean, lastYear: { complete: boolean; figures: T }, lastMonth: { complete: boolean; figures: T }): { comparedWith: ComparedWith; before: T } | null {
  if (!nowComplete) return null;
  if (lastYear.complete) return { comparedWith: 'last_year', before: lastYear.figures };
  if (lastMonth.complete) return { comparedWith: 'last_month', before: lastMonth.figures };
  return null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

/** The two lists as a block for the top of the email. Empty when there is nothing to say. */
export function narrativeHtml(did: string[], changed: string[], hasComparison: boolean): string {
  if (!did.length && !changed.length) return '';
  const ul = (items: string[]) => `<ul style="margin:0 0 4px;padding-left:20px;font-size:15px;line-height:1.6;color:#333;">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const h = (t: string) => `<h3 style="font-size:15px;margin:14px 0 6px;color:#1A1A1A;">${t}</h3>`;
  return `<div style="background:#FAFAF8;border:1px solid #E8E4DC;border-radius:12px;padding:6px 18px 14px;margin:0 0 24px;">
    ${did.length ? h('What we did') + ul(did) : ''}
    ${changed.length ? h(hasComparison ? 'What changed' : 'Your figures this month') + ul(changed) + `<p style="font-size:12px;color:#999;margin:8px 0 0;">These are Google's own figures for your listing. They go up and down for many reasons.</p>` : ''}
  </div>`;
}
