import { describe, it, expect } from 'vitest';
import { sniffImage, cleanImage, remainingMetadata, exifOrientation, orientationOnlyExif, ImageError } from './image-metadata';
import { makeJpeg, makePng, exifSegment, seg, contains, GPS_MARKER, DEVICE_MARKER } from './image-test-fixtures';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

describe('sniffImage: the type comes from the bytes, not the name', () => {
  it('recognises JPEG and PNG', () => {
    expect(sniffImage(makeJpeg())).toBe('jpeg');
    expect(sniffImage(makePng())).toBe('png');
  });
  it.each([
    ['GIF', 'GIF89a......'],
    ['WebP', 'RIFF\x10\x00\x00\x00WEBPVP8 '],
    ['HEIC', '\x00\x00\x00\x18ftypheic'],
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['HTML', '<!doctype html><script>alert(1)</script>'],
    ['PDF', '%PDF-1.7'],
    ['a Windows program', 'MZ\x90\x00\x03'],
    ['nothing', ''],
  ])('refuses %s', (_name, content) => {
    expect(sniffImage(bytes(content))).toBeNull();
    expect(() => cleanImage(bytes(content))).toThrow(ImageError);
  });
});

describe('cleanImage: JPEG', () => {
  it('removes EXIF, and with it the GPS position and the device', () => {
    const dirty = makeJpeg({ orientation: 1 });
    expect(contains(dirty, GPS_MARKER)).toBe(true);
    expect(contains(dirty, DEVICE_MARKER)).toBe(true);

    const clean = cleanImage(dirty);
    expect(contains(clean.bytes, GPS_MARKER)).toBe(false);
    expect(contains(clean.bytes, DEVICE_MARKER)).toBe(false);
    expect(contains(clean.bytes, 'Exif')).toBe(false); // orientation 1 is the default, so no EXIF at all is written back
    expect(clean.removed).toContain('EXIF');
    expect(remainingMetadata(clean.bytes)).toEqual([]);
  });

  it('keeps which way up the photo is, and nothing else from EXIF', () => {
    const clean = cleanImage(makeJpeg({ orientation: 6 }));
    expect(contains(clean.bytes, GPS_MARKER)).toBe(false);
    expect(contains(clean.bytes, DEVICE_MARKER)).toBe(false);
    // Exactly one EXIF block: the 36-byte one holding only the orientation.
    const exifAt = Buffer.from(clean.bytes).indexOf(Buffer.from(orientationOnlyExif(6)));
    expect(exifAt).toBeGreaterThan(0);
    expect(Buffer.from(clean.bytes).indexOf(Buffer.from('Exif'), exifAt + 36)).toBe(-1);
    expect(exifOrientation(clean.bytes.subarray(exifAt, exifAt + 36))).toBe(6);
    expect(remainingMetadata(clean.bytes)).toEqual([]);
  });

  it('removes XMP, IPTC, comments and multi-picture data', () => {
    const dirty = makeJpeg({ xmp: true, iptc: true, comment: true, mpf: true });
    const clean = cleanImage(dirty);
    for (const leak of ['Leeds LS1', 'Acacia Avenue', 'Smith house', 'xmpmeta', 'Photoshop', 'MPF']) expect(contains(clean.bytes, leak)).toBe(false);
    expect(clean.removed).toEqual(expect.arrayContaining(['XMP', 'IPTC', 'comment', 'MPF']));
    expect(remainingMetadata(clean.bytes)).toEqual([]);
  });

  it('cuts off anything after the end of the image, where phones hide a video', () => {
    const clean = cleanImage(makeJpeg({ trailing: Array.from(bytes('ftypmp4 MotionPhoto_Data')) }));
    expect(contains(clean.bytes, 'MotionPhoto')).toBe(false);
    expect(Array.from(clean.bytes.slice(-2))).toEqual([0xff, 0xd9]);
    expect(clean.removed).toContain('data after the end of the image');
  });

  it('removes a comment hidden between scans', () => {
    const clean = cleanImage(makeJpeg({ midScanComment: true }));
    expect(contains(clean.bytes, 'mid-scan note')).toBe(false);
    expect(Array.from(clean.bytes.slice(-2))).toEqual([0xff, 0xd9]);
  });

  it('keeps the picture: tables, frame, scan data, JFIF header and colour profile, byte for byte', () => {
    const plain = makeJpeg({ icc: true });
    const clean = cleanImage(plain);
    expect(Array.from(clean.bytes)).toEqual(Array.from(plain)); // nothing to remove, so nothing changes
    expect(clean.removed).toEqual([]);

    const dirty = makeJpeg({ icc: true, orientation: 1, xmp: true, iptc: true, comment: true });
    expect(Array.from(cleanImage(dirty).bytes)).toEqual(Array.from(plain)); // and a dirty copy cleans to the same file
  });

  it('reads the size', () => {
    const clean = cleanImage(makeJpeg({ width: 2048, height: 1536 }));
    expect([clean.width, clean.height, clean.contentType, clean.extension]).toEqual([2048, 1536, 'image/jpeg', 'jpg']);
  });

  it('refuses a JPEG that is cut short or has no image in it', () => {
    expect(() => cleanImage(makeJpeg({ truncated: true }))).toThrow(/cut short/);
    expect(() => cleanImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(ImageError);
    expect(() => cleanImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow(ImageError);
  });
});

describe('cleanImage: only what a decoder needs is kept', () => {
  /** A JPEG with one extra segment spliced in before the image tables. */
  const withSegment = (marker: number, payload: string) => {
    const base = Array.from(makeJpeg());
    const extra = seg(marker, Array.from(Buffer.from(payload, 'latin1')));
    return new Uint8Array([...base.slice(0, 2), ...extra, ...base.slice(2)]);
  };
  it.each([
    ['a reserved marker', 0x02], ['another reserved marker', 0xbf], ['a JPEG extension marker', 0xf0], ['a hierarchical marker', 0xde],
  ])('refuses a JPEG carrying %s, which could hide anything', (_name, marker) => {
    const sneaky = withSegment(marker, 'HIDDEN-PAYLOAD customer address 12 Acacia Avenue');
    expect(() => cleanImage(sneaky)).toThrow(/do not recognise/);
    expect(remainingMetadata(sneaky).join(' ')).toMatch(/unrecognised segment/);
  });
  it('the second check reads the whole file, including what sits between scans', () => {
    const dirty = makeJpeg({ midScanComment: true });
    expect(remainingMetadata(dirty)).toContain('comment');
    expect(remainingMetadata(cleanImage(dirty).bytes)).toEqual([]);
  });
  it('refuses a PNG that has a header and an end but no picture in it', () => {
    const png = Array.from(makePng());
    const text = Buffer.from(png).indexOf(Buffer.from('IDAT')) - 4;
    const idatLen = (png[text] << 24) | (png[text + 1] << 16) | (png[text + 2] << 8) | png[text + 3];
    const hollow = new Uint8Array([...png.slice(0, text), ...png.slice(text + 12 + idatLen)]);
    expect(() => cleanImage(hollow)).toThrow(/no image data/);
  });
});

describe('exifOrientation', () => {
  it('reads little-endian EXIF as phones write it', () => {
    expect(exifOrientation(new Uint8Array(exifSegment(8)))).toBe(8);
  });
  it('returns null for junk rather than throwing', () => {
    expect(exifOrientation(new Uint8Array([0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0]))).toBeNull();
    const broken = new Uint8Array(exifSegment(6)); broken[14] = 0xff; broken[15] = 0xff; broken[16] = 0xff; // directory offset far outside the block
    expect(exifOrientation(broken)).toBeNull();
    expect(exifOrientation(new Uint8Array(exifSegment(9)))).toBeNull(); // not a real orientation
  });
});

describe('cleanImage: PNG', () => {
  it('removes text, EXIF and timestamps, and keeps the image', () => {
    const dirty = makePng({ text: true, exif: true, time: true });
    expect(contains(dirty, GPS_MARKER)).toBe(true);
    const clean = cleanImage(dirty);
    for (const leak of [GPS_MARKER, 'Acacia Avenue', 'adobe', 'tEXt', 'iTXt', 'eXIf', 'tIME']) expect(contains(clean.bytes, leak)).toBe(false);
    expect(clean.removed).toEqual(['tEXt', 'iTXt', 'eXIf', 'tIME']);
    expect(Array.from(clean.bytes)).toEqual(Array.from(makePng()));
    expect([clean.width, clean.height, clean.contentType]).toEqual([1200, 900, 'image/png']);
    expect(remainingMetadata(clean.bytes)).toEqual([]);
  });
  it('cuts off anything after the end chunk', () => {
    const clean = cleanImage(makePng({ trailing: Array.from(bytes('<script>hidden</script>')) }));
    expect(contains(clean.bytes, 'hidden')).toBe(false);
  });
  it('refuses a PNG that is cut short', () => {
    expect(() => cleanImage(makePng({ truncated: true }))).toThrow(/cut short/);
    expect(() => cleanImage(makePng().slice(0, 20))).toThrow(ImageError);
  });
});

describe('remainingMetadata: the independent second check', () => {
  it('names what a dirty file carries', () => {
    expect(remainingMetadata(makeJpeg({ orientation: 6, xmp: true, comment: true }))).toEqual(['EXIF', 'XMP', 'comment']);
    expect(remainingMetadata(makePng({ exif: true }))).toEqual(['eXIf']);
    expect(remainingMetadata(bytes('GIF89a'))).toEqual(['unknown file type']);
  });
  it('does not accept a full EXIF block just because it is EXIF', () => {
    expect(remainingMetadata(makeJpeg({ orientation: 1 }))).toEqual(['EXIF']);
  });
});
