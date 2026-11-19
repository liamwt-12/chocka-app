/**
 * Things the model makes up about a shop that the shop never told us:
 * promotions, "free" anything, awards, and customer stories.
 *
 * The post and description writers (lib/ai.ts) are told not to write these,
 * and validateContent checks for them afterwards, because a post saying "20%
 * off all carpets this month" or "free fitting" goes out on the shop's own
 * Google listing as a promise it never made, and "we just fitted a lovely
 * stair runner for a family in Leeds" is a job that never happened.
 *
 * The voice questions (lib/voice.ts) use promotionProblem() too, so a shop's
 * own wording cannot steer the model into text this check would throw away.
 *
 * THE TRADE-OFF. A rejected post is written again once with a stricter note,
 * and if that fails too the shop gets no post that week. A false positive
 * therefore costs a retry (or, rarely, a missed week); a false negative puts an
 * invented promise on a real listing. So these lean towards rejecting. Each
 * pattern below says what it deliberately lets through.
 *
 * Pure: no database, no network.
 */

// ── Promotions ─────────────────────────────────────────────────────────────

/**
 * Any percentage, discount, sale or promotional "offer".
 *
 * Deliberately rejected even when harmless: "100% wool carpet" (a percentage
 * is a percentage; a post does not need one), "the January sales" in any
 * sense. Deliberately allowed: "we offer", "on offer" and "offers" as a verb
 * ("the showroom offers plenty of choice"), "sales team", "after-sales". Only
 * the noun "offer" in a promotional phrase is caught, so an unusual phrasing
 * of a promotion ("our offer this week") can get through; the prompt rule is
 * the first line of defence there.
 */
const PROMOTION_PATTERNS: RegExp[] = [
  /\d\s*%/,
  /\bper\s?cent\b/i,
  /\bhalf[\s-]+price\b/i,
  /\bdiscount/i,
  /\bsale\b/i,
  /\b(january|summer|winter|spring|autumn|christmas|easter|boxing\s+day|black\s+friday|bank\s+holiday|clearance|end[\s-]of[\s-](season|line)|seasonal)\s+sales\b/i,
  /\bclearance\b/i,
  /\b(special|limited|exclusive|introductory|seasonal|launch|bundle|bonus|great|amazing|fantastic|unbeatable|winter|summer|spring|autumn|january|christmas|festive|black\s+friday|this\s+month'?s|this\s+week'?s)\s+(time\s+)?(offers?|deals?)\b(?!\s+of\b)/i,
  /\blimited[\s-]+time\b/i,
  /\boffers?\s+(ends?|ending|valid|runs?|running|close|closes|expires?|available\s+(until|till|while)|while\s+stocks)\b/i,
  /\b(on|this|our|the)\s+offer\s+(ends?|is|runs?|lasts?)\b/i,
  /\bwhile\s+stocks\s+last\b/i,
  /\bbuy\s+one\b/i,
  /\bbogof\b/i,
  /\bfor\s+the\s+price\s+of\b/i,
  /\bmoney[\s-]+off\b/i,
  /\bsave\s+up\s+to\b/i,
  /\b(price\s+(cuts?|drops?|match)|(reduced|slashed|knock[\s-]?down|knocked[\s-]down)\s+prices?)\b/i,
  /\bpromo(tions?|tional|s)?\b/i,
  /\b(voucher|coupon)s?\b/i,
];

// ── "Free" ─────────────────────────────────────────────────────────────────

/**
 * The word "free" in any offer sense: free quotes, free fitting, free
 * delivery, free samples, free of charge, interest-free, no-obligation-free...
 *
 * Allowed, because they are not offers:
 *  - "feel free" (an invitation),
 *  - "free-standing" / "freestanding" / "free standing" (a product shape),
 *  - "hands-free", "free time",
 *  - a hyphenated "X-free" quality ("hassle-free", "mess-free", "dust-free",
 *    "slip-free"), EXCEPT where X is money or commitment: cost-, charge-,
 *    fee-, obligation-, interest-, risk-, VAT-, tax-, commitment-, price-free,
 *    which are offers and are rejected,
 *  - the same few qualities written without the hyphen ("hassle free",
 *    "stress free", "mess free", "dust free", "fuss free", "worry free",
 *    "trouble free").
 * Everything else with "free" in it is rejected, so "free from scratches" or
 * "your free time" are false positives the retry has to fix.
 */
const OFFER_FREE_COMPOUND = /\b(cost|charge|fee|obligation|interest|risk|vat|tax|commitment|price)[\s-]+free\b/i;
const HARMLESS_FREE = [
  /\bfeel\s+free\b/gi,
  /\bfree[\s-]*standing\b/gi,
  /\bhands[\s-]free\b/gi,
  /\b[a-z]+-free\b/gi, // after OFFER_FREE_COMPOUND has had its say
  /\b(hassle|stress|mess|dust|fuss|worry|trouble)\s+free\b/gi,
];

export function containsOfferFree(text: string): boolean {
  if (OFFER_FREE_COMPOUND.test(text)) return true;
  let rest = text;
  for (const re of HARMLESS_FREE) rest = rest.replace(re, ' ');
  return /\bfree\b/i.test(rest);
}

// ── Awards and rankings ────────────────────────────────────────────────────

/**
 * Award, awards, awarded, award-winning, "winner of", "voted best", "number
 * one", "top-rated". "Rewarding" is not caught (no word boundary before the
 * "a"). "Our number one priority" is a false positive. A ranking phrased
 * another way ("the area's favourite") gets through; the prompt rule covers it.
 */
const AWARD_PATTERNS: RegExp[] = [
  /\baward/i,
  /\bwinners?\s+of\b/i,
  /\b(voted|named|ranked)\s+(as\s+)?(the\s+)?(best|top|number|no\.?\s*1|#1|first|favourite)/i,
  /\b(number\s+one|no\.\s*1)\b|#1\b/i,
  /\btop[\s-]rated\b/i,
];

// ── Customer stories and testimonials ──────────────────────────────────────

/**
 * A job or customer the model has made up. Only for posts and descriptions:
 * a review REPLY talks to a real customer by name, so it is never checked
 * against these.
 *
 * Allowed: "for a family home", "a great deal of choice", "families across Leeds", "our customers" in
 * general ("we help customers choose"). Not caught: a story told without these
 * markers ("the Smiths' new hallway looks great"), or a testimonial in single
 * quotes, which cannot be told apart from apostrophes.
 */
const STORY_PATTERNS: RegExp[] = [
  /\b(just|recently)\s+(fitted|finished|completed|laid|installed|transformed|done|wrapped\s+up|helped|refurbished|renovated)\b/i,
  /\b(last|this\s+past)\s+(week|month|weekend)\s*,?\s+we\b/i,
  /\bfor\s+(a|one\s+of\s+our)\s+((lovely|local|happy|regular|young|delighted|returning|new)\s+)?(customers?|clients?|family|couple|homeowners?)\b(?![\s-]+(homes?|houses?|rooms?|kitchens?|life|friendly|run|sized|business|budgets?)\b)/i,
  /\bone\s+of\s+our\s+((lovely|local|happy|regular|delighted|returning)\s+)?(customers?|clients?)\b/i,
  /\ba\s+((lovely|young|local|growing)\s+)?(family|couple)\s+(in|from)\b/i,
  /\b(Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+/,
  /\b(customers?|clients?)\s+(said|says|told\s+us|tells\s+us|wrote|described)\b/i,
  /\btestimonial/i,
  /["“”][^"“”]{12,}["“”]/,
];

/** A promotion, a "free" offer or an award: what the voice questions also refuse. */
export function promotionProblem(text: string): string | null {
  if (PROMOTION_PATTERNS.some((re) => re.test(text))) return 'contains offer or discount';
  if (containsOfferFree(text)) return 'contains free offer';
  if (AWARD_PATTERNS.some((re) => re.test(text))) return 'contains award claim';
  return null;
}

/** Every invented-claim check, for generated posts and descriptions. Returns a reason, or null. */
export function inventedClaimProblem(text: string): string | null {
  return promotionProblem(text) ?? (STORY_PATTERNS.some((re) => re.test(text)) ? 'contains customer story' : null);
}
