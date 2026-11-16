/**
 * Check an uploaded photo is really a JPEG or PNG, and remove its metadata.
 *
 * WHY. A photo straight off a phone carries EXIF: usually the GPS position it
 * was taken at (a customer's home, for a flooring job), the time, the phone
 * model, sometimes a thumbnail of the uncropped original. None of that may be
 * stored or passed to Google. So before a photo is stored, everything that is
 * not the picture itself is removed.
 *
 * HOW. No image is decoded and no pixels are touched: the file's container is
 * walked and rebuilt from an ALLOWLIST of the parts needed to display it.
 * Anything not on the list is dropped, which means unknown or future metadata
 * formats are removed by default rather than kept by default.
 *
 *   JPEG keeps: the image tables and scans, the JFIF header, an ICC colour
 *               profile, the Adobe colour marker.
 *        drops: EXIF (GPS, time, device, thumbnail), XMP, IPTC, comments, every
 *               other application segment, and anything after the end-of-image
 *               marker (phones hide a short video there for "motion photos").
 *        One thing is carried over from EXIF: the orientation (which way up the
 *        photo is), rewritten into a fresh EXIF block containing that single
 *        number and nothing else. Without it, portrait photos turn sideways.
 *
 *   PNG  keeps: header, palette, image data, transparency, colour chunks.
 *        drops: text chunks, EXIF, timestamps, everything else, and anything
 *               after the end chunk.
 *
 * The type is decided from the file's first bytes, never from its name or the
 * Content-Type the browser sent. Pure functions, no dependencies.
 */

export type ImageKind = 'jpeg' | 'png';

export interface CleanImage {
  kind: ImageKind;
  contentType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  bytes: Uint8Array;
  width: number;
  height: number;
  /** What was removed, for the log and the tests. Names only, never contents. */
  removed: string[];
}

export class ImageError extends Error {}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG or PNG by magic bytes; anything else (GIF, WebP, HEIC, SVG, PDF, HTML) is null. */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return 'png';
  return null;
}

function startsWith(seg: Uint8Array, offset: number, ascii: string): boolean {
  if (seg.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) if (seg[offset + i] !== ascii.charCodeAt(i)) return false;
  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ── JPEG ────────────────────────────────────────────────────────────────────

/**
 * Orientation (1 to 8) from an EXIF APP1 segment, or null. `seg` is the whole
 * segment including its marker and length. Every read is bounds-checked: a
 * malformed block yields null, never an exception.
 */
export function exifOrientation(seg: Uint8Array): number | null {
  const t = 10; // FF E1, length (2), "Exif\0\0" (6): the TIFF header starts here
  if (!startsWith(seg, 4, 'Exif') || seg.length < t + 8) return null;
  const little = seg[t] === 0x49 && seg[t + 1] === 0x49;
  const big = seg[t] === 0x4d && seg[t + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (o: number) => (o + 2 > seg.length ? -1 : little ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1]);
  const u32 = (o: number) => (o + 4 > seg.length ? -1 : little
    ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24)) >>> 0
    : ((seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0);
  if (u16(t + 2) !== 0x002a) return null;
  const ifd = u32(t + 4);
  if (ifd < 8) return null;
  const count = u16(t + ifd);
  if (count < 0 || count > 512) return null;
  for (let i = 0; i < count; i++) {
    const e = t + ifd + 2 + i * 12;
    if (e + 12 > seg.length) return null;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A complete EXIF APP1 segment holding the orientation and nothing else. */
export function orientationOnlyExif(orientation: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22,                         // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,             // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, first directory at 8
    0x00, 0x01,                                     // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00, // Orientation, SHORT, 1 value
    0x00, 0x00, 0x00, 0x00,                         // no further directory
  ]);
}

const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const isApp = (m: number) => m >= 0xe0 && m <= 0xef;
/**
 * The segments a decoder needs before the first scan: frame headers (C0 to CF,
 * which includes the Huffman and arithmetic tables at C4 and CC), quantisation
 * tables (DB) and the restart interval (DD). Nothing else.
 */
const isImageSegment = (m: number) => (m >= 0xc0 && m <= 0xcf) || m === 0xdb || m === 0xdd;
/** The segments that may sit between scans: the above, the next scan header (DA) and the line count (DC). */
const isScanSegment = (m: number) => isImageSegment(m) || m === 0xda || m === 0xdc;
const COM = 0xfe;

function appName(m: number, seg: Uint8Array): string {
  if (m === 0xe1) return startsWith(seg, 4, 'Exif') ? 'EXIF' : startsWith(seg, 4, 'http://ns.adobe.com/x') ? 'XMP' : 'APP1';
  if (m === 0xed) return 'IPTC';
  if (m === 0xe2 && startsWith(seg, 4, 'MPF')) return 'MPF';
  if (m === 0xe0) return 'JFXX';
  return `APP${m - 0xe0}`;
}

/** Is this application segment one of the three a decoder actually needs? */
function keepApp(m: number, seg: Uint8Array): boolean {
  if (m === 0xe0) return startsWith(seg, 4, 'JFIF');
  if (m === 0xe2) return startsWith(seg, 4, 'ICC_PROFILE');
  if (m === 0xee) return startsWith(seg, 4, 'Adobe');
  return false;
}

function cleanJpeg(b: Uint8Array): CleanImage {
  const n = b.length;
  const kept: Uint8Array[] = [];
  const removed: string[] = [];
  let orientation: number | null = null;
  let width = 0, height = 0;
  let pos = 2;
  let sawSos = false;

  // Headers, up to the first scan.
  while (pos < n) {
    if (b[pos] !== 0xff) throw new ImageError('not a valid JPEG');
    while (pos + 1 < n && b[pos + 1] === 0xff) pos++; // fill bytes
    if (pos + 1 >= n) break;
    const m = b[pos + 1];
    if (m === 0xd9) throw new ImageError('JPEG has no image data');
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { pos += 2; continue; }
    if (pos + 4 > n) throw new ImageError('JPEG is cut short');
    const len = (b[pos + 2] << 8) | b[pos + 3];
    if (len < 2 || pos + 2 + len > n) throw new ImageError('JPEG is cut short');
    const seg = b.subarray(pos, pos + 2 + len);
    if (m === 0xda) { sawSos = true; break; }

    if (isApp(m)) {
      if (m === 0xe1 && orientation === null) orientation = exifOrientation(seg);
      if (keepApp(m, seg)) kept.push(seg); else removed.push(appName(m, seg));
    } else if (m === COM) {
      removed.push('comment');
    } else if (isImageSegment(m)) {
      if (isSof(m) && len >= 7) { height = (seg[5] << 8) | seg[6]; width = (seg[7] << 8) | seg[8]; }
      kept.push(seg);
    } else {
      // Not something a decoder needs, and not a kind of metadata we know how
      // to drop. Reserved and extension markers can each carry 64 KB of
      // anything, so the file is refused rather than passed through.
      throw new ImageError('JPEG contains data we do not recognise');
    }
    pos += 2 + len;
  }
  if (!sawSos) throw new ImageError('JPEG has no image data');
  if (!width || !height) throw new ImageError('JPEG has no size information');

  // Scans. Copy through to the end-of-image marker, cutting out any application
  // or comment segment that sits between scans, and stopping dead at the marker
  // so nothing appended after the picture survives.
  const scan: Uint8Array[] = [];
  let chunkStart = pos;
  let i = pos + 2 + ((b[pos + 2] << 8) | b[pos + 3]);
  let end = -1;
  while (i + 1 < n) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9) { end = i + 2; break; }
    if (i + 4 > n) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > n) break;
    if (isApp(m) || m === COM) {
      scan.push(b.subarray(chunkStart, i));
      chunkStart = i + 2 + len;
      removed.push(m === COM ? 'comment' : appName(m, b.subarray(i, i + 2 + len)));
    } else if (!isScanSegment(m)) {
      throw new ImageError('JPEG contains data we do not recognise');
    }
    i += 2 + len;
  }
  if (end < 0) throw new ImageError('JPEG is cut short');
  scan.push(b.subarray(chunkStart, end));
  if (end < n) removed.push('data after the end of the image');

  // Rebuild: start marker, the JFIF header if there was one, the orientation on
  // its own, then everything kept, in its original order.
  const out: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  const jfifFirst = kept.length > 0 && kept[0][1] === 0xe0;
  if (jfifFirst) out.push(kept[0]);
  if (orientation !== null && orientation !== 1) out.push(orientationOnlyExif(orientation));
  out.push(...(jfifFirst ? kept.slice(1) : kept), ...scan);

  return { kind: 'jpeg', contentType: 'image/jpeg', extension: 'jpg', bytes: concat(out), width, height, removed };
}

// ── PNG ─────────────────────────────────────────────────────────────────────

/** Chunks needed to draw the image correctly. Everything else is dropped. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs']);

function cleanPng(b: Uint8Array): CleanImage {
  const n = b.length;
  const out: Uint8Array[] = [b.subarray(0, 8)];
  const removed: string[] = [];
  let width = 0, height = 0;
  let pos = 8;
  let ended = false;
  let sawData = false;
  let first = true;
  while (pos + 12 <= n) {
    const len = ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0;
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const total = 12 + len;
    if (len > n || pos + total > n) throw new ImageError('PNG is cut short');
    if (first) {
      if (type !== 'IHDR' || len < 8) throw new ImageError('not a valid PNG');
      width = ((b[pos + 8] << 24) | (b[pos + 9] << 16) | (b[pos + 10] << 8) | b[pos + 11]) >>> 0;
      height = ((b[pos + 12] << 24) | (b[pos + 13] << 16) | (b[pos + 14] << 8) | b[pos + 15]) >>> 0;
      first = false;
    }
    if (PNG_KEEP.has(type)) out.push(b.subarray(pos, pos + total)); else removed.push(type);
    if (type === 'IDAT' && len > 0) sawData = true;
    pos += total;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!ended) throw new ImageError('PNG is cut short');
  if (!sawData) throw new ImageError('PNG has no image data');
  if (!width || !height) throw new ImageError('PNG has no size information');
  if (pos < n) removed.push('data after the end of the image');
  return { kind: 'png', contentType: 'image/png', extension: 'png', bytes: concat(out), width, height, removed };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Identify the file and return a copy with all metadata removed. Throws
 * ImageError for anything that is not a complete JPEG or PNG.
 */
export function cleanImage(input: Uint8Array): CleanImage {
  const kind = sniffImage(input);
  if (kind === 'jpeg') return cleanJpeg(input);
  if (kind === 'png') return cleanPng(input);
  throw new ImageError('not a JPEG or PNG');
}

/**
 * What metadata a JPEG or PNG still carries, by name. An empty list means
 * clean. Used after cleaning as a second, independent check before storing:
 * cleanImage builds the file, this reads it back.
 */
export function remainingMetadata(input: Uint8Array): string[] {
  const kind = sniffImage(input);
  const found: string[] = [];
  if (kind === 'jpeg') {
    // Walk every marker in the file, headers and scans alike, and name
    // anything that is not on the allowlist. Written separately from
    // cleanJpeg on purpose: it reads the result rather than trusting the builder.
    let i = 2;
    let inScan = false;
    while (i + 1 < input.length) {
      if (input[i] !== 0xff) { if (!inScan) { found.push('unreadable structure'); break; } i++; continue; }
      const m = input[i + 1];
      if (m === 0xff) { i++; continue; }
      if (inScan && (m === 0x00 || (m >= 0xd0 && m <= 0xd7))) { i += 2; continue; }
      if (m === 0xd9) { if (i + 2 < input.length) found.push('data after the end of the image'); break; }
      if (i + 4 > input.length) { found.push('unreadable structure'); break; }
      const len = (input[i + 2] << 8) | input[i + 3];
      const seg = input.subarray(i, i + 2 + len);
      if (m === COM) found.push('comment');
      else if (isApp(m)) {
        // The one EXIF block allowed is the 36-byte orientation-only one.
        const orientationOnly = m === 0xe1 && seg.length === 36 && orientationOnlyExif(seg[29]).every((v, k) => seg[k] === v);
        if (!keepApp(m, seg) && !orientationOnly) found.push(appName(m, seg));
      } else if (m === 0xda) inScan = true;
      else if (!(inScan ? isScanSegment(m) : isImageSegment(m))) found.push(`unrecognised segment 0x${m.toString(16)}`);
      i += 2 + len;
    }
  } else if (kind === 'png') {
    let pos = 8;
    while (pos + 12 <= input.length) {
      const len = ((input[pos] << 24) | (input[pos + 1] << 16) | (input[pos + 2] << 8) | input[pos + 3]) >>> 0;
      const type = String.fromCharCode(input[pos + 4], input[pos + 5], input[pos + 6], input[pos + 7]);
      if (!PNG_KEEP.has(type)) found.push(type);
      pos += 12 + len;
      if (type === 'IEND') break;
    }
    if (pos < input.length) found.push('data after the end of the image');
  } else {
    found.push('unknown file type');
  }
  return found;
}
