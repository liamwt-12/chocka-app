import { notFound } from 'next/navigation';
import { consoleEnabled } from '@/lib/funder-auth';
import ConsoleClient from '../console-client';

// The monthly network summary. 404 unless TARKETT_CONSOLE_ENABLED=on.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stellar Local: this month across the network', robots: { index: false, follow: false } };

export default function SummaryPage() {
  if (!consoleEnabled()) notFound();
  return <ConsoleClient view="summary" />;
}
