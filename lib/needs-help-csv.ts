/**
 * The "Needs help" list in /admin/pilot as a file, to hand to whoever is
 * ringing round. Pure, and safe to run in the browser.
 *
 * NO EMAIL ADDRESS IS EVER IN IT. The row type has no contact field, so a
 * shop's address cannot be passed in by accident, and anything shaped like an
 * address in the free text (an operator's note, say) is replaced before it is
 * written. Customers' addresses are never stored anywhere the app could read
 * them from (review requests keep a hash only), so none can reach it either.
 */
export interface NeedsHelpRow {
  name: string;
  town: string | null;
  help: { label: string; since: string | null; why: string; action: string };
  note: string | null;
}

const ADDRESS = /[^\s@<>()",;:]+@[^\s@<>()",;:]+/g;
/** Anything shaped like an email address, taken out. */
export const withoutAddresses = (s: string) => s.replace(ADDRESS, '[address removed]');

/** One cell: quoted, with a leading apostrophe on anything a spreadsheet would read as a formula. */
const cell = (v: unknown) => {
  const t = withoutAddresses(String(v ?? ''));
  const risky = /^[=+\-@]/.test(t);
  return `"${(risky ? `'${t}` : t).replace(/"/g, '""')}"`;
};

export function needsHelpCsv(rows: NeedsHelpRow[]): string {
  const head = 'shop,town,status,waiting since,what happened,what to do,note';
  return [head, ...rows.map((r) => [r.name, r.town || '', r.help.label, (r.help.since || '').slice(0, 10), r.help.why, r.help.action, r.note || ''].map(cell).join(','))].join('\n');
}
