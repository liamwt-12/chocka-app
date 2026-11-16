/**
 * Take email addresses and phone numbers out of text before it is logged.
 *
 * When a text or an email is refused, the provider's error message often
 * quotes the address or number it refused. Function logs are kept by Netlify
 * and read by whoever debugs a failure, and a shop's mobile number has no
 * business there. The rest of the message is kept: it is what explains the
 * failure.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// + or 0, then at least 9 more digits, allowing spaces, dashes and brackets between them.
const PHONE = /(?<![\w.])(?:\+|0)(?:[\s().-]*\d){9,14}(?![\d])/g;

export function redact(text: unknown, max = 500): string {
  return String(text ?? '')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')
    .slice(0, max);
}
