// ── Tenant model ──────────────────────────────────────────────────────────
// Single source of truth for per-tenant brand identity. There are two tenants:
// Chocka (primary) and Stellar Local (Tarkett white-label).
//
// TWO RESOLUTION PATHS, deliberately kept apart:
//
//   getTenant()          → always Chocka. Used by cron, email and API routes,
//                          i.e. everywhere without a per-request Host.
//   getTenantBySlug(s)   → explicit lookup. Used by getRequestTenant() in
//                          lib/tenant-request.ts, which reads the
//                          `x-tenant-slug` header set by middleware.
//
// getTenant() is NOT host-aware on purpose. Both hosts are served by one
// Netlify deploy, so a process-wide switch (e.g. a TENANT env var) would flip
// live Chocka users too. Host-based resolution only works where a request
// exists — which is why the request-scoped path lives in its own module.
//
// KNOWN GAP: cron and lib/email.ts still call getTenant(), so Stellar users
// currently receive Chocka-branded email and SMS. The scheduler has no tenant
// in its Host header, so this cannot be fixed by hostname — it needs a
// tenant_slug column on the user row. Tracked as a later slice.
//
// This file is pure data + env reads — no next/headers, no 'use client' — so it
// is safe to import from any server context (route handlers, cron, RSC). Client
// components must NOT import getTenant(); they receive the tenant via
// <TenantProvider> / useTenant() (see lib/tenant-context.tsx) so nothing here
// leaks into the client bundle.

export interface TenantPalette {
  // Tailwind `brand` token + globals --orange (the same #D4622B today)
  brand: string;
  brandDark: string;
  brandLight: string;
  // The app-chrome / inline-UI orange (distinct from `brand` in the current
  // codebase — see the three-orange note in MULTI_TENANCY_PLAN.md §3)
  brandStrong: string;
  brandStrongDark: string;
  brandStrongLight: string;
  // Heading accent used by the standalone server-rendered HTML pages/emails
  routeAccent: string;
  // Neutral-ish brand tokens carried on :root (globals color custom properties)
  charcoal: string;
  cream: string;
  orange: string;
  gold: string;
  green: string;
  red: string;
  grey: string;
  text: string;
  warmBg: string;
}

export interface Tenant {
  slug: string;
  brandName: string; // "Chocka" — brand word used in copy
  wordmark: string; // "CHOCKA" — uppercase logotype
  legalEntity: string;
  appUrl: string; // canonical app origin (app.chocka.co.uk)
  appHost: string; // appUrl without scheme (for bare-host copy)
  marketingUrl: string; // marketing site / referral link base (chocka.co.uk)
  emailFrom: string; // Resend "from" header
  supportEmail: string;
  teamEmail: string;
  privacyEmail: string;
  priceMonthlyGbp: number; // 29
  priceMonthlyPence: number; // 2900
  proofLocation: string; // Chocka-specific proof copy ("North East")

  // Who pays, when the retailer does not. Set only on a zero-price tenant, and
  // used wherever "free" would otherwise read as "trial" or "broken" — a
  // retailer told the service is free still wants to know why it is.
  fundedBy?: string;

  /**
   * Where this tenant's retailer records came from, when they were NOT collected
   * from the retailer themselves.
   *
   * Drives the UK GDPR **Article 14** disclosure on /privacy. Article 14 applies
   * precisely because the data was obtained from a third party: the retailer
   * never gave it to us, so they have to be told what we hold, where it came
   * from, and how to have it erased — and told at the latest at first contact.
   *
   * Undefined on a tenant whose retailers only ever arrive by signing up
   * themselves, which is Chocka. Chocka renders none of this and is unchanged.
   *
   * Single source of truth, the same treatment `fundedBy` got: the source is
   * named in one place rather than restated in prose that can drift from it.
   */
  dataSource?: {
    holder: string;      // whose list it is — "Tarkett"
    description: string; // what the list is — "its public UK store locator"
    url: string;         // where a retailer can go and look at it
    obtained: string;    // when we took a copy — "June 2026"
    /**
     * What was taken from the list. Must match the columns actually held —
     * a notice that names data we do not hold, or omits data we do, is a defect
     * in itself. Verified against `retailers` and against the committed copy in
     * `scripts/source-data/` on 2026-08-05.
     */
    fields: string;
    /** What was worked out from public Google data, which the list did not contain. */
    derived: string;
    /** How long the record is kept, and what ends it. Article 14(2)(a). */
    retention: string;
  };

  // Every claim the sign-in page makes. These were hardcoded, which meant the
  // Stellar host asserted Chocka's evidence: "7,101 businesses scored across
  // the UK" is Chocka's North East dataset restated as national, and the
  // 8-week average is a Chocka results claim with no Stellar cohort behind it.
  // A brand states its own proof or states none.
  //
  // `proofClaim: null` and `avgScoreAfter8Weeks: null` both HIDE their element
  // rather than rendering something empty.
  loginCopy: {
    headline: string[]; // rendered one line per entry
    sub: string;
    proofClaim: string | null;
    avgScoreAfter8Weeks: number | null;
  };

  meta: { title: string; description: string };
  // CSS font stacks injected as --hd (headings) and --bd (body). Whatever is
  // named here must be loaded by an @import in app/globals.css.
  fontHeading: string;
  fontBody: string;
  // Path to the tenant's icon, or null to serve no favicon (Chocka has never
  // had one). Files live in public/.
  iconSvg: string | null;
  iconPng: string | null;
  palette: TenantPalette;
}

// Static brand data for Chocka. Env-derived fields (appUrl, emailFrom) are
// overlaid in getTenant() so this object stays serializable and side-effect-free.
const CHOCKA_BASE: Omit<Tenant, 'appUrl' | 'appHost' | 'emailFrom'> = {
  slug: 'chocka',
  brandName: 'Chocka',
  wordmark: 'CHOCKA',
  legalEntity: 'Useful for Humans Ltd',
  marketingUrl: 'https://chocka.co.uk',
  supportEmail: 'hello@chocka.co.uk',
  teamEmail: 'team@chocka.co.uk',
  privacyEmail: 'privacy@chocka.co.uk',
  priceMonthlyGbp: 29,
  priceMonthlyPence: 2900,
  proofLocation: 'North East',
  loginCopy: {
    headline: ['SEE YOUR', 'GOOGLE PROFILE', 'SCORE.'],
    sub: 'Find out what\'s hurting your visibility and what to fix first. Takes 30 seconds.',
    proofClaim: '7,101 businesses scored across the North East',
    avgScoreAfter8Weeks: 84,
  },
  meta: {
    title: 'Chocka — Keep your diary chocka',
    description:
      'We manage your Google Business Profile so you don\'t have to. Auto-posting, review replies, weekly stats. £29/month.',
  },
  // Unchanged from the values globals.css has always set on :root.
  fontHeading: "'Cabinet Grotesk', sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  // Chocka has never shipped a favicon; keep it that way rather than inventing one.
  iconSvg: null,
  iconPng: null,
  palette: {
    brand: '#D4622B',
    brandDark: '#C0571F',
    brandLight: 'rgba(212,98,43,0.06)',
    brandStrong: '#E8541A',
    brandStrongDark: '#C43E10',
    brandStrongLight: '#FFF0EB',
    routeAccent: '#FF6B35',
    // #1C2331, not the warmer #2A2520 this field used to hold. Nothing ever read
    // --charcoal; the value that actually rendered was tailwind.config.ts's
    // hardcoded charcoal, and `charcoal` is now sourced from here so Stellar can
    // have its own. Using #1C2331 keeps Chocka's 24 text-charcoal elements
    // pixel-identical. The warm #2A2520 survives in globals.css as --shadow.
    charcoal: '#1C2331',
    cream: '#F8F6F3',
    orange: '#D4622B',
    gold: '#E7C36A',
    green: '#2D8B4E',
    red: '#D93025',
    grey: '#A09A93',
    text: '#5A554F',
    warmBg: '#F0EDE8',
  },
};

// Static brand data for Stellar Local, the Tarkett white-label.
//
// Colours are lifted from the live holding site (stellar-site/styles.css) so
// the app and the marketing site cannot drift: paper #FCFBF9, ink #171717,
// gold #B8923C, plus its --ink-soft / --ink-faint neutrals and its error red.
// Five values have no counterpart on the static site and are derived here —
// each is marked below.
//
// The palette keys are Chocka-era names (`orange`, `cream`, `charcoal`). They
// are kept as-is because ~30 components read them; for Stellar they carry
// Stellar values. Renaming them to neutral tokens is a separate tidy-up.
const STELLAR_BASE: Omit<Tenant, 'appUrl' | 'appHost' | 'emailFrom'> = {
  slug: 'stellar',
  brandName: 'Stellar Local',
  wordmark: 'STELLAR LOCAL',
  legalEntity: 'Useful for Humans Ltd',
  marketingUrl: 'https://stellarlocal.co.uk',
  supportEmail: 'hello@stellarlocal.co.uk',
  teamEmail: 'team@stellarlocal.co.uk',
  privacyEmail: 'privacy@stellarlocal.co.uk',
  // Free to the retailer — Tarkett funds the service for its network. Any
  // price-derived copy or arithmetic must handle 0 (see app/dashboard).
  priceMonthlyGbp: 0,
  priceMonthlyPence: 0,
  proofLocation: 'UK',
  fundedBy: 'Tarkett',
  // The 180 retailer records behind the Stellar pilot were taken from Tarkett's
  // public store locator on 2026-06-21, not collected from the retailers. 105 of
  // the captured email addresses have non-generic local parts and are therefore
  // personal data about identifiable people — which is what makes this an
  // Article 14 obligation rather than a courtesy.
  dataSource: {
    holder: 'Tarkett',
    description: 'its public UK store locator',
    url: 'https://home.tarkett.co.uk/en_GB/store-locator',
    obtained: 'June 2026',
    // Deliberately covers BOTH stores. The database row holds the name, town and
    // email; the address, postcode and coordinates are held separately in the
    // committed source file. Describing only the database would understate what
    // is held.
    fields:
      'your business name, the town and country you trade in, your address, postcode and map ' +
      'position, your website address, and — where Tarkett published one — a contact email address',
    derived:
      'your Google rating, how many reviews and photos your listing has, whether it links to a ' +
      'website, and an identifier for the listing itself — and from those, a score and a band',
    // SOFTENED to match what is actually performed. The earlier draft promised an
    // annual re-check and deletion within six months — neither of which exists.
    // Promising an erasure the system does not carry out is the same defect this
    // notice was written to correct, so the wording states the CRITERIA and is
    // honest that the review is manual.
    //
    // Article 14(2)(a) expressly allows criteria in place of a period where a
    // period is not possible, so this is the supported route rather than a dodge.
    //
    // Erasure on request IS performed — by hand, off the privacy mailbox — so it
    // is the one thing here stated as a firm commitment.
    retention:
      'for as long as you are listed as a stockist on that page and we are providing this service ' +
      'to that network. We review that by hand rather than automatically, so your record may ' +
      'persist for a while after you stop being listed',
  },
  loginCopy: {
    // No self-serve promise. On the Stellar host this page is invite-only, so a
    // "see your score, takes 30 seconds" hero sat directly above a panel saying
    // they cannot — two contradictory messages on one screen. This copy is the
    // salvaged Stellar positioning (see FOLLOWUPS) and stays true whether the
    // reader has an invite or not.
    headline: ['GET FOUND.', 'GET THE PHONE', 'RINGING.'],
    sub: 'We look after your shop\'s presence on Google, so more local customers find you and call.',
    // No numeric proof. The Stellar baseline (mean 75.3 across 169 verified)
    // carries four mandatory conditions — including that it is NEVER shown next
    // to an in-app score, which this page displays. Stating no number is the
    // only safe option here; see FOLLOWUPS "Hard rule".
    proofClaim: 'Free for Tarkett retailers — Tarkett pays for it',
    avgScoreAfter8Weeks: null,
  },
  meta: {
    title: 'Stellar Local · Get found',
    description:
      'Stellar Local looks after your shop\'s presence on Google so more local customers find you and call. Free — Tarkett pays for it.',
  },
  // Lato throughout, matching stellar-site/styles.css. Loaded in globals.css.
  fontHeading: "'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontBody: "'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  iconSvg: '/stellar-star.svg',
  iconPng: '/stellar-icon-512.png',
  palette: {
    brand: '#B8923C', // --gold
    brandDark: '#9C7C33', // derived: --gold at 85% lightness
    brandLight: 'rgba(184,146,60,0.06)', // derived: --gold at 6% alpha
    brandStrong: '#B8923C', // Stellar has one accent, not Chocka's two
    brandStrongDark: '#9C7C33', // derived
    brandStrongLight: '#FAF5EA', // derived: pale gold wash for fills
    routeAccent: '#B8923C', // --gold
    charcoal: '#171717', // --ink
    cream: '#FCFBF9', // --paper
    orange: '#B8923C', // legacy key name; carries --gold
    gold: '#B8923C', // --gold
    green: '#2D8B4E', // semantic (success), shared with Chocka
    red: '#B4372B', // stellar-site .gate .msg.error
    grey: '#8A8680', // --ink-faint
    text: '#55524E', // --ink-soft
    warmBg: '#F1EFE9', // --panel from the retired /stellar page (a designed value)
  },
};

const DEFAULT_APP_URL = 'https://app.chocka.co.uk';
const DEFAULT_EMAIL_FROM = 'Chocka <hello@chocka.co.uk>';

// Stellar's own origin and sender. These deliberately do NOT read
// NEXT_PUBLIC_APP_URL / RESEND_FROM: on a shared deploy those hold Chocka's
// values, so reading them would point Stellar's checkout returns, billing
// portal and email at app.chocka.co.uk. Overridable for preview deploys.
const STELLAR_APP_URL = 'https://app.stellarlocal.co.uk';
const STELLAR_EMAIL_FROM = 'Stellar Local <hello@stellarlocal.co.uk>';

// Overlay the env-derived fields onto static brand data.
function hydrate(
  base: Omit<Tenant, 'appUrl' | 'appHost' | 'emailFrom'>,
  appUrl: string,
  emailFrom: string,
): Tenant {
  return {
    ...base,
    appUrl,
    appHost: appUrl.replace(/^https?:\/\//, ''),
    emailFrom,
  };
}

// The primary tenant. Not host-aware — see the module header. Env reads
// reproduce the exact fallbacks the code used before this file gained a second
// tenant (NEXT_PUBLIC_APP_URL, RESEND_FROM).
export function getTenant(): Tenant {
  return hydrate(
    CHOCKA_BASE,
    process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL,
    process.env.RESEND_FROM || DEFAULT_EMAIL_FROM,
  );
}

// Explicit lookup by slug. Unknown or missing slugs fail open to the primary
// tenant, matching resolveTenantSlug()'s behaviour in lib/tenant-registry.ts —
// a bad Host serves Chocka rather than erroring.
export function getTenantBySlug(slug?: string | null): Tenant {
  if (slug === 'stellar') {
    return hydrate(
      STELLAR_BASE,
      process.env.STELLAR_APP_URL || STELLAR_APP_URL,
      process.env.STELLAR_RESEND_FROM || STELLAR_EMAIL_FROM,
    );
  }
  return getTenant();
}

/**
 * A row fetched with the tenants FK embedded — `.select('*, tenants ( slug )')`.
 * PostgREST returns a many-to-one embed as a single object, not an array.
 *
 * Only the slug is read. Brand config comes from this file, not from the row:
 * the tenants table has no columns for fontHeading, fontBody, iconSvg, iconPng
 * or priceMonthlyGbp, so it cannot be a complete source of truth yet.
 */
export interface TenantEmbeddedRow {
  tenants?: { slug?: string | null } | null;
}

/**
 * Resolve the tenant that a per-user row belongs to.
 *
 * WHY THIS EXISTS: cron jobs are invoked by a scheduler, not by a retailer's
 * browser, so there is no Host header to resolve from and getRequestTenant()
 * throws. The tenant has to come from the data being processed instead. This is
 * the one gap host-based tenancy structurally cannot close.
 *
 * FAIL-OPEN, AND THE TRAP THAT COMES WITH IT: a row whose query forgot to embed
 * `tenants ( slug )` has no slug, so this returns the primary tenant rather than
 * throwing — matching getTenantBySlug() and resolveTenantSlug(). That keeps a
 * missed embed from taking a cron down, but it means the failure mode is a
 * Stellar retailer silently receiving Chocka-branded mail. If you add a new
 * per-user query that sends anything, embedding the slug is not optional.
 */
export function getTenantForRow(row: TenantEmbeddedRow | null | undefined): Tenant {
  return getTenantBySlug(row?.tenants?.slug ?? null);
}

// "#RRGGBB" → "R G B" channels, for Tailwind's rgb(var(--x) / <alpha>) pattern
// so opacity modifiers (bg-brand/20, ring-brand/50) keep working.
function channels(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// The CSS custom-property block injected on :root by the root layout. Keeping
// the mapping here (rather than in globals.css) makes the theme tenant-sourced.
// --brand-rgb / --brand-dark-rgb are channel triplets consumed by Tailwind's
// `brand` token; everything else is a ready-to-use color value for inline styles.
export function tenantCssVars(t: Tenant): string {
  const p = t.palette;
  return [
    // Fonts, overriding the fallbacks globals.css sets on :root.
    `--hd:${t.fontHeading}`,
    `--bd:${t.fontBody}`,
    // Channel triplets for the tokens Tailwind exposes as utilities, so opacity
    // modifiers keep working (components/Button.tsx uses bg-charcoal/90).
    `--charcoal-rgb:${channels(p.charcoal)}`,
    `--cream-rgb:${channels(p.cream)}`,
    `--gold-rgb:${channels(p.gold)}`,
    `--brand-rgb:${channels(p.brand)}`,
    `--brand-dark-rgb:${channels(p.brandDark)}`,
    `--brand-light:${p.brandLight}`,
    `--brand-strong:${p.brandStrong}`,
    `--brand-strong-dark:${p.brandStrongDark}`,
    `--brand-strong-light:${p.brandStrongLight}`,
    `--charcoal:${p.charcoal}`,
    `--cream:${p.cream}`,
    `--orange:${p.orange}`,
    `--gold:${p.gold}`,
    `--green:${p.green}`,
    `--red:${p.red}`,
    `--grey:${p.grey}`,
    `--text:${p.text}`,
    `--warm-bg:${p.warmBg}`,
  ].join(';');
}
