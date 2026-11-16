'use client';

import { useEffect } from 'react';

/**
 * Tells the server, once, that the invite page was shown in a real browser.
 * See app/api/invite/opened/route.ts for why this is a script and not part of
 * loading the page. Renders nothing. A failure is ignored: it is only a signal.
 */
export default function InviteOpened({ token }: { token: string }) {
  useEffect(() => {
    fetch('/api/invite/opened', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), keepalive: true }).catch(() => {});
  }, [token]);
  return null;
}
