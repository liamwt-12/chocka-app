/**
 * Just enough of the TrueType file format to embed a font in a PDF: how wide
 * each character is, and the handful of measurements a PDF asks for. Read
 * straight from the font file, so nothing about the font is typed in by hand.
 *
 * Pure: bytes in, numbers out.
 */

/** The characters the PDF's encoding (WinAnsi, which is Windows-1252) puts at 0x80 to 0x9F. Elsewhere a byte is its own character. */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};
/** The character a byte stands for in the PDF's encoding. */
export const winAnsiToUnicode = (byte: number): number => CP1252_HIGH[byte] ?? byte;

export interface FontMetrics {
  /** The font's own name for itself, as a PDF name (no spaces). */
  postScriptName: string;
  /** Widths of bytes 32 to 255 in the PDF's encoding, in thousandths of the type size. A character the font lacks is 0. */
  widths: number[];
  /** Which of those bytes the font has a shape for. */
  has: boolean[];
  ascent: number; descent: number; capHeight: number;
  bbox: [number, number, number, number];
  italicAngle: number;
  weight: number;
}

export function readTrueType(font: Buffer): FontMetrics {
  const u16 = (o: number) => font.readUInt16BE(o), i16 = (o: number) => font.readInt16BE(o), u32 = (o: number) => font.readUInt32BE(o);
  const tables = new Map<string, { offset: number; length: number }>();
  const count = u16(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    tables.set(font.toString('latin1', at, at + 4), { offset: u32(at + 8), length: u32(at + 12) });
  }
  const need = (tag: string) => { const t = tables.get(tag); if (!t) throw new Error(`not a usable TrueType font: no ${tag} table`); return t; };
  const head = need('head').offset, hhea = need('hhea').offset, hmtx = need('hmtx').offset, os2 = need('OS/2').offset, post = need('post').offset, name = need('name').offset;
  const unitsPerEm = u16(head + 18);
  const scale = (v: number) => Math.round((v * 1000) / unitsPerEm);
  const numberOfHMetrics = u16(hhea + 34);
  const advance = (glyph: number) => u16(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1));

  // The character map: Windows, Unicode, the ordinary two-byte kind (format 4).
  const cmap = need('cmap').offset;
  let sub = -1;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const at = cmap + 4 + i * 8;
    if (u16(at) === 3 && u16(at + 2) === 1 && u16(cmap + u32(at + 4)) === 4) sub = cmap + u32(at + 4);
  }
  if (sub < 0) throw new Error('not a usable TrueType font: no Unicode character map');
  const segs = u16(sub + 6) / 2;
  const endAt = sub + 14, startAt = endAt + segs * 2 + 2, deltaAt = startAt + segs * 2, rangeAt = deltaAt + segs * 2;
  const glyphFor = (code: number): number => {
    for (let s = 0; s < segs; s++) {
      if (code > u16(endAt + s * 2)) continue;
      const start = u16(startAt + s * 2);
      if (code < start) return 0;
      const range = u16(rangeAt + s * 2), delta = u16(deltaAt + s * 2);
      if (range === 0) return (code + delta) & 0xFFFF;
      const g = u16(rangeAt + s * 2 + range + (code - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xFFFF;
    }
    return 0;
  };

  const widths: number[] = [], has: boolean[] = [];
  for (let byte = 32; byte <= 255; byte++) {
    const g = glyphFor(winAnsiToUnicode(byte));
    has.push(g !== 0); widths.push(g === 0 ? 0 : scale(advance(g)));
  }

  // The PostScript name (name ID 6), Windows or Macintosh.
  let postScriptName = '';
  const strings = name + u16(name + 4);
  for (let i = 0; i < u16(name + 2) && !postScriptName; i++) {
    const at = name + 6 + i * 12;
    if (u16(at + 6) !== 6) continue;
    const bytes = font.subarray(strings + u16(at + 10), strings + u16(at + 10) + u16(at + 8));
    postScriptName = u16(at) === 3 ? Array.from({ length: bytes.length / 2 }, (_, k) => String.fromCharCode(bytes.readUInt16BE(k * 2))).join('') : bytes.toString('latin1');
  }
  const version = u16(os2);
  return {
    postScriptName: (postScriptName || 'EmbeddedFont').replace(/[^A-Za-z0-9-]/g, ''),
    widths, has,
    ascent: scale(i16(hhea + 4)), descent: scale(i16(hhea + 6)),
    capHeight: version >= 2 ? scale(i16(os2 + 88)) : scale(i16(hhea + 4)),
    bbox: [scale(i16(head + 36)), scale(i16(head + 38)), scale(i16(head + 40)), scale(i16(head + 42))],
    italicAngle: i16(post + 4),
    weight: u16(os2 + 4),
  };
}
