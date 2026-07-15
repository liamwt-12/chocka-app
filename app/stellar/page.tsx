import type { Metadata } from 'next';
import { Lato } from 'next/font/google';
import StellarLanding from './StellarLanding';

// Self-hosted (no external CDN request) — closes the Google-Fonts-CDN gap.
const lato = Lato({
  subsets: ['latin'],
  weight: ['300', '400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-lato',
  display: 'swap',
});

// Temporary base for absolute OG URLs — swap for the Stellar domain once live.
const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
const DESC = 'Stellar Local looks after your shop’s presence on Google so more local customers find you and call. Free — Tarkett pays for it.';

export const metadata: Metadata = {
  metadataBase: new URL(BASE),
  title: 'Stellar Local · Get found',
  description: DESC,
  alternates: { canonical: '/stellar' },
  openGraph: {
    title: 'Stellar Local · Get found',
    description: DESC,
    type: 'website',
    locale: 'en_GB',
    url: '/stellar',
    siteName: 'Stellar Local',
  },
  twitter: {
    card: 'summary',
    title: 'Stellar Local · Get found',
    description: DESC,
  },
  robots: { index: true, follow: true },
};

export default function StellarPage() {
  return <StellarLanding fontClass={lato.variable} />;
}
