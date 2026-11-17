import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reviewAlertEmailsEnabled, planForReview, shopsToCheck, leftSinceJoining, type ReviewFacts } from './review-alerts';
import { earlyPreviewEmailsEnabled } from './safe-automation';
import { getTenantBySlug } from './tenant';
import { emailPreview, EMAIL_PREVIEWS } from './email-previews';

const base: ReviewFacts = { rating: 5, repliesOn: false, paused: false, handsOff: false, alertsOn: false, sinceJoining: true };
const plan = (f: Partial<ReviewFacts>) => planForReview({ ...base, ...f });
const route = readFileSync(new URL('../app/api/cron/review-alerts/route.ts', import.meta.url), 'utf8');

describe('review alert emails are off unless switched on', () => {
  it('only the exact word "on" turns them on', () => {
    expect(reviewAlertEmailsEnabled({})).toBe(false);
    for (const v of ['true', '1', 'yes', 'off', ' ']) expect(reviewAlertEmailsEnabled({ REVIEW_ALERT_EMAILS: v })).toBe(false);
    expect(reviewAlertEmailsEnabled({ REVIEW_ALERT_EMAILS: ' On ' })).toBe(true);
  });
  it('both "stop the silence" switches default to off', () => {
    expect(reviewAlertEmailsEnabled({})).toBe(false);
    expect(earlyPreviewEmailsEnabled()).toBe(false);
  });
});

describe('with the switch off, everything is exactly as before', () => {
  it('only shops with replies on are looked at (a paused one too, to record and not reply)', () => {
    const users = [
      { id: 'on', auto_reply_enabled: true, profiles: [{}] },
      { id: 'off', auto_reply_enabled: false, profiles: [{}] },
      { id: 'paused', auto_reply_enabled: true, automation_paused_at: '2026-12-01T00:00:00Z', profiles: [{}] },
      { id: 'no-listing', auto_reply_enabled: true, profiles: [] },
    ];
    // A paused shop with replies on is still looked at, so a review that arrives while it is
    // paused is recorded then (and not replied to) rather than answered in a burst on Resume.
    expect(shopsToCheck(users, false).map((u) => u.id)).toEqual(['on', 'paused']);
    expect(plan({ rating: 5, repliesOn: true, paused: true })).toEqual({ reply: 'none', alert: 'none' });
    expect(plan({ rating: 2, repliesOn: true, paused: true })).toEqual({ reply: 'none', alert: 'none' });
  });
  it('a good review is replied to and no new email is sent', () => {
    expect(plan({ rating: 5, repliesOn: true })).toEqual({ reply: 'ai_publish', alert: 'none' });
    expect(plan({ rating: 4, repliesOn: true })).toEqual({ reply: 'ai_publish', alert: 'none' });
  });
  it('a low review is drafted and the shop asked, as it always was', () => {
    for (const rating of [1, 2, 3]) expect(plan({ rating, repliesOn: true })).toEqual({ reply: 'holding_draft', alert: 'low_needs_input' });
  });
  it('a shop with replies off gets nothing', () => {
    expect(plan({ rating: 5 })).toEqual({ reply: 'none', alert: 'none' });
    expect(plan({ rating: 1 })).toEqual({ reply: 'none', alert: 'none' });
  });
});

describe('with the switch on, every shop hears about every new review', () => {
  const on = { alertsOn: true };
  it('every connected shop is looked at, paused and replies-off included', () => {
    const users = [
      { id: 'on', auto_reply_enabled: true, profiles: [{}] },
      { id: 'off', auto_reply_enabled: false, profiles: [{}] },
      { id: 'paused', auto_reply_enabled: true, automation_paused_at: '2026-12-01T00:00:00Z', profiles: [{}] },
      { id: 'no-listing', auto_reply_enabled: true, profiles: [] },
    ];
    expect(shopsToCheck(users, true).map((u) => u.id)).toEqual(['on', 'off', 'paused']);
  });
  it('a good review at a shop with replies on: replied, and told', () => {
    expect(plan({ ...on, rating: 5, repliesOn: true })).toEqual({ reply: 'ai_publish', alert: 'good' });
  });
  it('a good review at a shop with replies off: told, and NOTHING is replied', () => {
    expect(plan({ ...on, rating: 5 })).toEqual({ reply: 'none', alert: 'good' });
    expect(plan({ ...on, rating: 4 })).toEqual({ reply: 'none', alert: 'good' });
  });
  it('a low review at a shop with replies off: the holding reply is drafted for approval, never posted', () => {
    for (const rating of [1, 2, 3]) expect(plan({ ...on, rating })).toEqual({ reply: 'holding_draft', alert: 'low_needs_input' });
  });
  it('a paused shop is told and nothing is posted, even in hands-off with replies on', () => {
    expect(plan({ ...on, rating: 5, repliesOn: true, paused: true })).toEqual({ reply: 'none', alert: 'good' });
    expect(plan({ ...on, rating: 2, repliesOn: true, paused: true, handsOff: false })).toEqual({ reply: 'holding_draft', alert: 'low_needs_input' });
  });
  it('a review from before the shop joined is recorded quietly at a shop with replies off', () => {
    expect(plan({ ...on, rating: 5, sinceJoining: false })).toEqual({ reply: 'none', alert: 'none' });
    expect(plan({ ...on, rating: 1, sinceJoining: false })).toEqual({ reply: 'none', alert: 'none' });
  });
});

describe('what never happens, in any combination', () => {
  const all: ReviewFacts[] = [];
  for (const rating of [0, 1, 2, 3, 4, 5, NaN]) for (const repliesOn of [true, false]) for (const paused of [true, false]) for (const handsOff of [true, false]) for (const alertsOn of [true, false]) for (const sinceJoining of [true, false]) all.push({ rating, repliesOn, paused, handsOff, alertsOn, sinceJoining });

  it('AI wording is never written for a low or unreadable rating', () => {
    for (const f of all) if (!(f.rating >= 4)) expect(planForReview(f).reply).not.toBe('ai_publish');
  });
  it('nothing is ever posted for a shop with replies off, or paused', () => {
    for (const f of all) if (!f.repliesOn || f.paused) expect(['none', 'holding_draft']).toContain(planForReview(f).reply);
  });
  it('the holding reply is only posted unattended in hands-off, for a rating that really is 1 to 3, left after the permission was given', () => {
    for (const f of all) for (const sincePermission of [true, false, undefined]) {
      const p = planForReview({ ...f, sincePermission });
      if (p.reply === 'holding_publish') expect(f.handsOff && f.repliesOn && !f.paused && f.rating >= 1 && f.rating <= 3 && sincePermission === true).toBe(true);
    }
    const hands = { ...base, repliesOn: true, handsOff: true };
    expect(planForReview({ ...hands, rating: 2, sincePermission: true })).toEqual({ reply: 'holding_publish', alert: 'low_replied' });
    // A complaint from before the shop gave permission (it may have settled it by phone) is drafted, never posted.
    expect(planForReview({ ...hands, rating: 2, sincePermission: false })).toEqual({ reply: 'holding_draft', alert: 'low_needs_input' });
    // A rating that could not be read might be a five: "sorry to hear" is never posted on a guess.
    for (const rating of [0, NaN]) expect(planForReview({ ...hands, rating, sincePermission: true })).toEqual({ reply: 'holding_draft', alert: 'low_needs_input' });
  });
  it('texts are not started by the email switch', () => {
    expect(route).toMatch(/user\.sms_enabled && user\.phone_number && switchesInForce\(user\)\.replies && !isPaused\(user\)/);
  });
  it('the alert switch never changes what is posted for a review, taken on its own', () => {
    const posted = (r: string) => (r === 'ai_publish' || r === 'holding_publish' ? r : 'nothing');
    for (const f of all) expect(posted(planForReview({ ...f, alertsOn: true }).reply)).toBe(posted(planForReview({ ...f, alertsOn: false }).reply));
  });
  it('the new "good review" email is only ever sent with the switch on', () => {
    for (const f of all) if (!f.alertsOn) expect(planForReview(f).alert).not.toBe('good');
  });
});

describe('since joining', () => {
  it('is true only for a review dated on or after the day the shop connected', () => {
    expect(leftSinceJoining('2026-12-10T09:00:00Z', '2026-12-01T09:00:00Z')).toBe(true);
    expect(leftSinceJoining('2026-11-20T09:00:00Z', '2026-12-01T09:00:00Z')).toBe(false);
    expect(leftSinceJoining(undefined, '2026-12-01T09:00:00Z')).toBe(false);
    expect(leftSinceJoining('not a date', '2026-12-01T09:00:00Z')).toBe(false);
    expect(leftSinceJoining('2026-12-10T09:00:00Z', null)).toBe(false);
  });
});

describe('the job', () => {
  it('asks the one module what to do, and sends the new email only through it', () => {
    expect(route).toMatch(/shopsToCheck\(users\.map\(\(u: any\) => \(\{ \.\.\.u, auto_reply_enabled: switchesInForce\(u\)\.replies \}\)\), alertsOn\)/);
    expect(route).toMatch(/repliesOn: switchesInForce\(user\)\.replies/);
    expect(route).toMatch(/const plan = planForReview\(/);
    expect(route).toMatch(/if \(plan\.alert !== 'good'\) return;/);
    expect(route.match(/newReviewNotice\(/g)).toHaveLength(1);
  });
  it('still leaves held listings out: it takes its shops from the gate that removes them', () => {
    expect(route).toMatch(/getActiveUsersWithProfiles\(supabaseAdmin, 'review-alerts'\)/);
    expect(route).not.toMatch(/includeHeld/);
  });
});

describe('reading the switched-off emails in the admin page', () => {
  const tenant = getTenantBySlug('stellar');
  it('every listed sample renders, with a subject, and none carries a real link', () => {
    for (const p of EMAIL_PREVIEWS) {
      const e = emailPreview(p.key, tenant, new Date('2026-12-01T10:00:00Z'));
      expect(e, p.key).not.toBeNull();
      expect(e!.subject.length).toBeGreaterThan(5);
      expect(e!.text).toContain('Example Flooring');
      expect(e!.text).not.toMatch(/https?:\/\//);          // a sample carries no working link
      expect(e!.text).not.toMatch(/<[a-z!\/]/i);            // and no markup: it is plain text
    }
    expect(emailPreview('nope', tenant)).toBeNull();
  });
  it('the module cannot send: it does not import the sender', () => {
    const src = readFileSync(new URL('./email-previews.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/sendEmail|sendSMS|fetch\(/);
  });
});
