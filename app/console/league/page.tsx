import { notFound } from 'next/navigation';
import { consoleEnabled } from '@/lib/funder-auth';
import ConsoleClient from '../console-client';

// The network league. 404 unless TARKETT_CONSOLE_ENABLED=on.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stellar Local league', robots: { index: false, follow: false } };

export default function LeaguePage() {
  if (!consoleEnabled()) notFound();
  return <ConsoleClient view="league" />;
}
