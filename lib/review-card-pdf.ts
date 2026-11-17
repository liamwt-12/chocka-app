/**
 * The review card as a print-ready PDF: A6, one card per page.
 *
 * WHAT IS ON A CARD. The shop's name and town, a line asking for a review, and
 * a QR code that opens Google's own "write a review" page for the shop's
 * listing (lib/review-link.ts). That is all. No customer data, no contact
 * details, no tracking: the link is the same for everyone who scans it.
 *
 * PRINT-READY means a printer can take the file as it is:
 *   - the page is A6 (105 x 148 mm) with 3 mm of bleed on every side, and the
 *     PDF says where the trim is (TrimBox) and where the bleed ends (BleedBox)
 *   - everything is drawn as shapes and text, nothing is a picture, so it is
 *     sharp at any size. The QR code is black squares on white
 *   - nothing that matters is within 6 mm of the trim
 *   - the two typefaces are the ones every PDF reader and printer already has
 *     (Helvetica and Helvetica Bold), so no font file is needed or embedded
 *
 * WRITTEN BY HAND, WITH NO PDF LIBRARY. The file format for a page of
 * rectangles and a few lines of text is small, and writing it here means no
 * new dependency and the same bytes for the same input every time.
 *
 * Pure: takes names and links, returns bytes. Reads nothing, sends nothing.
 */
import { deflateSync } from 'zlib';
import QRCode from 'qrcode';

const MM = 72 / 25.4;
/** A6, in points. */
export const TRIM = { width: 105 * MM, height: 148 * MM };
export const BLEED_MM = 3;
const BLEED = BLEED_MM * MM;
/** Nothing that matters is closer to the trim than this. */
const SAFE = 6 * MM;

export interface CardColours { ink: string; paper: string; accent: string; soft: string }
export interface CardInput { name: string; town?: string | null; link: string }
export interface CardOptions { colours: CardColours; wordmark: string; title?: string }

// ── Helvetica character widths, in thousandths of the type size (from the font's published metrics) ──
const W_REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Characters outside Latin-1 that the standard encoding (WinAnsi) still has. */
const WIN_ANSI_EXTRA: Record<string, number> = { '€': 0x80, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85 };

/** Letters with a stroke through them have no accent to take off, so they are listed. */
const NO_ACCENT: Record<string, string> = { '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i', '\u0152': 'OE', '\u0153': 'oe' };

/**
 * A string as the bytes the PDF's fonts understand. A character the encoding
 * does not have loses its accent if that leaves a plain letter, and otherwise
 * becomes "?", so an unusual name can never break the file.
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) out += ch;
    else if (code >= 0xA0 && code <= 0xFF) out += ch;
    else if (WIN_ANSI_EXTRA[ch]) out += String.fromCharCode(WIN_ANSI_EXTRA[ch]);
    else if (/\s/.test(ch)) out += ' ';
    else if (NO_ACCENT[ch]) out += NO_ACCENT[ch];
    else {
      const base = ch.normalize('NFD')[0];
      const b = base.codePointAt(0)!;
      out += b >= 32 && b <= 126 ? base : '?';
    }
  }
  return out;
}

/** Width of already-encoded text, in points. An accented letter is as wide as the plain one. */
export function textWidth(encoded: string, size: number, bold: boolean, tracking = 0): number {
  const table = bold ? W_BOLD : W_REGULAR;
  let units = 0;
  for (const ch of encoded) {
    let code = ch.charCodeAt(0);
    if (code > 126) { const base = (ch.normalize('NFD')[0] || 'n').charCodeAt(0); code = base >= 32 && base <= 126 ? base : 110; }
    units += table[code - 32] ?? 556;
  }
  return (units / 1000) * size + tracking * Math.max(0, encoded.length - 1);
}

/** Break text into lines no wider than `max`. A single word that is too wide stays on its own line. */
export function wrap(encoded: string, size: number, bold: boolean, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of encoded.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold) > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The largest size, from `sizes`, at which the text fits in `max` width on at
 * most `maxLines` lines. If nothing fits, the smallest size, cut to
 * `maxLines` lines with the last ending in "...".
 */
export function fit(encoded: string, sizes: number[], bold: boolean, max: number, maxLines: number): { size: number; lines: string[] } {
  for (const size of sizes) {
    const lines = wrap(encoded, size, bold, max);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, size, bold) <= max)) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  const lines = wrap(encoded, size, bold, max).slice(0, maxLines);
  let last = lines[lines.length - 1] || '';
  while (last.length > 1 && textWidth(`${last}...`, size, bold) > max) last = last.slice(0, -1);
  if (lines.length) lines[lines.length - 1] = `${last}...`;
  return { size, lines };
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
function rgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a colour: ${hex}`);
  const v = parseInt(m[1], 16);
  return `${n(((v >> 16) & 255) / 255)} ${n(((v >> 8) & 255) / 255)} ${n((v & 255) / 255)}`;
}
const pdfString = (encoded: string) => `(${encoded.replace(/([\\()])/g, '\\$1')})`;

/** The dark squares of a QR code for the link, as rows of runs. Only a Google review link is accepted. */
export function qrRuns(link: string): { size: number; runs: Array<{ row: number; col: number; length: number }>; dark: number } {
  if (!link.startsWith('https://search.google.com/local/writereview?placeid=')) throw new Error('not a Google review link');
  // Level Q, as on the screen card: it still scans with a quarter of it scuffed.
  const qr = QRCode.create(link, { errorCorrectionLevel: 'Q' });
  const size = qr.modules.size, data = qr.modules.data;
  const runs: Array<{ row: number; col: number; length: number }> = [];
  let dark = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size;) {
      if (!data[row * size + col]) { col++; continue; }
      let length = 1;
      while (col + length < size && data[row * size + col + length]) length++;
      runs.push({ row, col, length }); dark += length; col += length;
    }
  }
  return { size, runs, dark };
}

/** The drawing instructions for one card. Coordinates are points from the bottom-left of the page, bleed included. */
export function cardContent(card: CardInput, o: CardOptions): string {
  const ops: string[] = [];
  const W = TRIM.width, H = TRIM.height;
  const pageW = W + 2 * BLEED, pageH = H + 2 * BLEED;
  // y measured down from the top of the trimmed card; x from its left edge.
  const X = (x: number) => BLEED + x;
  const Y = (fromTop: number) => BLEED + H - fromTop;
  const fill = (hex: string) => ops.push(`${rgb(hex)} rg`);
  const rect = (x: number, y: number, w: number, h: number) => ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
  const centred = (text: string, size: number, bold: boolean, baselineFromTop: number, tracking = 0) => {
    const x = X((W - textWidth(text, size, bold, tracking)) / 2);
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(tracking)} Tc ${n(x)} ${n(Y(baselineFromTop))} Td ${pdfString(text)} Tj ET`);
  };
  const inner = W - 2 * SAFE;

  // Paper, to the edge of the bleed.
  fill(o.colours.paper); rect(0, 0, pageW, pageH);

  // The band across the top, to the edge of the bleed, with the shop's name in it.
  const band = 40 * MM;
  fill(o.colours.ink); rect(0, Y(band), pageW, band + BLEED);
  fill(o.colours.accent); rect(0, Y(band) - 1.2 * MM, pageW, 1.2 * MM);

  const town = toWinAnsi(card.town || '').trim();
  const name = fit(toWinAnsi(card.name).trim() || 'Our shop', [24, 22, 20, 18, 16, 14, 12], true, inner, 2);
  const lineH = name.size * 1.12;
  const blockH = name.lines.length * lineH + (town ? 6.5 * MM : 0);
  let y = (band - blockH) / 2 + name.size * 0.82;
  fill('#FFFFFF');
  for (const l of name.lines) { centred(l, name.size, true, y); y += lineH; }
  if (town) { fill(o.colours.accent); centred(fit(town, [11, 10, 9], false, inner, 1).lines[0], 11, false, y + 1.6 * MM); }

  // The ask.
  fill(o.colours.ink); centred('Happy with our work?', 17, true, band + 13.5 * MM);
  fill(o.colours.soft); centred('A Google review helps other people find us.', 10.5, false, band + 20 * MM);

  // The QR code: black on a white square, with the quiet margin a scanner needs.
  const qr = qrRuns(card.link);
  const boxSide = 56 * MM, quiet = 4, module = boxSide / (qr.size + 2 * quiet);
  const boxLeft = (W - boxSide) / 2, boxTop = band + 24.5 * MM;
  fill('#FFFFFF'); rect(X(boxLeft), Y(boxTop + boxSide), boxSide, boxSide);
  // Every dark square goes into ONE shape, filled once. Filled row by row, a
  // hairline of white shows between the rows on some screens and printers.
  fill('#000000');
  for (const r of qr.runs) ops.push(`${n(X(boxLeft + (quiet + r.col) * module))} ${n(Y(boxTop + (quiet + r.row + 1) * module) - 0.05)} ${n(r.length * module + 0.05)} ${n(module + 0.05)} re`);
  ops.push('f');

  fill(o.colours.soft); centred("Point your phone's camera at the square and tap the link.", 8.5, false, boxTop + boxSide + 6 * MM);
  fill(o.colours.accent); centred('Thank you', 14, true, boxTop + boxSide + 13.5 * MM);

  // The brand, small, at the foot.
  const mark = toWinAnsi(o.wordmark);
  if (mark) { fill(o.colours.soft); centred(mark, 6.5, false, H - SAFE, 1.4); }
  return ops.join('\n') + '\n';
}

/**
 * One PDF, one A6 page per card, in the order given. Throws if there are no
 * cards or a link is not a Google review link: it never makes a file with an
 * empty page or a code for something else.
 */
export function reviewCardsPdf(cards: CardInput[], o: CardOptions): Buffer {
  if (!cards.length) throw new Error('no cards to print');
  const pageW = TRIM.width + 2 * BLEED, pageH = TRIM.height + 2 * BLEED;
  const objects: Buffer[] = [];
  const add = (body: string | Buffer): number => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')); return objects.length; };

  // 1 catalog, 2 pages, 3 and 4 fonts, 5 info; then two objects per card.
  const first = 6;
  const kids = cards.map((_, i) => `${first + i * 2} 0 R`).join(' ');
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Count ${cards.length} /Kids [${kids}] >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add(`<< /Title ${pdfString(toWinAnsi(o.title || 'Review cards'))} /Producer ${pdfString(toWinAnsi(o.wordmark || 'Review cards'))} >>`);
  const box = (x0: number, y0: number, x1: number, y1: number) => `[${n(x0)} ${n(y0)} ${n(x1)} ${n(y1)}]`;
  for (const card of cards) {
    const stream = deflateSync(Buffer.from(cardContent(card, o), 'latin1'));
    const pageId = objects.length + 1;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox ${box(0, 0, pageW, pageH)} /BleedBox ${box(0, 0, pageW, pageH)} /TrimBox ${box(BLEED, BLEED, BLEED + TRIM.width, BLEED + TRIM.height)} /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]));
  }

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let at = parts[0].length;
  objects.forEach((body, i) => {
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(at); parts.push(chunk); at += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((off) => `${String(off).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${at}\n%%EOF\n`].join('');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

/** A file name that is safe anywhere: letters, digits and hyphens from the shop's name. */
export function cardFileName(name: string): string {
  const slug = toWinAnsi(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
  return `review-card-${slug || 'shop'}.pdf`;
}
