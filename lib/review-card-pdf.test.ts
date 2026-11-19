import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inflateSync } from 'zlib';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { reviewCardsPdf, cardContent, cardFonts, qrRuns, toWinAnsi, textWidth, wrap, fit, cardFileName, TRIM, BLEED_MM } from './review-card-pdf';
import { LATO_REGULAR, LATO_BOLD } from './fonts/lato-data';
import { readTrueType } from './fonts/truetype';
import { loadBulkCards, loadShopCard, cardStyle, cardsPdfFor } from './review-card-data';
import { reviewCardSignature } from './review-link';
import { getTenantBySlug } from './tenant';

const PLACE = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const OTHER = 'ChIJrTLr-GyuEmsRBfy61i59si0';
const LINK = `https://search.google.com/local/writereview?placeid=${PLACE}`;
const STYLE = cardStyle(getTenantBySlug('stellar'));
const MM = 72 / 25.4;

/** Split a PDF into its numbered objects, and check the table at the end points at each one. */
function parse(pdf: Buffer) {
  const text = pdf.toString('latin1');
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');
  const entries = text.slice(startxref).split('\n').filter((l) => /^\d{10} \d{5} n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length), `object ${i + 1}`).toBe(`${i + 1} 0 obj`));
  const pages = Array.from(text.matchAll(/\/Type \/Page \/Parent 2 0 R ([^\n]*)/g)).map((m) => m[1]);
  const streams: string[] = [];
  for (const m of Array.from(text.matchAll(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g))) {
    const start = m.index! + m[0].length;
    streams.push(inflateSync(pdf.subarray(start, start + Number(m[1]))).toString('latin1'));
  }
  return { text, pages, streams, objects: entries.length };
}

describe('the file is a well-formed PDF', () => {
  const pdf = reviewCardsPdf([{ name: 'Bare Carpets', town: 'Leeds', link: LINK }, { name: 'Oak & Ash Flooring', town: null, link: LINK }], STYLE);
  const doc = parse(pdf);

  it('starts and ends as a PDF, and every object is where the index says it is', () => {
    expect(doc.text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(doc.text.endsWith('%%EOF\n')).toBe(true);
    expect(doc.objects).toBe(9 + 2 * 2);
  });
  it('has one page per card', () => {
    expect(doc.pages).toHaveLength(2);
    expect(doc.text).toMatch(/\/Type \/Pages \/Count 2 /);
    expect(doc.streams).toHaveLength(2);
  });
  it('is the same bytes for the same input', () => {
    expect(reviewCardsPdf([{ name: 'Bare Carpets', town: 'Leeds', link: LINK }, { name: 'Oak & Ash Flooring', town: null, link: LINK }], STYLE).equals(pdf)).toBe(true);
  });
  it('refuses to make an empty file', () => {
    expect(() => reviewCardsPdf([], STYLE)).toThrow(/no cards/);
  });
});

describe('print-ready: A6 with bleed', () => {
  const doc = parse(reviewCardsPdf([{ name: 'Bare Carpets', town: 'Leeds', link: LINK }], STYLE));
  const box = (name: string) => /\[([\d. ]+)\]/.exec(doc.pages[0].split(`/${name} `)[1])![1].split(' ').map(Number);

  it('trims to exactly A6: 105 by 148 millimetres', () => {
    expect(TRIM.width / MM).toBeCloseTo(105, 5);
    expect(TRIM.height / MM).toBeCloseTo(148, 5);
    const [x0, y0, x1, y1] = box('TrimBox');
    expect((x1 - x0) / MM).toBeCloseTo(105, 1);
    expect((y1 - y0) / MM).toBeCloseTo(148, 1);
  });
  it('has 3 mm of bleed on every side, and says where it ends', () => {
    expect(BLEED_MM).toBe(3);
    const media = box('MediaBox'), bleed = box('BleedBox'), trim = box('TrimBox');
    expect(bleed).toEqual(media);
    expect(trim[0] / MM).toBeCloseTo(3, 1);
    expect(trim[1] / MM).toBeCloseTo(3, 1);
    expect((media[2] - trim[2]) / MM).toBeCloseTo(3, 1);
    expect((media[3] - trim[3]) / MM).toBeCloseTo(3, 1);
  });
  it('paints the background and the band right out to the edge of the bleed', () => {
    const [, , w, h] = box('MediaBox');
    const rects = Array.from(doc.streams[0].matchAll(/^([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f$/gm)).map((m) => m.slice(1).map(Number));
    expect(rects[0]).toEqual([0, 0, w, h]);                       // paper
    expect(rects[1][0]).toBe(0); expect(rects[1][2]).toBe(w);     // band, full width
    expect(rects[1][1] + rects[1][3]).toBeCloseTo(h, 1);          // and up to the top edge
  });
  it('embeds Lato Regular and Bold in full, so a printer needs nothing installed; and contains no picture', () => {
    expect(doc.text).toMatch(/\/Subtype \/TrueType \/BaseFont \/Lato-Regular \/FirstChar 32 \/LastChar 255 \/Widths \[[\d ]+\] \/FontDescriptor 6 0 R \/Encoding \/WinAnsiEncoding/);
    expect(doc.text).toMatch(/\/Subtype \/TrueType \/BaseFont \/Lato-Bold /);
    expect(doc.text).toMatch(/\/FontName \/Lato-Regular \/Flags 32 [^>]*\/FontFile2 7 0 R/);
    expect(doc.text).toMatch(/\/FontName \/Lato-Bold \/Flags 32 [^>]*\/FontFile2 9 0 R/);
    expect(doc.text).not.toMatch(/Helvetica|\/Subtype \/Type1|\/Subtype \/Image|\/XObject/);
    // The font in the file is the published one, byte for byte: it unpacks to the recorded length and checksum.
    for (const [packed, name] of [[LATO_REGULAR, 'Lato-Regular'], [LATO_BOLD, 'Lato-Bold']] as const) {
      const raw = inflateSync(Buffer.from(packed.deflatedBase64.join(''), 'base64'));
      expect(raw.length).toBe(packed.length);
      expect(createHash('sha256').update(raw).digest('hex')).toBe(packed.sha256);
      expect(doc.text).toContain(`/Length1 ${packed.length} /Filter /FlateDecode`);
      expect(readTrueType(raw).postScriptName).toBe(name);
    }
  });
  it('measures text with the font\'s own widths', () => {
    const m = cardFonts().regular.metrics;
    expect(m.widths).toHaveLength(224);
    expect(m.widths['i'.charCodeAt(0) - 32]).toBeLessThan(m.widths['m'.charCodeAt(0) - 32]);
    expect(m.widths['é'.charCodeAt(0) - 32]).toBe(m.widths['e'.charCodeAt(0) - 32]);
    expect(textWidth('mm', 10, false)).toBeCloseTo((2 * m.widths['m'.charCodeAt(0) - 32]) / 100, 5);
    expect(textWidth('Thank you', 14, true)).toBeGreaterThan(textWidth('Thank you', 14, false));
    expect(m.ascent).toBeGreaterThan(m.capHeight);
    expect(m.descent).toBeLessThan(0);
  });
  it('the licence travels with the font', () => {
    const ofl = readFileSync(new URL('./fonts/Lato-OFL.txt', import.meta.url), 'utf8');
    expect(ofl).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(ofl).toMatch(/Reserved Font Name "Lato"/);
  });
  it('keeps every line of text at least 6 mm inside the trim', () => {
    const [x0, , x1] = box('TrimBox');
    for (const name of ['Bare Carpets', 'The Very Long Named Flooring and Carpet Warehouse Company of North Yorkshire Limited', 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW']) {
      const content = cardContent({ name, town: 'A Town With Quite A Long Name Indeed, Yorkshire', link: LINK }, STYLE);
      for (const m of Array.from(content.matchAll(/BT \/(F1|F2) ([\d.]+) Tf ([\d.]+) Tc ([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj ET/g))) {
        const textStr = m[6].replace(/\\(.)/g, '$1');
        const left = Number(m[4]), right = left + textWidth(textStr, Number(m[2]), m[1] === 'F2', Number(m[3]));
        expect(left, textStr).toBeGreaterThanOrEqual(x0 + 6 * MM - 0.6);
        expect(right, textStr).toBeLessThanOrEqual(x1 - 6 * MM + 0.6);
      }
    }
  });
});

describe('the code on the card is the shop\'s Google review link, and nothing else', () => {
  it('draws exactly the dark squares of a QR code for the link', () => {
    const qr = QRCode.create(LINK, { errorCorrectionLevel: 'Q' });
    const dark = Array.from(qr.modules.data).filter(Boolean).length;
    const runs = qrRuns(LINK);
    expect(runs.size).toBe(qr.modules.size);
    expect(runs.dark).toBe(dark);
    // Rebuild the grid from the runs and compare square for square.
    const grid = new Uint8Array(runs.size * runs.size);
    for (const r of runs.runs) for (let i = 0; i < r.length; i++) grid[r.row * runs.size + r.col + i] = 1;
    expect(Array.from(grid)).toEqual(Array.from(qr.modules.data).map((v) => (v ? 1 : 0)));
  });
  it('draws those squares on the page, inside a white square with a quiet margin, in pure black', () => {
    const content = cardContent({ name: 'Bare Carpets', town: 'Leeds', link: LINK }, STYLE);
    const runs = qrRuns(LINK);
    const afterWhite = content.split('1 1 1 rg\n').pop()!;      // the last white fill is the QR's square
    const black = afterWhite.split('0 0 0 rg\n')[1].split('\nf\n')[0];
    const squares = black.split('\n').filter((l) => / re$/.test(l));
    expect(squares).toHaveLength(runs.runs.length);
    const module = (56 * MM) / (runs.size + 8);
    const area = squares.reduce((t, l) => { const [, , w, h] = l.split(' ').map(Number); return t + w * h; }, 0);
    expect(area / (module * module)).toBeGreaterThan(runs.dark * 0.99);
    expect(area / (module * module)).toBeLessThan(runs.dark * 1.06);
  });
  it('will not make a code for anything but a Google review link', () => {
    for (const bad of ['https://evil.example/x', 'javascript:alert(1)', '', 'https://search.google.com/other']) {
      expect(() => qrRuns(bad)).toThrow(/not a Google review link/);
      expect(() => reviewCardsPdf([{ name: 'X', link: bad }], STYLE)).toThrow(/not a Google review link/);
    }
  });
  it('carries no customer data, contact detail or tracking: the page is the name, the town and fixed words', () => {
    const content = cardContent({ name: 'Bare Carpets', town: 'Leeds', link: LINK }, STYLE);
    const words = Array.from(content.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)).map((m) => m[1].replace(/\\(.)/g, '$1'));
    expect(words).toEqual(['Bare Carpets', 'Leeds', 'Happy with our work?', 'A Google review helps other people find us.', "Point your phone's camera at the square and tap the link.", 'Thank you', 'STELLAR LOCAL']);
    expect(content).not.toMatch(/@|https?:|utm_|placeid/);
  });
});

describe('names of every kind', () => {
  it('keeps accents and typographic marks the typeface has', () => {
    expect(toWinAnsi('Café Münster’s “Floors” – Leeds')).toBe('Café Münster\u0092s \u0093Floors\u0094 \u0096 Leeds');
  });
  it('drops an accent the typeface lacks, and turns anything else into a question mark, never a broken file', () => {
    expect(toWinAnsi('Łódź Flooring')).toBe('Lódz Flooring');
    expect(toWinAnsi('地板 Floors 🙂')).toBe('?? Floors ?');
    expect(toWinAnsi('Tab\tand\nnewline')).toBe('Tab and newline');
    const doc = parse(reviewCardsPdf([{ name: '地板 (Floors) \\ 🙂', town: 'Łódź', link: LINK }], STYLE));
    expect(doc.streams[0]).toContain('(?? \\(Floors\\) \\\\ ?) Tj');
  });
  it('shrinks a long name to fit two lines, and cuts one that still does not fit', () => {
    const inner = TRIM.width - 12 * MM;
    expect(fit('Bare Carpets', [24, 12], true, inner, 2)).toEqual({ size: 24, lines: ['Bare Carpets'] });
    const long = fit('The Very Long Named Flooring and Carpet Warehouse Company of North Yorkshire Limited', [24, 22, 20, 18, 16, 14, 12], true, inner, 2);
    expect(long.size).toBeLessThanOrEqual(14);
    expect(long.lines).toHaveLength(2);
    for (const l of long.lines) expect(textWidth(l, long.size, true)).toBeLessThanOrEqual(inner);
    const longer = fit('The Very Long Named Flooring and Carpet Warehouse Company of North Yorkshire and the Whole of the East Riding Limited', [24, 22, 20, 18, 16, 14, 12], true, inner, 2);
    expect(longer.size).toBe(12);
    expect(longer.lines).toHaveLength(2);
    expect(longer.lines[1].endsWith('...')).toBe(true);
    for (const l of longer.lines) expect(textWidth(l, 12, true)).toBeLessThanOrEqual(inner);
    expect(wrap('one two three', 10, false, 1000)).toEqual(['one two three']);
  });
  it('nothing runs off the card: one very long word is cut, a long town is drawn at the size it fits, and "..." appears only where something was dropped', () => {
    const inner = TRIM.width - 12 * MM;
    const word = fit('W'.repeat(74), [24, 12], true, inner, 2);
    for (const l of word.lines) expect(textWidth(l, word.size, true)).toBeLessThanOrEqual(inner);
    expect(word.lines[0].endsWith('...')).toBe(true);
    // Fits on two lines only at the smallest size: nothing dropped, so no dots.
    expect(fit('Aaaaaaaaaaaaaaaaaa Bbbbbbbbbbbbbbbbbbb Ltd', [40, 12], true, inner, 2).lines.join(' ')).toBe('Aaaaaaaaaaaaaaaaaa Bbbbbbbbbbbbbbbbbbb Ltd');
    const town = 'Kirkby-in-Ashfield near Sutton-in-Ashfield, North Nottinghamshire';
    const content = cardContent({ name: 'Shop', town, link: LINK }, STYLE);
    const m = /\/F1 ([\d.]+) Tf [\d.]+ Tc [\d.]+ [\d.]+ Td \((Kirkby[^)]*)\) Tj/.exec(content)!;
    expect(Number(m[1])).toBeLessThan(11);                                   // drawn at the size that fits, not always at 11
    expect(textWidth(m[2], Number(m[1]), false)).toBeLessThanOrEqual(inner);
  });
  it('the code is refused for a link with anything after the place ID', () => {
    expect(() => qrRuns(`${LINK}&x=1 evil`)).toThrow(/not a Google review link/);
    expect(() => qrRuns('https://search.google.com/local/writereview?placeid=short')).toThrow(/not a Google review link/);
  });
  it('an empty name still makes a card', () => {
    expect(parse(reviewCardsPdf([{ name: '  ', town: '', link: LINK }], STYLE)).streams[0]).toContain('(Our shop) Tj');
  });
  it('makes a safe file name', () => {
    expect(cardFileName('Café Münster’s Floors & Co.')).toBe('review-card-cafe-munster-s-floors-co.pdf');
    expect(cardFileName('../../etc/passwd')).toBe('review-card-etc-passwd.pdf');
    expect(cardFileName('')).toBe('review-card-shop.pdf');
  });
});

describe('Stellar styling', () => {
  it('uses the tenant\'s own colours and wordmark', () => {
    const t = getTenantBySlug('stellar');
    expect(STYLE).toEqual({ colours: { ink: t.palette.charcoal, paper: t.palette.cream, accent: t.palette.gold, soft: t.palette.text }, wordmark: 'STELLAR LOCAL' });
    const content = cardContent({ name: 'Bare Carpets', town: 'Leeds', link: LINK }, STYLE);
    expect(content).toContain('0.72 0.57 0.24 rg'); // the gold
    expect(content).toContain('0.09 0.09 0.09 rg'); // the ink
  });
});

// ── Which shops get a card ──
function db(retailers: any[], profiles: any[]) {
  const table = (name: string) => {
    const rows = name === 'retailers' ? retailers : profiles;
    let out = rows.slice();
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => { out = out.filter((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { out = out.filter((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { out = out.filter((r) => v.includes(r[c])); return q; },
      order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: out[0] ?? null, error: null }),
      then: (res: any) => res({ data: out, error: null }),
    };
    return q;
  };
  return { from: table };
}
const SHOPS = [
  { id: 'r1', tenant_id: 't', name: 'Alpha Floors', town: 'Leeds', place_id: OTHER, user_id: 'u1', delisted_at: null },
  { id: 'r2', tenant_id: 't', name: 'Beta Carpets', town: 'York', place_id: OTHER, user_id: null, delisted_at: null },
  { id: 'r3', tenant_id: 't', name: 'Gamma Flooring', town: null, place_id: null, user_id: null, delisted_at: null },
  { id: 'r4', tenant_id: 't', name: 'Delisted', town: null, place_id: OTHER, user_id: null, delisted_at: '2026-10-01' },
  { id: 'r5', tenant_id: 'other', name: 'Another network', town: null, place_id: OTHER, user_id: null, delisted_at: null },
];
const PROFILES = [{ user_id: 'u1', google_place_id: PLACE }];

describe('the bulk file', () => {
  it('by default holds only shops that have connected, using the listing they chose', async () => {
    const b = await loadBulkCards(db(SHOPS, PROFILES), 't');
    expect(b.cards).toEqual([{ retailerId: 'r1', name: 'Alpha Floors', town: 'Leeds', link: LINK, source: 'connected' }]);
    expect(b.leftOut).toEqual({ noListing: ['Gamma Flooring'], notConnected: ['Beta Carpets'], unconfirmed: [] });
  });
  it('can include shops not yet connected, marked as unchecked, and never a delisted shop or another network\'s', async () => {
    const b = await loadBulkCards(db(SHOPS, PROFILES), 't', { includeUnchecked: true });
    expect(b.cards.map((c) => [c.name, c.source])).toEqual([['Alpha Floors', 'connected'], ['Beta Carpets', 'baseline']]);
    expect(JSON.stringify(b)).not.toMatch(/Delisted|Another network/);
  });
  it('a shop on a listing nobody has confirmed is left out too, and is never counted as checked', async () => {
    const shops = [...SHOPS, { id: 'r6', tenant_id: 't', name: 'Wrong Listing Floors', town: null, place_id: OTHER, user_id: 'u6', delisted_at: null, connection_status: 'check_listing', listing_confirmed_at: null },
      { id: 'r7', tenant_id: 't', name: 'Confirmed Floors', town: null, place_id: OTHER, user_id: 'u7', delisted_at: null, connection_status: 'check_listing', listing_confirmed_at: '2026-11-01' }];
    const profiles = [...PROFILES, { user_id: 'u6', google_place_id: PLACE }, { user_id: 'u7', google_place_id: PLACE }];
    const b = await loadBulkCards(db(shops, profiles), 't');
    expect(b.cards.map((c) => c.name)).toEqual(['Alpha Floors', 'Confirmed Floors']);
    expect(b.leftOut.unconfirmed).toEqual(['Wrong Listing Floors']);
    const all = await loadBulkCards(db(shops, profiles), 't', { includeUnchecked: true });
    expect(all.cards.find((c) => c.name === 'Wrong Listing Floors')!.source).toBe('unconfirmed');
    expect((await loadShopCard(db(shops, profiles), 'r6'))!.source).toBe('unconfirmed');
  });
  it('reads nothing but the name, town and listing: no contact details', () => {
    const src = readFileSync(new URL('./review-card-data.ts', import.meta.url), 'utf8');
    expect(src.match(/\.select\('([^']+)'\)/g)!.join(' ')).not.toMatch(/email|phone|contact|review|comment/);
  });
  it('one shop: a card, or nothing for a shop that is gone, delisted or has no listing', async () => {
    expect(await loadShopCard(db(SHOPS, PROFILES), 'r1')).toMatchObject({ name: 'Alpha Floors', link: LINK, source: 'connected' });
    expect(await loadShopCard(db(SHOPS, PROFILES), 'r2')).toMatchObject({ source: 'baseline' });
    for (const id of ['r3', 'r4', 'nope']) expect(await loadShopCard(db(SHOPS, PROFILES), id)).toBeNull();
  });
  it('makes one page per shop', () => {
    const pdf = cardsPdfFor(getTenantBySlug('stellar'), [{ name: 'A', link: LINK }, { name: 'B', link: LINK }, { name: 'C', link: LINK }], 'Review cards');
    expect(parse(pdf).pages).toHaveLength(3);
  });
});

// ── The download address ──
const SHOP_ID = '3f2b6c1e-8a4d-4f0b-9c1a-2d5e7f809a1b';
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => db([{ id: '3f2b6c1e-8a4d-4f0b-9c1a-2d5e7f809a1b', tenant_id: 't', name: 'Alpha Floors', town: 'Leeds', place_id: 'ChIJrTLr-GyuEmsRBfy61i59si0', user_id: null, delisted_at: null }], []).from(t) } }));
import { GET } from '@/app/api/review-card/[retailerId]/route';

describe('GET /api/review-card/<shop>?k=<signature>', () => {
  beforeEach(() => { process.env.CANCEL_HASH_SECRET = 'test-secret'; });
  const get = (id: string, k?: string) => GET(new NextRequest(`http://stellar.localhost/api/review-card/${id}${k === undefined ? '' : `?k=${k}`}`), { params: { retailerId: id } });

  it('gives the PDF to someone with the signed address', async () => {
    const res = await get(SHOP_ID, reviewCardSignature(SHOP_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="review-card-alpha-floors.pdf"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = Buffer.from(await res.arrayBuffer());
    expect(parse(body).pages).toHaveLength(1);
  });
  it('is not found without the signature, with a wrong one, or for a shop that does not exist', async () => {
    expect((await get(SHOP_ID)).status).toBe(404);
    expect((await get(SHOP_ID, 'f'.repeat(32))).status).toBe(404);
    expect((await get(SHOP_ID, reviewCardSignature('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    const other = '00000000-0000-4000-8000-000000000001';
    expect((await get(other, reviewCardSignature(other))).status).toBe(404);
  });
  it('is not found, not an error, when the signing secret is missing', async () => {
    delete process.env.CANCEL_HASH_SECRET;
    expect((await get(SHOP_ID, 'a'.repeat(32))).status).toBe(404);
  });
});

describe('the admin page offers both', () => {
  it('a bulk download behind the admin password, and a PDF link per shop', () => {
    const route = readFileSync(new URL('../app/api/admin/pilot/route.ts', import.meta.url), 'utf8');
    expect(route).toMatch(/case 'review_cards': \{/);
    expect(route.indexOf("case 'review_cards'")).toBeGreaterThan(route.indexOf('verifyAdminAuth(request.headers.get'));
    expect(route).toMatch(/includeUnchecked: body\.includeUnchecked === true/);
    const page = readFileSync(new URL('../app/admin/pilot/page.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/Download all cards \(PDF\)/);
    expect(page).toMatch(/r\.review\.pdfPath/);
  });
});
