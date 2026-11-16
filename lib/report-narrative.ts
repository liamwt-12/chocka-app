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
 * - Changes the shop chose itself are described as the shop's ("You added your
 *   opening hours"), not ours.
 * - "What changed" compares this month with last month and gives both numbers.
 *   A percentage is only given on a base of 20 or more. It never says why
 *   something changed, and never calls a small move a rise or a fall.
 * - No money. Nothing about ads beyond the existing section. Nothing about spend.
 *
 * Pure: takes counts, returns sentences.
 */
import { MIN_BASE_FOR_PERCENT } from './ad-comparison';

export function plainSummaryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.MONTHLY_REPORT_PLAIN_SUMMARY || '').trim().toLowerCase() === 'on';
}

export interface Did {
  postsPublished: number;
  repliesPosted: number;
  /** Listing fields changed this month and still in place, by who chose it: 'shop' (ticked or saved by the shop) or 'us'. */
  listingChanges: Array<{ what: string; by: 'shop' | 'us' }>;
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
  const mine = Array.from(new Set(d.listingChanges.filter((c) => c.by === 'shop').map((c) => c.what.toLowerCase())));
  const ours = Array.from(new Set(d.listingChanges.filter((c) => c.by === 'us').map((c) => c.what.toLowerCase())));
  if (mine.length) out.push(`You updated your ${list(mine)}, and we put ${mine.length === 1 ? 'it' : 'them'} on your listing.`);
  if (ours.length) out.push(`We updated your ${list(ours)}.`);
  if (d.repliesWaiting) out.push(`${n(d.repliesWaiting, 'reply is', 'replies are')} waiting on your dashboard for you to approve.`);
  if (d.postsWaiting) out.push(`${n(d.postsWaiting, 'post is', 'posts are')} waiting on your dashboard for you to approve.`);
  if (!d.postsOn && !d.repliesOn && !out.length) out.push('Posts and review replies are both switched off, so we did not post or reply for you this month. You can turn either on in Settings.');
  else if (!out.length) out.push('Nothing needed doing on your listing this month.');
  return out;
}

export interface Figures { views: number; calls: number; websiteClicks: number; directions: number }

/** One line per figure: this month, last month, and how they compare, in words. */
export function whatChanged(now: Figures | null, before: Figures | null): string[] {
  if (!now) return [];
  const LINES: Array<[keyof Figures, string, string]> = [['calls', 'Calls from your listing', 'calls'], ['websiteClicks', 'Website clicks', 'clicks'], ['directions', 'Requests for directions', 'requests'], ['views', 'Times you were seen on Google', 'times']];
  return LINES.map(([key, label]) => {
    const a = now[key];
    if (!before) return `${label}: ${a.toLocaleString('en-GB')}.`;
    const b = before[key];
    if (a === b) return `${label}: ${a.toLocaleString('en-GB')}, the same as last month.`;
    const dir = a > b ? 'up from' : 'down from';
    const pct = b >= MIN_BASE_FOR_PERCENT ? ` (${a > b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%)` : '';
    return `${label}: ${a.toLocaleString('en-GB')}, ${dir} ${b.toLocaleString('en-GB')} last month${pct}.`;
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

/** The two lists as a block for the top of the email. Empty when there is nothing to say. */
export function narrativeHtml(did: string[], changed: string[], hasLastMonth: boolean): string {
  if (!did.length && !changed.length) return '';
  const ul = (items: string[]) => `<ul style="margin:0 0 4px;padding-left:20px;font-size:15px;line-height:1.6;color:#333;">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const h = (t: string) => `<h3 style="font-size:15px;margin:14px 0 6px;color:#1A1A1A;">${t}</h3>`;
  return `<div style="background:#FAFAF8;border:1px solid #E8E4DC;border-radius:12px;padding:6px 18px 14px;margin:0 0 24px;">
    ${did.length ? h('What we did') + ul(did) : ''}
    ${changed.length ? h(hasLastMonth ? 'What changed' : 'Your figures this month') + ul(changed) + `<p style="font-size:12px;color:#999;margin:8px 0 0;">These are Google's own figures for your listing. They go up and down for many reasons.</p>` : ''}
  </div>`;
}
