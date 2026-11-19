import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { googleReviewLink, reviewPlaceId, reviewQrSvg, verifyReviewCardSignature } from '@/lib/review-link';
import PrintButton from './PrintButton';

// A printable card for a shop's counter: the shop's name and a QR code that
// opens Google's "write a review" page for its listing (lib/review-link.ts).
// No customer data, nothing sent, nothing tracked. The address is signed, so a
// rep can pass it to the shop without the shop needing to sign in.

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review card', robots: { index: false, follow: false } };

export default async function ReviewCardPage({ params, searchParams }: { params: { retailerId: string }; searchParams: { k?: string } }) {
  if (!verifyReviewCardSignature(params.retailerId, searchParams.k)) notFound();

  const { data: shop } = await supabaseAdmin
    .from('retailers')
    .select('id, name, town, place_id, user_id, delisted_at')
    .eq('id', params.retailerId)
    .maybeSingle();
  if (!shop || shop.delisted_at) notFound();

  let connected: string | null = null;
  if (shop.user_id) {
    const { data: profiles } = await supabaseAdmin.from('profiles').select('google_place_id').eq('user_id', shop.user_id).limit(1);
    connected = profiles?.[0]?.google_place_id ?? null;
  }
  const place = reviewPlaceId({ connected, baseline: shop.place_id });
  const link = place && googleReviewLink(place.placeId);
  if (!link) notFound();
  const qr = await reviewQrSvg(link);

  return (
    <main className="review-card-page">
      <style>{`
        .review-card-page { min-height: 100vh; background: #F0EDE8; display: flex; flex-direction: column; align-items: center; padding: 24px 16px; font-family: 'DM Sans', system-ui, sans-serif; color: #1A1A1A; }
        .review-card-tools { max-width: 420px; width: 100%; margin-bottom: 16px; font-size: 13px; color: #555; }
        .review-card { width: 105mm; min-height: 148mm; box-sizing: border-box; background: #fff; border: 1px solid #ddd; border-radius: 4mm; padding: 10mm 9mm; display: flex; flex-direction: column; align-items: center; text-align: center; }
        .review-card h1 { font-size: 22pt; line-height: 1.1; margin: 0 0 2mm; overflow-wrap: anywhere; }
        .review-card .town { font-size: 11pt; color: #666; margin: 0 0 6mm; }
        .review-card .ask { font-size: 15pt; font-weight: 600; margin: 0 0 1mm; }
        .review-card .sub { font-size: 11pt; color: #444; margin: 0 0 5mm; }
        .review-card .qr { width: 62mm; height: 62mm; }
        .review-card .qr svg { width: 100%; height: 100%; display: block; }
        .review-card .how { font-size: 10pt; color: #444; margin: 5mm 0 0; }
        .review-card .thanks { font-size: 12pt; font-weight: 600; margin: auto 0 0; padding-top: 5mm; }
        @page { size: A6 portrait; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .review-card-page { background: #fff; padding: 0; min-height: 0; }
          .review-card-tools { display: none; }
          .review-card { border: none; border-radius: 0; width: 105mm; height: 148mm; }
        }
      `}</style>

      <div className="review-card-tools">
        <p style={{ margin: '0 0 10px' }}>A card for the counter. It prints at A6 (a quarter of A4). Before printing a batch, scan it with a phone and check it opens the right shop.</p>
        <PrintButton />
        <a href={`/api/review-card/${params.retailerId}?k=${encodeURIComponent(searchParams.k || '')}`} style={{ marginLeft: 12, color: '#1A1A1A', fontWeight: 600 }}>Download a print-ready PDF</a>
        <p style={{ margin: '8px 0 0' }}>The PDF is for a print shop: A6 with 3 mm of bleed.</p>
      </div>

      <div className="review-card">
        <h1>{shop.name}</h1>
        {shop.town ? <p className="town">{shop.town}</p> : <p className="town">&nbsp;</p>}
        <p className="ask">Happy with our work?</p>
        <p className="sub">A Google review helps other people find us.</p>
        <div className="qr" role="img" aria-label="QR code that opens our Google review page" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="how">Point your phone&apos;s camera at the square and tap the link.</p>
        <p className="thanks">Thank you</p>
      </div>
    </main>
  );
}
