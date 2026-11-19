import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decidePostAction, publishTimeAfterApproval } from './post-actions';

const NOW = new Date('2026-11-20T12:00:00Z');
const post = (status: string) => ({ id: 'p1', status, content: 'Old wording that is long enough to be a real post for the shop.', scheduled_for: '2026-11-23T10:00:00Z' });
const good = 'New flooring ranges are in the showroom this week. Pop in and have a look.';

describe('approve, skip, edit and cancel from the dashboard', () => {
  it('approve lets a waiting post through', () => {
    const d = decidePostAction(post('awaiting_approval'), 'approve', undefined, NOW);
    expect(d).toMatchObject({ ok: true, fromStatus: 'awaiting_approval', patch: { status: 'pending_approval', approved_at: NOW.toISOString() } });
  });

  it('skip and cancel stop a post, waiting or booked', () => {
    expect(decidePostAction(post('awaiting_approval'), 'skip', undefined, NOW)).toMatchObject({ ok: true, patch: { status: 'cancelled' } });
    expect(decidePostAction(post('pending_approval'), 'cancel', undefined, NOW)).toMatchObject({ ok: true, fromStatus: 'pending_approval', patch: { status: 'cancelled' } });
  });

  it('edit saves new wording and leaves it waiting; "save and approve" does both', () => {
    expect(decidePostAction(post('awaiting_approval'), 'edit', good, NOW)).toMatchObject({ ok: true, patch: { content: good } });
    expect((decidePostAction(post('awaiting_approval'), 'edit', good, NOW) as any).patch.status).toBeUndefined();
    expect(decidePostAction(post('awaiting_approval'), 'approve', good, NOW)).toMatchObject({ ok: true, patch: { content: good, status: 'pending_approval' } });
  });

  it('edited wording is held to the same rules as written wording', () => {
    for (const bad of ['short', 'Carpets from £9 a metre this week, pop in and see us in the showroom.', 'Ring 07700 900123 for a quote on carpets and vinyl this week.', 'See www.shop.invalid for our new carpet and vinyl ranges this week.']) {
      expect(decidePostAction(post('awaiting_approval'), 'edit', bad, NOW).ok).toBe(false);
    }
  });

  it('pressing twice, or after it has gone up, changes nothing and says so', () => {
    expect(decidePostAction(post('pending_approval'), 'approve', undefined, NOW)).toMatchObject({ ok: false, status: 409, message: 'This post is already approved.' });
    expect(decidePostAction(post('published'), 'skip', undefined, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(decidePostAction(post('published'), 'edit', good, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(decidePostAction(post('cancelled'), 'approve', undefined, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(decidePostAction(null, 'approve', undefined, NOW)).toMatchObject({ ok: false, status: 404 });
  });

  it('a post approved after its slot goes up shortly, not at a time already past', () => {
    expect(publishTimeAfterApproval('2026-11-23T10:00:00Z', NOW)).toBeNull();
    const late = publishTimeAfterApproval('2026-11-17T10:00:00Z', NOW)!;
    expect(Date.parse(late)).toBeGreaterThan(NOW.getTime());
  });
});

describe('wiring', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  it('the route only ever touches the signed-in shop\'s own post, in the state it was seen in', () => {
    const r = src('../app/api/posts/manage/route.ts');
    expect(r).toMatch(/getSessionUserId/);
    expect(r).toMatch(/\.eq\('profile_id', profile\.id\)/);
    expect(r).toMatch(/\.eq\('status', d\.fromStatus\)/);
    expect(r).not.toMatch(/createLocalPost|loggedCreatePost/); // it never publishes
  });
  it('the weekly writer does not add a post while one is waiting', () => {
    expect(src('../app/api/cron/post-generator/route.ts')).toMatch(/\.eq\('status', 'awaiting_approval'\)[\s\S]{0,200}hasPost\.add/);
  });
  it('the preview email is still off by default', () => {
    expect(src('./safe-automation.ts')).toMatch(/EARLY_POST_PREVIEW_EMAILS \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'on'/);
  });
});

describe('the shortest path to connected', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  it('a free-brand shop goes from Google straight to "you\'re connected"', () => {
    const cb = src('../app/api/auth/callback/google/route.ts');
    expect(cb).toMatch(/tenant\.priceMonthlyGbp === 0 \? '\/connected'/);
    expect(cb).toMatch(/onboarding_step: 'complete'/);
  });
  it('the connected page asks for nothing: no mobile number, no required step', () => {
    const page = src('../app/connected/page.tsx');
    expect(page).not.toMatch(/type="tel"|required/);
    expect(page).toMatch(/Nothing has been changed on your Google listing/);
    expect(page).toMatch(/Done for now/);
  });
  it('a free brand is never sent through the mobile-number step', () => {
    expect(src('../app/onboarding/page.tsx')).toMatch(/const afterVoice: Phase = freeTenant \? 'improve' : 'phone'/);
  });
  it('a mobile number can be removed', () => {
    expect(src('../app/api/account/delete/route.ts')).toMatch(/updates\.phone_number = null/);
  });
  it('links can be made for any number of shops, in requests of 25, and nothing sends them', () => {
    const page = src('../app/admin/pilot/page.tsx');
    expect(page).toMatch(/const CHUNK = 25/);
    expect(page).toMatch(/Generate links for all/);
    const api = src('../app/api/admin/pilot/route.ts');
    expect(api).not.toMatch(/sendEmail|sendSMS/);
  });
  it('the free brand\'s dashboard shows no pound estimate, no invented checklist and no referral offer', () => {
    const d = src('../app/dashboard/page.tsx');
    expect(d).toMatch(/estCalls>0&&tenant\.priceMonthlyGbp>0/);
    expect(d).toMatch(/d\.plan&&tenant\.priceMonthlyGbp>0/);
    expect(d).toMatch(/tenant\.priceMonthlyGbp>0&&<ReferralBlock/);
  });
});
