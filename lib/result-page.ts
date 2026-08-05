import { type Tenant } from './tenant';

/**
 * The standalone HTML page returned by the link-click routes — `/api/posts/cancel`
 * and `/api/reviews/auto-reply`.
 *
 * These are not React pages. A retailer taps a link in an SMS or an email, and
 * the route answers with a complete document; there is no layout above it, so
 * `<TenantProvider>` and the root layout's CSS custom properties do not apply.
 * The brand has to be threaded in by hand, which is exactly why both copies
 * quietly rendered Chocka to every tenant until now.
 *
 * ONE COPY, because there were two byte-identical ones. Both routes had their own
 * `cancelPage` / `resultPage` differing only in the function name, so a change to
 * the padding in one would have silently drifted from the other. Sharing it also
 * makes the thing testable: a pure (tenant, title, message) → string.
 *
 * `title` and `message` are INTERPOLATED, not escaped. Every current caller passes
 * a string literal, plus one interpolation of `post.status`, which is a
 * database-controlled enum and not user input. If a caller ever wants to show
 * something a user supplied, escape it there or add escaping here — do not assume
 * this is safe by default.
 */
export function resultPage(t: Tenant, title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${t.brandName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { text-align: center; max-width: 360px; padding: 40px; }
    h1 { color: ${t.palette.routeAccent}; font-size: 24px; font-weight: 800; margin-bottom: 8px; }
    p { color: #6b7280; font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
