// ── Tenant model (slice 0) ────────────────────────────────────────────────
// Single source of truth for per-tenant brand identity. Today there is exactly
// one tenant (Chocka), and getTenant() returns it unconditionally. Hostname →
// tenant resolution (middleware) and a real `tenants` table arrive in slice 2+.
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
  meta: { title: string; description: string };
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
  meta: {
    title: 'Chocka — Keep your diary chocka',
    description:
      'We manage your Google Business Profile so you don\'t have to. Auto-posting, review replies, weekly stats. £29/month.',
  },
  palette: {
    brand: '#D4622B',
    brandDark: '#C0571F',
    brandLight: 'rgba(212,98,43,0.06)',
    brandStrong: '#E8541A',
    brandStrongDark: '#C43E10',
    brandStrongLight: '#FFF0EB',
    routeAccent: '#FF6B35',
    charcoal: '#2A2520',
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

const DEFAULT_APP_URL = 'https://app.chocka.co.uk';
const DEFAULT_EMAIL_FROM = 'Chocka <hello@chocka.co.uk>';

// Resolve the current tenant. Slice 0: always Chocka. Env reads reproduce the
// exact fallbacks the code used before (NEXT_PUBLIC_APP_URL, RESEND_FROM).
export function getTenant(): Tenant {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  return {
    ...CHOCKA_BASE,
    appUrl,
    appHost: appUrl.replace(/^https?:\/\//, ''),
    emailFrom: process.env.RESEND_FROM || DEFAULT_EMAIL_FROM,
  };
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
