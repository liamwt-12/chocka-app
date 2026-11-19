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
 *   - the typeface is Lato (Regular and Bold), which is open source, and both
 *     weights are EMBEDDED in the file whole, so a printer needs nothing
 *     installed and nothing is substituted (lib/fonts/). Colours are RGB
 *
 * WRITTEN BY HAND, WITH NO PDF LIBRARY. The file format for a page of
 * rectangles, a few lines of text and two embedded fonts is small, and writing it here means no
 * new dependency and the same bytes for the same input every time.
 *
 * Pure: takes names and links, returns bytes. Reads nothing, sends nothing.
 */
import { deflateSync, inflateSync } from 'zlib';
import QRCode from 'qrcode';
import { LATO_REGULAR, LATO_BOLD, type PackedFont } from './fonts/lato-data';
import { readTrueType, type FontMetrics } from './fonts/truetype';

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

// ── The two embedded fonts. Unpacked and measured once, the first time a card is made. ──
interface CardFont { metrics: FontMetrics; /** The font file as stored in the PDF: still compressed. */ packed: Buffer; length: number }
let fonts: { regular: CardFont; bold: CardFont } | null = null;
function load(f: PackedFont): CardFont {
  const packed = Buffer.from(f.deflatedBase64.join(''), 'base64');
  const raw = inflateSync(packed);
  if (raw.length !== f.length) throw new Error(`${f.file} did not unpack to its recorded size`);
  return { metrics: readTrueType(raw), packed, length: raw.length };
}
export function cardFonts(): { regular: CardFont; bold: CardFont } {
  if (!fonts) fonts = { regular: load(LATO_REGULAR), bold: load(LATO_BOLD) };
  return fonts;
}

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
  // Anything the embedded font has no shape for would print as a blank box: it becomes "?".
  const has = cardFonts().regular.metrics.has, hasBold = cardFonts().bold.metrics.has;
  return Array.from(out).map((ch) => { const c = ch.charCodeAt(0); return has[c - 32] && hasBold[c - 32] ? ch : '?'; }).join('');
}

/** Width of already-encoded text, in points, from the embedded font's own measurements. */
export function textWidth(encoded: string, size: number, bold: boolean, tracking = 0): number {
  const m = (bold ? cardFonts().bold : cardFonts().regular).metrics;
  let units = 0;
  for (const ch of encoded) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 255 ? m.widths[code - 32] : 0;
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
  const all = wrap(encoded, size, bold, max);
  // Every line is cut to the width (one very long word would otherwise run off
  // the card), and "..." marks the place only where something was dropped.
  const lines = all.slice(0, maxLines).map((line, i, kept) => {
    const dropped = (i === kept.length - 1 && all.length > maxLines) || textWidth(line, size, bold) > max;
    if (!dropped) return line;
    let cut = line;
    while (cut.length > 1 && textWidth(`${cut}...`, size, bold) > max) cut = cut.slice(0, -1);
    return `${cut}...`;
  });
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
  // The whole link is checked, not just how it starts: nothing can ride along after the place ID.
  if (!/^https:\/\/search\.google\.com\/local\/writereview\?placeid=[A-Za-z0-9_-]{16,300}$/.test(link)) throw new Error('not a Google review link');
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
  if (town) { const t = fit(town, [11, 10, 9], false, inner, 1); fill(o.colours.accent); centred(t.lines[0], t.size, false, y + 1.6 * MM); }

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

  // 1 catalog, 2 pages, 3 and 4 fonts, 5 info, 6 to 9 each font's description and file; then two objects per card.
  const first = 10;
  const kids = cards.map((_, i) => `${first + i * 2} 0 R`).join(' ');
  const { regular, bold } = cardFonts();
  const fontObject = (f: CardFont, descriptor: number) => `<< /Type /Font /Subtype /TrueType /BaseFont /${f.metrics.postScriptName} /FirstChar 32 /LastChar 255 /Widths [${f.metrics.widths.join(' ')}] /FontDescriptor ${descriptor} 0 R /Encoding /WinAnsiEncoding >>`;
  // Flags 32: an ordinary text font. StemV is not in the font file; a usual figure for the weight is given.
  const descriptor = (f: CardFont, file: number) => `<< /Type /FontDescriptor /FontName /${f.metrics.postScriptName} /Flags 32 /FontBBox [${f.metrics.bbox.join(' ')}] /ItalicAngle ${f.metrics.italicAngle} /Ascent ${f.metrics.ascent} /Descent ${f.metrics.descent} /CapHeight ${f.metrics.capHeight} /StemV ${f.metrics.weight >= 600 ? 140 : 80} /FontFile2 ${file} 0 R >>`;
  const fontFile = (f: CardFont) => Buffer.concat([Buffer.from(`<< /Length ${f.packed.length} /Length1 ${f.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), f.packed, Buffer.from('\nendstream', 'latin1')]);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Count ${cards.length} /Kids [${kids}] >>`);
  add(fontObject(regular, 6));
  add(fontObject(bold, 8));
  // The title is read in a different encoding from the page text, so it is kept to plain letters.
  add(`<< /Title ${pdfString(toWinAnsi(o.title || 'Review cards').replace(/[^\x20-\x7E]/g, "'"))} /Producer ${pdfString(toWinAnsi(o.wordmark || 'Review cards'))} >>`);
  add(descriptor(regular, 7)); add(fontFile(regular));
  add(descriptor(bold, 9)); add(fontFile(bold));
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
