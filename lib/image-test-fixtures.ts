/**
 * Hand-built JPEG and PNG files for tests. Structurally real (every segment and
 * chunk is laid out as the formats require) so the cleaner in
 * lib/image-metadata.ts is exercised on genuine container structure. The pixel
 * data is filler: nothing in the app decodes it.
 */
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

export const seg = (marker: number, payload: number[]) => [0xff, marker, ...u16be(payload.length + 2), ...payload];

/** The marker text hidden in the test EXIF, so a test can assert it is gone. */
export const GPS_MARKER = 'GPS-53.8008N-1.5491W';
export const DEVICE_MARKER = 'iPhone 15 Pro';

/**
 * A little-endian EXIF block as a phone writes it: orientation, the device
 * model, and a pointer to a GPS directory holding a position.
 */
export function exifSegment(orientation: number): number[] {
  const model = [...ascii(DEVICE_MARKER), 0];
  const gps = [...ascii(GPS_MARKER), 0];
  const ifd0At = 8;
  const entries = 3;
  const modelAt = ifd0At + 2 + entries * 12 + 4;
  const gpsIfdAt = modelAt + model.length;
  const gpsDataAt = gpsIfdAt + 2 + 12 + 4;
  const tiff = [
    0x49, 0x49, ...u16le(0x002a), ...u32le(ifd0At),
    ...u16le(entries),
    ...u16le(0x0110), ...u16le(2), ...u32le(model.length), ...u32le(modelAt),        // Model
    ...u16le(0x0112), ...u16le(3), ...u32le(1), ...u16le(orientation), 0, 0,          // Orientation
    ...u16le(0x8825), ...u16le(4), ...u32le(1), ...u32le(gpsIfdAt),                   // GPS directory pointer
    ...u32le(0),
    ...model,
    ...u16le(1),
    ...u16le(0x0002), ...u16le(2), ...u32le(gps.length), ...u32le(gpsDataAt),         // "latitude", as text for the test
    ...u32le(0),
    ...gps,
  ];
  return seg(0xe1, [...ascii('Exif'), 0, 0, ...tiff]);
}

export interface JpegOptions {
  width?: number; height?: number;
  /** EXIF orientation to embed with GPS and device data; omit for no EXIF. */
  orientation?: number;
  xmp?: boolean; iptc?: boolean; comment?: boolean; icc?: boolean; jfif?: boolean; mpf?: boolean;
  /** Bytes appended after the end-of-image marker, as a "motion photo" does. */
  trailing?: number[];
  /** Pad the scan data so the file reaches at least this many bytes. */
  minBytes?: number;
  /** Leave off the end-of-image marker. */
  truncated?: boolean;
  /** Put a comment segment between two scans (progressive files can). */
  midScanComment?: boolean;
}

export function makeJpeg(o: JpegOptions = {}): Uint8Array {
  const { width = 1200, height = 900 } = o;
  const head: number[] = [0xff, 0xd8];
  if (o.jfif !== false) head.push(...seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (o.orientation) head.push(...exifSegment(o.orientation));
  if (o.xmp) head.push(...seg(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta>Leeds LS1</x:xmpmeta>')]));
  if (o.icc) head.push(...seg(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9, 9, 9]));
  if (o.mpf) head.push(...seg(0xe2, [...ascii('MPF'), 0, 1, 2, 3, 4]));
  if (o.iptc) head.push(...seg(0xed, [...ascii('Photoshop 3.0'), 0, ...ascii('8BIM caption: 12 Acacia Avenue')]));
  if (o.comment) head.push(...seg(0xfe, ascii('shot at the Smith house')));
  head.push(...seg(0xdb, [0, ...new Array(64).fill(1)]));                                   // quantisation table
  head.push(...seg(0xc0, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]));           // start of frame
  head.push(...seg(0xc4, [0, ...new Array(16).fill(0)]));                                   // huffman table
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  // Scan data, including the two things a scanner must not mistake for a marker:
  // a stuffed FF 00, and a restart marker.
  const scan = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];
  const between = o.midScanComment ? [...seg(0xfe, ascii('mid-scan note')), ...sos, 0x11, 0x22] : [];
  const fixed = head.length + sos.length + scan.length + between.length + 2;
  const pad = new Array(Math.max(0, (o.minBytes || 0) - fixed)).fill(0x55);
  return new Uint8Array([...head, ...sos, ...scan, ...pad, ...between, ...(o.truncated ? [] : [0xff, 0xd9]), ...(o.trailing || [])]);
}

const chunk = (type: string, data: number[]) => [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];

export interface PngOptions { width?: number; height?: number; text?: boolean; exif?: boolean; time?: boolean; trailing?: number[]; minBytes?: number; truncated?: boolean }

export function makePng(o: PngOptions = {}): Uint8Array {
  const { width = 1200, height = 900 } = o;
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  out.push(...chunk('IHDR', [...u32be(width), ...u32be(height), 8, 2, 0, 0, 0]));
  if (o.text) out.push(...chunk('tEXt', ascii('Comment\0taken at 12 Acacia Avenue')), ...chunk('iTXt', ascii('XML:com.adobe.xmp\0\0\0\0\0<x/>')));
  if (o.exif) out.push(...chunk('eXIf', ascii(GPS_MARKER)));
  if (o.time) out.push(...chunk('tIME', [7, 234, 11, 16, 9, 0, 0]));
  out.push(...chunk('sRGB', [0]));
  const idat = [1, 2, 3, 4, 5];
  const pad = new Array(Math.max(0, (o.minBytes || 0) - out.length - idat.length - 24)).fill(0x55);
  out.push(...chunk('IDAT', [...idat, ...pad]));
  if (!o.truncated) out.push(...chunk('IEND', []));
  return new Uint8Array([...out, ...(o.trailing || [])]);
}

export const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));
