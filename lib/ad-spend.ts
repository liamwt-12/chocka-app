/**
 * Ad spend per shop, and a plain answer to "did anything change?".
 *
 * WHO SEES IT. Tarkett (in its console) and admin. NEVER the shop: it is
 * Tarkett's figure, and the shop's monthly email already has its own "change
 * during your ads" section with no money in it. There is a test that the email
 * and the report job never touch the spend column.
 *
 * WHAT IT CLAIMS. Change alongside the ads, set against shops with no ads over
 * the same weeks. Not what caused it: attribution was declined in writing, and
 * the existing comparison (lib/ad-comparison.ts) is built on that. So this
 * never divides spend by anything. There is no "cost per call". Spend and
 * change are two facts shown side by side.
 *
 * THE "NO CLEAR CHANGE" RULE (change the numbers below to move it).
 * Measured on customer actions (calls + website clicks + direction requests):
 * the four weeks after the ads started against the same four weeks last year
 * (or, for a shop with no figures from last year, the four weeks before the
 * ads; the sentence says which):
 *
 *   too early          the four weeks after are not complete yet
 *   not enough history Google has too few days either side to compare fairly
 *   too few to say     fewer than 10 actions in the earlier period: a
 *                      percentage on a base that small is noise
 *   clear rise         up 10% or more, AND at least 3 more actions, AND at
 *                      least 5 points better than the shops with no ads
 *                      measured the same way (when there are enough of those
 *                      to compare; otherwise the first two)
 *   fall               down 10% or more, at least 3 fewer actions, and at
 *                      least 5 points worse than them
 *   no clear change    everything else
 *
 * A shop is FLAGGED when money has been spent on it and the answer is "no clear
 * change" or "fall". "Too early", "not enough history" and "too few to say"
 * are never flagged: they are not evidence of anything.
 *
 * Pure. No database, no network.
 */
import { type AdComparison, type MetricChange } from './ad-comparison';
import { MIN_BASE_ACTIONS, MIN_EXTRA_ACTIONS, movedEnough, BASIS_WORDS } from './year-on-year';

/** Fewer customer actions than this in the earlier period, and the answer is "too few to say". */
export const MIN_BASE_EVENTS = MIN_BASE_ACTIONS;
/** A clear rise must also be at least this many more actions (and a fall this many fewer). */
export const MIN_EXTRA_EVENTS = MIN_EXTRA_ACTIONS;
/** A change smaller than this, either way, is not called a change. */
export const CLEAR_CHANGE_PERCENT = 10;
/** A rise must beat the shops with no ads by at least this many points to be called clear. */
export const MARGIN_OVER_NO_ADS = 5;
/** A figure above this is taken to be a typing mistake. */
export const MAX_SPEND_PENCE = 100_000_00;

const ACTION_KEYS = ['calls', 'websiteClicks', 'directions'];

export type VerdictKey = 'no_ads' | 'too_early' | 'not_enough_history' | 'too_few' | 'clear_rise' | 'no_clear_change' | 'fall';

export interface AdVerdict {
  key: VerdictKey;
  label: string;
  /** One sentence, no raw counts (the console promises none). */
  detail: string;
  /** Percentage change in customer actions for the shop, when it can be stated. */
  change: number | null;
  /** The same for shops with no ads, when there are enough to compare. */
  noAdsChange: number | null;
  /** Money spent and nothing to show for it yet. Only ever true with a spend figure. */
  flag: boolean;
}

const sum = (changes: MetricChange[], side: 'before' | 'after') => changes.filter((c) => ACTION_KEYS.includes(c.key)).reduce((s, c) => s + c[side], 0);
const pct = (before: number, after: number) => Math.round(((after - before) / before) * 100);
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

export function adVerdict(spendPence: number | null | undefined, comparison: AdComparison | null): AdVerdict {
  const spent = typeof spendPence === 'number' && spendPence > 0;
  const none = { change: null, noAdsChange: null, flag: false };
  if (!comparison) return { key: 'no_ads', label: 'No ad dates', detail: 'No ad start date has been entered for this shop.', ...none };
  if (comparison.status === 'too_early') return { key: 'too_early', label: 'Too early to say', detail: `Four full weeks of figures after the ads started are needed. Ready from ${comparison.readyOn}.`, ...none };
  if (comparison.status === 'not_enough_history') return { key: 'not_enough_history', label: 'Not enough history', detail: 'Google does not hold enough figures from before the ads started to compare fairly.', ...none };

  const before = sum(comparison.shop, 'before'), after = sum(comparison.shop, 'after');
  const words = BASIS_WORDS[comparison.basis];
  if (before < MIN_BASE_EVENTS) return { key: 'too_few', label: 'Too few to say', detail: `This shop had too few customer actions in the ${comparison.basis === 'last_year' ? 'same four weeks last year' : 'four weeks before its ads'} to give a meaningful percentage.`, ...none };
  const change = pct(before, after);

  let noAdsChange: number | null = null;
  if (comparison.network) {
    const nb = sum(comparison.network.changes, 'before'), na = sum(comparison.network.changes, 'after');
    if (nb >= MIN_BASE_EVENTS) noAdsChange = pct(nb, na);
  }
  const against = noAdsChange === null ? 'There are not enough shops without ads to compare against.' : `Shops with no ads changed by ${signed(noAdsChange)}, measured the same way.`;
  const beats = noAdsChange === null || change - noAdsChange >= MARGIN_OVER_NO_ADS;
  const trails = noAdsChange === null || noAdsChange - change >= MARGIN_OVER_NO_ADS;
  // 10 to 11 is "+10%" and is one phone call: a rise or fall must also be a real number of actions.
  const enough = movedEnough(before, after);
  const detail = `Customer actions ${signed(change)} in the four weeks after the ads started, ${words.against}. ${against}`;

  if (change >= CLEAR_CHANGE_PERCENT && enough && beats) return { key: 'clear_rise', label: 'Clear rise', detail, change, noAdsChange, flag: false };
  if (change <= -CLEAR_CHANGE_PERCENT && enough && trails) return { key: 'fall', label: 'Fall', detail, change, noAdsChange, flag: spent };
  return { key: 'no_clear_change', label: 'No clear change', detail, change, noAdsChange, flag: spent };
}

/**
 * Spend typed into the admin page, in pounds ("250", "250.50", "£1,250").
 * Returns pence, null to clear it, or undefined if it is not a sensible amount.
 */
export function parseSpendPounds(input: unknown): number | null | undefined {
  if (input === null || input === undefined || input === '') return null;
  const text = String(input).replace(/[£,\s]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return undefined;
  const pence = Math.round(parseFloat(text) * 100);
  return pence > MAX_SPEND_PENCE ? undefined : pence;
}

/** Pence as pounds for display: 25050 -> "£250.50", 25000 -> "£250". */
export function formatPounds(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return '';
  const pounds = pence / 100;
  return `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** The end date must not be before the start. Returns a sentence, or null if fine. */
export function adDatesProblem(start: string | null | undefined, end: string | null | undefined): string | null {
  if (end && !start) return 'Enter the date the ads started before the date they ended.';
  if (start && end && end < start) return 'The ads cannot end before they start.';
  return null;
}
