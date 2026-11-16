import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { MANAGER_EMBED, resolveAccess } from '@/lib/managed-access';
import { ADMIN_LABELS, SHOP_MESSAGES, type ConnectionStatus } from '@/lib/ownership';
import { shopPhotosEnabled } from '@/lib/shop-photos';
import { googleReviewLink, reviewPlaceId, reviewCardPath } from '@/lib/review-link';
import { parseVoiceProfile, readStoredVoice, isEmptyVoice } from '@/lib/voice';
import { resetConnection } from '@/lib/connection-reset';
import {
  verifyAdminAuth, validateNewRetailer, pilotStatus, mintInvites, parseAdStartDate,
  PILOT_TENANT_SLUG, MANUAL_SOURCE, type PilotInvite, type PilotUser,
} from '@/lib/pilot';

/**
 * Pilot admin API, behind ADMIN_PASSWORD like /api/admin.
 *
 * POST { action: 'list' }                                  every Stellar retailer and where it is in the pilot
 * POST { action: 'add', name, town?, contactEmail? }       add a retailer (one Tarkett supplied)
 * POST { action: 'invite', retailerIds: string[] }         generate invite links; NOTHING IS SENT
 * POST { action: 'revoke', retailerId }                    revoke a retailer's pending link
 * POST { action: 'set_ad_start', retailerId, date|null }   record when Tarkett's ads for a shop started
 * POST { action: 'reset_connection', retailerId }        remove the linked account and re-open the shop's link
 * POST { action: 'set_voice', retailerId, voice }           save how a shop's posts and replies should sound (lib/voice.ts)
 *
 * There is deliberately no 'send' action. Tarkett makes first contact.
 */
export async function POST(request: NextRequest) {
  if (!process.env.ADMIN_PASSWORD) return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  if (!verifyAdminAuth(request.headers.get('authorization'), process.env.ADMIN_PASSWORD)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }

  const { data: tenantRow, error: tenantErr } = await supabaseAdmin.from('tenants').select('id').eq('slug', PILOT_TENANT_SLUG).single();
  if (tenantErr || !tenantRow) return NextResponse.json({ error: 'Stellar tenant not found' }, { status: 500 });

  try {
    switch (body?.action) {
      case 'list': return NextResponse.json(await list(tenantRow.id));

      case 'add': {
        const v = validateNewRetailer(body);
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        const { data, error } = await supabaseAdmin
          .from('retailers')
          .insert({ ...v.value, tenant_id: tenantRow.id, source: MANUAL_SOURCE })
          .select('id, name')
          .single();
        if (error) return NextResponse.json({ error: `Could not add: ${error.message}` }, { status: 500 });
        return NextResponse.json({ added: data });
      }

      case 'invite': {
        const ids = Array.isArray(body.retailerIds) ? body.retailerIds : [];
        // Only this tenant's retailers, whatever ids were posted.
        const { data: own } = await supabaseAdmin.from('retailers').select('id').eq('tenant_id', tenantRow.id).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
        const allowed = new Set((own || []).map((r: any) => r.id));
        const results = await mintInvites(supabaseAdmin, ids.filter((id: string) => allowed.has(id)), getTenantBySlug(PILOT_TENANT_SLUG).appUrl);
        for (const id of ids) if (!allowed.has(id)) results.push({ retailerId: id, ok: false, error: 'not a Stellar retailer' });
        return NextResponse.json({ results });
      }

      case 'revoke': {
        const { data: r } = await supabaseAdmin.from('retailers').select('id').eq('id', body.retailerId).eq('tenant_id', tenantRow.id).single();
        if (!r) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        const { data, error } = await supabaseAdmin
          .from('retailer_invites')
          .update({ status: 'revoked', updated_at: new Date().toISOString() })
          .eq('retailer_id', r.id)
          .eq('status', 'pending')
          .select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ revoked: (data || []).length });
      }

      case 'set_ad_start': {
        const date = parseAdStartDate(body.date);
        if (date === undefined) return NextResponse.json({ error: 'Use a date like 2026-12-07, or leave it empty to clear' }, { status: 400 });
        const { data, error } = await supabaseAdmin
          .from('retailers')
          .update({ ad_start_date: date })
          .eq('id', body.retailerId)
          .eq('tenant_id', tenantRow.id)
          .select('id, ad_start_date');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        return NextResponse.json({ updated: data[0] });
      }

      case 'set_voice': {
        // Same validation as the shop's own answers at onboarding. A rep cannot
        // enter anything a shop could not.
        const parsed = parseVoiceProfile(body.voice);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
        const { data, error } = await supabaseAdmin
          .from('retailers')
          .update({
            voice_profile: isEmptyVoice(parsed.value) ? null : parsed.value,
            voice_updated_at: new Date().toISOString(),
            voice_updated_by: 'rep',
          })
          .eq('id', body.retailerId)
          .eq('tenant_id', tenantRow.id)
          .select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        return NextResponse.json({ updated: { id: data[0].id, voice: parsed.value } });
      }

      case 'reset_connection': {
        // Frees a shop that connected with the wrong Google account (or needs
        // to start again): removes the linked account, hands the Google
        // permission back, and re-opens the shop's link. lib/connection-reset.ts.
        const { data: r } = await supabaseAdmin.from('retailers').select('id').eq('id', body.retailerId).eq('tenant_id', tenantRow.id).single();
        if (!r) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        const result = await resetConnection(supabaseAdmin, r.id);
        if (!result.ok) return NextResponse.json({ error: result.detail }, { status: 500 });
        console.log(`[admin/pilot] connection reset for shop ${r.id}: account removed=${result.removedAccount}, link reusable=${result.linkReusable}`);
        return NextResponse.json({ reset: result });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[admin/pilot]', err);
    return NextResponse.json({ error: String(err?.message || 'Failed').slice(0, 300) }, { status: 500 });
  }
}

/** The card address, or '' if it cannot be signed (the secret is missing). The rest of the list still loads. */
function safeCardPath(retailerId: string): string {
  try { return reviewCardPath(retailerId); } catch { return ''; }
}

async function list(tenantId: string) {
  const { data: retailers, error } = await supabaseAdmin
    .from('retailers')
    .select('id, source, source_ref, name, town, contact_email, user_id, place_id, score, band, delisted_at, created_at, ad_start_date, connection_status, connection_detail, connection_checked_at, voice_profile, voice_updated_at, voice_updated_by')
    .eq('tenant_id', tenantId)
    .order('name');
  if (error) throw error;
  const rows = retailers || [];

  const ids = rows.map((r: any) => r.id);
  const userIds = rows.map((r: any) => r.user_id).filter(Boolean);

  const { data: invites } = ids.length
    ? await supabaseAdmin.from('retailer_invites').select('id, retailer_id, status, expires_at, created_at, accepted_at').in('retailer_id', ids)
    : { data: [] as any[] };

  // Tokens are read only to decide whether access works, and never leave this function.
  const { data: users } = userIds.length
    ? await supabaseAdmin
        .from('users')
        .select(`id, created_at, onboarding_step, google_refresh_token, token_status, managed_by_user_id, ${MANAGER_EMBED}, profiles ( google_location_name, google_place_id )`)
        .in('id', userIds)
    : { data: [] as any[] };
  const userById = new Map<string, PilotUser>((users || []).map((u: any) => [u.id, u]));

  // Photo counts per shop, only when SHOP_PHOTOS is on. A failure here (for
  // example the table not existing yet) just means no counts, not a broken page.
  const photosEnabled = shopPhotosEnabled();
  const photoCounts = new Map<string, { pending: number; approved: number }>();
  if (photosEnabled) {
    const { data: photos } = await supabaseAdmin.from('shop_photos').select('retailer_id, status').eq('tenant_id', tenantId).in('status', ['pending', 'approved']);
    for (const p of photos || []) {
      const c = photoCounts.get(p.retailer_id) || { pending: 0, approved: 0 };
      if (p.status === 'pending') c.pending++; else c.approved++;
      photoCounts.set(p.retailer_id, c);
    }
  }

  const now = new Date();
  const out = rows.map((r: any) => {
    const user = r.user_id ? userById.get(r.user_id) ?? null : null;
    const status = pilotStatus(r, user, (invites || []).filter((i: any) => i.retailer_id === r.id) as PilotInvite[], now);
    // The shop's Google review link (lib/review-link.ts): from the listing it
    // has connected if there is one, otherwise from Tarkett's store list.
    const place = reviewPlaceId({ connected: user?.profiles?.[0]?.google_place_id, baseline: r.place_id });
    const reviewLink = place ? googleReviewLink(place.placeId) : null;
    return {
      id: r.id,
      name: r.name,
      town: r.town,
      contactEmail: r.contact_email,
      source: r.source,
      sourceRef: r.source_ref,
      score: r.score,
      band: r.band,
      delisted: !!r.delisted_at,
      adStartDate: r.ad_start_date ?? null,
      voice: readStoredVoice(r.voice_profile),
      voiceUpdatedAt: r.voice_updated_at ?? null,
      voiceUpdatedBy: r.voice_updated_by ?? null,
      photos: photoCounts.get(r.id) ?? null,
      review: reviewLink && place ? { link: reviewLink, cardPath: safeCardPath(r.id), source: place.source } : null,
      connection: r.connection_status ? { status: r.connection_status, label: ADMIN_LABELS[r.connection_status as ConnectionStatus] ?? r.connection_status, detail: r.connection_detail, checkedAt: r.connection_checked_at, nextStep: SHOP_MESSAGES[r.connection_status as ConnectionStatus]?.nextStep ?? null } : null,
      state: status.state,
      detail: status.detail,
      joinedAt: user?.created_at ?? null,
      accessVia: user ? (resolveAccess(user).via ?? null) : null,
    };
  });

  const counts = out.reduce((acc: Record<string, number>, r: any) => { acc[r.state] = (acc[r.state] || 0) + 1; return acc; }, {});
  return { retailers: out, counts, photosEnabled };
}
