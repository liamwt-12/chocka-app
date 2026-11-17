import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantBySlug } from '@/lib/tenant';
import { MANAGER_EMBED, resolveAccess } from '@/lib/managed-access';
import { ADMIN_LABELS, SHOP_MESSAGES, type ConnectionStatus } from '@/lib/ownership';
import { shopPhotosEnabled } from '@/lib/shop-photos';
import { googleReviewLink, reviewPlaceId, reviewCardPath } from '@/lib/review-link';
import { parseVoiceProfile, readStoredVoice, isEmptyVoice } from '@/lib/voice';
import { resetConnection } from '@/lib/connection-reset';
import { shopStatus, liveRulesFromEnv } from '@/lib/shop-status';
import { parseSpendPounds, adDatesProblem } from '@/lib/ad-spend';
import { loadStatement, statementCsv, billingSettingsFromEnv } from '@/lib/billing';
import { describeChange, undoChange } from '@/lib/revert';
import { settingChecks, schemaChecks, dataChecks, summary } from '@/lib/readiness';
import { retentionEnabled, retentionCsv } from '@/lib/retention';
import { loadRetention } from '@/lib/retention-data';
import { describeMode, handsOffEnabled } from '@/lib/automation-mode';
import { emailPreview, EMAIL_PREVIEWS } from '@/lib/email-previews';
import { loadBulkCards, cardsPdfFor } from '@/lib/review-card-data';
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
 * POST { action: 'readiness' }                           is everything in place to invite shops? (settings present, migrations applied)
 * POST { action: 'set_ad_spend', retailerId, spend, endDate? } optional ad spend in pounds, beside the ad start date
 * POST { action: 'set_excluded', retailerId, excluded }  leave a test or internal shop out of the monthly count
 * POST { action: 'statement', month }                    live shops for a month, by name, with cap and credit
 * POST { action: 'changes', retailerId }                 what we have changed on a shop's listing
 * POST { action: 'undo_change', retailerId, changeId }   put one change back
 * POST { action: 'confirm_listing', retailerId }         a person confirms a "check listing" shop connected the right listing
 * POST { action: 'mark_bounced', retailerId, bounced }   the invitation bounced or went to the wrong person (we never see this ourselves)
 * POST { action: 'set_note', retailerId, note }          a short note from whoever is helping
 * POST { action: 'review_cards', includeUnchecked? }      every connected shop's review card as one print-ready A6 PDF
 * POST { action: 'preview_email', key? }                  read an email that is switched off, with made-up content; sends nothing
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

      case 'retention': {
        // Which shops are drifting. Off unless RETENTION_VIEW=on. Reads only; no contact details.
        if (!retentionEnabled()) return NextResponse.json({ enabled: false });
        const r = await loadRetention(supabaseAdmin, tenantRow.id);
        return NextResponse.json({ enabled: true, ...r, csv: retentionCsv(r.rows) });
      }

      case 'review_cards': {
        // Every connected shop's review card in one print-ready A6 file, one
        // card per page, in name order. Names, towns and public Google review
        // links only: no customer data and no contact details. Nothing is sent.
        const bulk = await loadBulkCards(supabaseAdmin, tenantRow.id, { includeUnchecked: body.includeUnchecked === true });
        if (!bulk.cards.length) return NextResponse.json({ cards: 0, leftOut: bulk.leftOut, pdfBase64: null });
        const pdf = cardsPdfFor(getTenantBySlug(PILOT_TENANT_SLUG), bulk.cards, 'Review cards');
        return NextResponse.json({ cards: bulk.cards.length, unchecked: bulk.cards.filter((c) => c.source === 'baseline').length, leftOut: bulk.leftOut, fileName: `review-cards-${new Date().toISOString().slice(0, 10)}.pdf`, pdfBase64: pdf.toString('base64') });
      }

      case 'preview_email': {
        // Read an email that is switched off, with made-up content, before
        // deciding to switch it on. Returns HTML; sends nothing.
        if (!body.key) return NextResponse.json({ previews: EMAIL_PREVIEWS });
        const preview = emailPreview(String(body.key), getTenantBySlug(PILOT_TENANT_SLUG));
        if (!preview) return NextResponse.json({ error: 'No such email' }, { status: 404 });
        return NextResponse.json(preview);
      }

      case 'readiness': {
        // Is everything in place to invite shops? Presence of settings only, never a value.
        const checks = { settings: settingChecks(), database: await schemaChecks(supabaseAdmin), shops: await dataChecks(supabaseAdmin, tenantRow.id) };
        return NextResponse.json({ checks, ...summary([...checks.settings, ...checks.database, ...checks.shops]) });
      }

      case 'set_ad_spend': {
        // What has been spent on ads for this shop, and when they stopped.
        // Seen by admin and Tarkett only: never in anything sent to the shop.
        const spend = parseSpendPounds(body.spend);
        if (spend === undefined) return NextResponse.json({ error: 'Use an amount in pounds like 250 or 250.50, or leave it empty to clear' }, { status: 400 });
        const end = body.endDate === undefined ? undefined : parseAdStartDate(body.endDate);
        if (body.endDate !== undefined && end === undefined) return NextResponse.json({ error: 'Use a date like 2026-12-07, or leave it empty to clear' }, { status: 400 });
        const { data: cur } = await supabaseAdmin.from('retailers').select('id, ad_start_date, ad_end_date').eq('id', body.retailerId).eq('tenant_id', tenantRow.id).maybeSingle();
        if (!cur) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        const problem = adDatesProblem(cur.ad_start_date, end === undefined ? cur.ad_end_date : end);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
        const patch: Record<string, unknown> = { ad_spend_pence: spend };
        if (end !== undefined) patch.ad_end_date = end;
        const { error } = await supabaseAdmin.from('retailers').update(patch).eq('id', cur.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ updated: { id: cur.id, adSpendPence: spend, adEndDate: end === undefined ? cur.ad_end_date : end } });
      }

      case 'set_excluded': {
        // A test or internal shop that must never be in the monthly count.
        const { data, error } = await supabaseAdmin.from('retailers').update({ exclude_from_count: body.excluded === true })
          .eq('id', body.retailerId).eq('tenant_id', tenantRow.id).select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        return NextResponse.json({ excluded: body.excluded === true });
      }

      case 'statement': {
        // The count of live shops for one month, by name (lib/billing.ts).
        // A statement to check, not an invoice: nothing is charged or sent.
        const month = typeof body.month === 'string' ? body.month : '';
        if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Use a month like 2026-12' }, { status: 400 });
        const statement = await loadStatement(supabaseAdmin, tenantRow.id, month, billingSettingsFromEnv());
        return NextResponse.json({ statement, csv: statementCsv(statement) });
      }

      case 'changes': {
        // Everything we have changed on one shop's listing, newest first, with whether each can be undone.
        const owned = await profileForRetailer(body.retailerId, tenantRow.id);
        if (!owned) return NextResponse.json({ changes: [], note: 'This shop has no connected listing.' });
        const { data, error } = await supabaseAdmin.from('change_log').select('*').eq('profile_id', owned.profileId).order('created_at', { ascending: false }).limit(60);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ changes: (data || []).map((r: any) => describeChange(r)) });
      }

      case 'undo_change': {
        // Put one change back (lib/revert.ts). Only for a change that belongs to this shop.
        const owned = await profileForRetailer(body.retailerId, tenantRow.id);
        if (!owned) return NextResponse.json({ error: 'This shop has no connected listing.' }, { status: 400 });
        const { data: row } = await supabaseAdmin.from('change_log').select('id, profile_id').eq('id', body.changeId).maybeSingle();
        if (!row || row.profile_id !== owned.profileId) return NextResponse.json({ error: 'That change does not belong to this shop.' }, { status: 404 });
        const result = await undoChange(supabaseAdmin, row.id, { confirm: true, allowLaterEdits: body.evenIfChangedSince === true });
        console.log(`[admin/pilot] undo of change ${row.id}: ${result.ok ? 'done' : `not done (${result.detail || result.message})`}`);
        return NextResponse.json({ undo: result });
      }

      case 'confirm_listing': {
        // A person has looked at a "check listing" shop and says the listing
        // it connected is the right one. From then on it counts as matched.
        const { data, error } = await supabaseAdmin.from('retailers')
          .update({ listing_confirmed_at: body.confirmed === false ? null : new Date().toISOString() })
          .eq('id', body.retailerId).eq('tenant_id', tenantRow.id).select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        return NextResponse.json({ confirmed: body.confirmed !== false });
      }

      case 'mark_bounced': {
        // We never send the invitation, so we never see a bounce. Whoever sent
        // it does, and records it here.
        const { data, error } = await supabaseAdmin.from('retailers')
          .update({ invite_bounced_at: body.bounced === false ? null : new Date().toISOString() })
          .eq('id', body.retailerId).eq('tenant_id', tenantRow.id).select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        return NextResponse.json({ bounced: body.bounced !== false });
      }

      case 'set_note': {
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
        const { data, error } = await supabaseAdmin.from('retailers')
          .update({ support_note: note || null })
          .eq('id', body.retailerId).eq('tenant_id', tenantRow.id).select('id');
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        return NextResponse.json({ note: note || null });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[admin/pilot]', err);
    return NextResponse.json({ error: String(err?.message || 'Failed').slice(0, 300) }, { status: 500 });
  }
}

/** The listing profile connected to a shop of this tenant, if there is one. */
async function profileForRetailer(retailerId: unknown, tenantId: string): Promise<{ profileId: string } | null> {
  if (typeof retailerId !== 'string') return null;
  const { data: r } = await supabaseAdmin.from('retailers').select('user_id').eq('id', retailerId).eq('tenant_id', tenantId).maybeSingle();
  if (!r?.user_id) return null;
  const { data: p } = await supabaseAdmin.from('profiles').select('id').eq('user_id', r.user_id).maybeSingle();
  return p?.id ? { profileId: p.id } : null;
}

/** The card address, or '' if it cannot be signed (the secret is missing). The rest of the list still loads. */
function safeCardPath(retailerId: string): string {
  try { return reviewCardPath(retailerId); } catch { return ''; }
}
/** The same shop's card as a print-ready PDF: the same signed address, under /api. */
function safeCardPdfPath(retailerId: string): string {
  const p = safeCardPath(retailerId);
  return p ? `/api${p}` : '';
}

async function list(tenantId: string) {
  const { data: retailers, error } = await supabaseAdmin
    .from('retailers')
    .select('id, source, source_ref, name, town, contact_email, user_id, place_id, score, band, delisted_at, created_at, ad_start_date, ad_end_date, ad_spend_pence, first_live_on, exclude_from_count, connection_status, connection_detail, connection_checked_at, connect_issue, connect_issue_at, invite_bounced_at, support_note, listing_confirmed_at, voice_profile, voice_updated_at, voice_updated_by')
    .eq('tenant_id', tenantId)
    .order('name');
  if (error) throw error;
  const rows = retailers || [];

  const ids = rows.map((r: any) => r.id);
  const userIds = rows.map((r: any) => r.user_id).filter(Boolean);

  const { data: invites } = ids.length
    ? await supabaseAdmin.from('retailer_invites').select('id, retailer_id, status, expires_at, created_at, accepted_at, opened_at').in('retailer_id', ids)
    : { data: [] as any[] };

  // Tokens are read only to decide whether access works, and never leave this function.
  const { data: users } = userIds.length
    ? await supabaseAdmin
        .from('users')
        .select(`id, created_at, onboarding_step, auto_post_enabled, auto_reply_enabled, automation_mode, automation_consent_at, automation_consent_version, automation_paused_at, google_refresh_token, token_status, token_invalid_at, managed_by_user_id, ${MANAGER_EMBED}, profiles ( google_location_name, google_place_id )`)
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
  const rules = liveRulesFromEnv();
  const out = rows.map((r: any) => {
    const user = r.user_id ? userById.get(r.user_id) ?? null : null;
    const shopInvites = (invites || []).filter((i: any) => i.retailer_id === r.id) as PilotInvite[];
    const status = pilotStatus(r, user, shopInvites, now, rules);
    // The finer status, with what to do about it: lib/shop-status.ts.
    const help = shopStatus(r, user, shopInvites, now, rules);
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
      adEndDate: r.ad_end_date ?? null,
      adSpendPence: r.ad_spend_pence ?? null,
      firstLiveOn: r.first_live_on ?? null,
      excludedFromCount: !!r.exclude_from_count,
      voice: readStoredVoice(r.voice_profile),
      voiceUpdatedAt: r.voice_updated_at ?? null,
      voiceUpdatedBy: r.voice_updated_by ?? null,
      photos: photoCounts.get(r.id) ?? null,
      review: reviewLink && place ? { link: reviewLink, cardPath: safeCardPath(r.id), pdfPath: safeCardPdfPath(r.id), source: place.source } : null,
      connection: r.connection_status ? { status: r.connection_status, label: ADMIN_LABELS[r.connection_status as ConnectionStatus] ?? r.connection_status, detail: r.connection_detail, checkedAt: r.connection_checked_at, nextStep: SHOP_MESSAGES[r.connection_status as ConnectionStatus]?.nextStep ?? null } : null,
      state: status.state,
      detail: status.detail,
      help: { key: help.key, label: help.label, live: help.live, needsHelp: help.needsHelp, severity: help.severity, why: help.why, action: help.action, since: help.since, buttons: help.buttons },
      note: r.support_note ?? null,
      listingConfirmed: !!r.listing_confirmed_at,
      connectedListing: user?.profiles?.[0]?.google_location_name ? { placeId: user?.profiles?.[0]?.google_place_id ?? null } : null,
      joinedAt: user?.created_at ?? null,
      accessVia: user ? (resolveAccess(user).via ?? null) : null,
      // Hands-off or ask me first, as in force (lib/automation-mode.ts), and what is switched on.
      working: user ? { ...describeMode(user as any), postsOn: !!(user as any).auto_post_enabled, repliesOn: !!(user as any).auto_reply_enabled } : null,
    };
  });

  const counts = out.reduce((acc: Record<string, number>, r: any) => { acc[r.state] = (acc[r.state] || 0) + 1; return acc; }, {});
  const needsHelp = out.filter((r: any) => r.help.needsHelp).length;
  return { retailers: out, counts, needsHelp, liveRules: rules, photosEnabled, handsOffEnabled: handsOffEnabled() };
}
