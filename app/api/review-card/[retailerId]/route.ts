import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { PILOT_TENANT_SLUG } from '@/lib/pilot';
import { verifyReviewCardSignature } from '@/lib/review-link';
import { loadShopCard, cardsPdfFor } from '@/lib/review-card-data';
import { cardFileName } from '@/lib/review-card-pdf';

/**
 * One shop's review card as a print-ready A6 PDF (lib/review-card-pdf.ts).
 *
 * Same signed address as the card page (/review-card/<shop id>?k=<signature>),
 * so a rep can pass it on and the shop needs no sign-in. It shows the shop's
 * name, town and public Google review link, and nothing else. Reads only.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { retailerId: string } }) {
  const notFound = () => new NextResponse('Not found', { status: 404 });
  let ok = false;
  try { ok = verifyReviewCardSignature(params.retailerId, new URL(request.url).searchParams.get('k')); } catch { ok = false; }
  if (!ok) return notFound();
  try {
    const card = await loadShopCard(supabaseAdmin, params.retailerId);
    if (!card) return notFound();
    const pdf = cardsPdfFor(getTenantBySlug(PILOT_TENANT_SLUG), [card], `Review card: ${card.name}`);
    return new NextResponse(new Uint8Array(pdf), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cardFileName(card.name)}"`,
      'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
    } });
  } catch (e: any) {
    console.error('[review-card pdf]', String(e?.message).slice(0, 200));
    return new NextResponse('Could not make the card just now. Please try again.', { status: 500 });
  }
}
