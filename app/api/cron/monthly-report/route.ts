import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles } from '@/lib/cron';
import { sendEmail, monthlyReportEmail } from '@/lib/email';
import { sendSMS, logSMS } from '@/lib/twilio';
import { getTenantForRow } from '@/lib/tenant';
import { refreshAccessToken } from '@/lib/google';
import { decryptSecret, userTokenAad } from '@/lib/secrets';
import { resolveAccess } from '@/lib/managed-access';
import { livePresenceScore } from '@/lib/presence-score';
import { loadMetricRows, totalsFor, previousMonth, type MetricRow } from '@/lib/metrics';
import { compareAdPeriod, comparisonRange, adComparisonEmailSection } from '@/lib/ad-comparison';
import { startBudget, rotateForRun, runIndex } from '@/lib/cron-budget';
import { plainSummaryEnabled, whatWeDid, whatChanged, narrativeHtml } from '@/lib/report-narrative';
import { loadNarrativeFacts } from '@/lib/report-narrative-data';
import { reportMonthKey, alreadyReported, claimMonthlyReport, releaseMonthlyReport, inChunks } from '@/lib/monthly-report';

/** A month with fewer stored days than this shows no figures rather than a partial one. */
const MIN_DAYS_FOR_MONTHLY_FIGURES = 20;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();

  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin, 'monthly-report');
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // The first instant of THIS month, used as an exclusive end. It was the
    // last day of last month at midnight, used inclusively, which left out
    // everything published during that final day.
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthName = lastMonth.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    let sent = 0;

    // "Change during your ads": shops with an ad start date are compared with
    // shops that have none, over the same weeks. The comparison set and each
    // shop's stored rows are loaded once per run and reused.
    const { data: retailerRows } = await supabaseAdmin
      .from('retailers')
      .select('user_id, ad_start_date')
      .not('user_id', 'is', null);
    const adStartByUser = new Map<string, string>();
    const comparisonUserIds: string[] = [];
    for (const r of retailerRows || []) {
      if (r.ad_start_date) adStartByUser.set(r.user_id, r.ad_start_date);
      else comparisonUserIds.push(r.user_id);
    }
    const comparisonProfileIds = users
      .filter((u: any) => comparisonUserIds.includes(u.id))
      .map((u: any) => u.profiles?.[0]?.id)
      .filter(Boolean) as string[];
    const comparisonCache = new Map<string, MetricRow[][]>();
    const comparisonRowsFor = async (start: string): Promise<MetricRow[][]> => {
      if (!comparisonCache.has(start)) {
        const { from, to } = comparisonRange(start);
        // Ten at a time. All at once was one burst of a request per shop: about
        // 145 in the same instant at 180 shops.
        comparisonCache.set(start, await inChunks(comparisonProfileIds, 10, (id) => loadMetricRows(supabaseAdmin, id, from, to)));
      }
      return comparisonCache.get(start)!;
    };

    // This job now runs every five minutes through the morning of the 1st and
    // 2nd (netlify/functions/cron-monthly-report.mts). Each run sends as many
    // reports as fit in its time budget; profiles.monthly_report_sent_for
    // records who has had this month's, so the next run carries on and nobody
    // is sent two (lib/monthly-report.ts).
    const budget = startBudget();
    const monthKey = reportMonthKey(previousMonth(now).from);
    const todo = rotateForRun<any>(
      users.filter((u: any) => u.profiles?.[0] && u.email && !alreadyReported(u.profiles[0], monthKey)),
      runIndex(5), 5,
    );
    let remaining = todo.length;

    for (const user of todo) {
      if (budget.exhausted()) break;
      const profile = user.profiles?.[0];
      if (!profile || !user.email) continue;

      // Per user, not per run — one pass serves every tenant.
      const t = getTenantForRow(user);

      try {
        // Count posts published last month
        const { count: postsPublished } = await supabaseAdmin
          .from('scheduled_posts')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .eq('status', 'published')
          .gte('published_at', lastMonth.toISOString())
          .lt('published_at', thisMonthStart.toISOString());

        // Count reviews replied last month (join through reviews to scope by profile)
        const { count: reviewsReplied } = await supabaseAdmin
          .from('review_replies')
          .select('id, reviews!inner(profile_id)', { count: 'exact', head: true })
          .eq('reviews.profile_id', profile.id)
          .eq('status', 'published')
          .gte('published_at', lastMonth.toISOString())
          .lt('published_at', thisMonthStart.toISOString());

        // Last calendar month, summed day by day from daily_metrics. This used to
        // add up weekly_stats rows that each held a rolling 28-day total, which
        // overstated every figure about fourfold. If the month has too few stored
        // days to be honest about, the figures are left out rather than guessed.
        const month = previousMonth(now);
        const monthTotals = totalsFor(await loadMetricRows(supabaseAdmin, profile.id, month.from, month.to), month.from, month.to);
        const enoughDays = monthTotals.daysWithData >= MIN_DAYS_FOR_MONTHLY_FIGURES;
        const totalViews = enoughDays ? monthTotals.views : null;
        const searchViews = enoughDays ? monthTotals.searchViews : null;
        const totalCalls = enoughDays ? monthTotals.calls : null;
        const totalDirections = enoughDays ? monthTotals.directions : null;
        const totalWebsiteClicks = enoughDays ? monthTotals.websiteClicks : null;

        // "What we did" and "what changed", in words. Off unless
        // MONTHLY_REPORT_PLAIN_SUMMARY=on; a failure just leaves it out.
        let narrative = '';
        if (plainSummaryEnabled()) {
          try {
            const before = previousMonth(new Date(`${month.from}T12:00:00Z`));
            const beforeTotals = totalsFor(await loadMetricRows(supabaseAdmin, profile.id, before.from, before.to), before.from, before.to);
            const facts = await loadNarrativeFacts(supabaseAdmin, profile.id, lastMonth.toISOString(), thisMonthStart.toISOString());
            const did = whatWeDid({ postsPublished: postsPublished || 0, repliesPosted: reviewsReplied || 0, ...facts, postsOn: !!user.auto_post_enabled, repliesOn: !!user.auto_reply_enabled });
            const hasBefore = enoughDays && beforeTotals.daysWithData >= MIN_DAYS_FOR_MONTHLY_FIGURES;
            const changed = whatChanged(enoughDays ? monthTotals : null, hasBefore ? beforeTotals : null);
            narrative = narrativeHtml(did, changed, hasBefore);
          } catch (e: any) {
            console.warn(`[cron:monthly-report] plain summary skipped for user ${user.id}: ${String(e?.message).slice(0, 200)}`);
          }
        }

        let adComparisonHtml = '';
        const adStart = adStartByUser.get(user.id);
        if (adStart) {
          try {
            const { from, to } = comparisonRange(adStart);
            const comparison = compareAdPeriod(adStart, await loadMetricRows(supabaseAdmin, profile.id, from, to), await comparisonRowsFor(adStart), now);
            adComparisonHtml = adComparisonEmailSection(comparison);
          } catch (e: any) {
            console.warn(`[cron:monthly-report] ad comparison skipped for user ${user.id}: ${String(e?.message).slice(0, 200)}`);
          }
        }

        // Live presence score (one-pager item 3). Best effort: if Google cannot
        // be reached the report still goes, without the score, rather than not at
        // all. Compared only with the score at activation (profiles.audit_score),
        // never the June batch score, which is on a different scale.
        let presenceScore: number | null = null;
        let presenceBand: string | null = null;
        const access = resolveAccess(user);
        if (access.ok && profile.google_location_name) {
          try {
            const token = await refreshAccessToken(decryptSecret(access.encryptedToken, userTokenAad(access.aadUserId)));
            const result = await livePresenceScore(token, profile.google_location_name, profile.google_account_id);
            presenceScore = result.score;
            presenceBand = result.band;
          } catch (e: any) {
            console.warn(`[cron:monthly-report] presence score unavailable for user ${user.id}: ${String(e?.message).slice(0, 200)}`);
          }
        } else {
          console.warn(`[cron:monthly-report] presence score skipped for user ${user.id}: ${access.ok ? 'no location' : access.reason}`);
        }

        // Claim, then send. If the claim does not succeed (another run got
        // there first, or the marker cannot be written), no email goes.
        const claim = await claimMonthlyReport(supabaseAdmin, profile, monthKey);
        if (!claim.ok) {
          if (claim.reason === 'error') console.error(`[cron:monthly-report] could not record the report for profile ${profile.id}, so it was NOT sent: ${claim.detail}`);
          else remaining--;
          continue;
        }

        const delivered = await sendEmail({
          to: user.email,
          subject: `Your ${monthName} report — ${profile.business_name}`,
          html: monthlyReportEmail({
            businessName: profile.business_name,
            month: monthName,
            postsPublished: postsPublished || 0,
            reviewsReplied: reviewsReplied || 0,
            totalViews,
            totalCalls,
            totalDirections,
            searchViews,
            totalWebsiteClicks,
            presenceScore,
            presenceBand,
            presenceScoreAtStart: profile.audit_score ?? null,
            adComparisonHtml,
            narrativeHtml: narrative,
            tenant: t,
          }),
          tenant: t,
        });
        if (!delivered) {
          // The email was refused. Put the claim back so the next run tries again.
          const released = await releaseMonthlyReport(supabaseAdmin, profile.id, monthKey, claim.previous);
          console.error(`[cron:monthly-report] report for profile ${profile.id} was not accepted for sending; ${released ? 'it will be tried again on the next run' : 'and the marker could not be put back, so this shop misses this month'}`);
          continue;
        }
        remaining--;

        // After 4+ weeks, send one-time referral nudge
        const weeksSinceSignup = Math.floor(
          (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24 * 7)
        );

        if (weeksSinceSignup >= 4 && user.sms_enabled && user.phone_number) {
          // Check if referral nudge already sent
          const { data: nudgeSent } = await supabaseAdmin
            .from('sms_log')
            .select('id')
            .eq('user_id', user.id)
            .eq('message_type', 'referral_nudge')
            .limit(1);

          if (!nudgeSent || nudgeSent.length === 0) {
            const appUrl = t.appUrl;
            const smsBody = `Know a tradesperson who'd benefit from ${t.brandName}? Share your link and you both get a free month: ${appUrl}/ref/${user.referral_code} - ${t.brandName}`;
            const sid = await sendSMS({ to: user.phone_number, body: smsBody });
            await logSMS(supabaseAdmin, user.id, user.phone_number, 'referral_nudge', smsBody, sid);
          }
        }

        sent++;
      } catch (err) {
        console.error(`Monthly report failed for user ${user.id}:`, err);
      }
    }

    if (remaining > 0) console.log(`[cron:monthly-report] sent ${sent}, ${remaining} still to do for ${monthKey}: the next run carries on`);
    return NextResponse.json({ success: true, sent, remaining, partial: remaining > 0, month: monthKey });
  } catch (err) {
    console.error('Monthly report cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
