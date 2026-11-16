import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextBestStep, type ListingFacts } from './next-step';

const fine: ListingFacts = { hoursSet: true, hasPhone: true, descriptionLength: 400, servicesCount: 8, photos: 9, hasWebsite: true, unrepliedGood: 0, unrepliedLow: 0, waitingPosts: 0, postsOn: true, lastPostDaysAgo: 3 };
const step = (o: Partial<ListingFacts>) => nextBestStep({ ...fine, ...o });

describe('one thing, the most useful one', () => {
  it('nothing to say about a listing in good order', () => { expect(step({})).toBeNull(); });

  it('being reachable and open comes before anything cosmetic', () => {
    const bare = { hoursSet: false, hasPhone: false, descriptionLength: 0, servicesCount: 0, photos: 0, hasWebsite: false, unrepliedGood: 3, unrepliedLow: 1 };
    expect(step(bare)!.key).toBe('hours');
    expect(step({ ...bare, hoursSet: true })!.key).toBe('phone');
    expect(step({ ...bare, hoursSet: true, hasPhone: true })!.key).toBe('low_reviews');
    expect(step({ ...bare, hoursSet: true, hasPhone: true, unrepliedLow: 0 })!.key).toBe('basics');
    expect(step({ ...bare, hoursSet: true, hasPhone: true, unrepliedLow: 0, descriptionLength: 300, servicesCount: 6 })!.key).toBe('photos');
    expect(step({ unrepliedGood: 2 })!.key).toBe('good_reviews');
    expect(step({ hasWebsite: false })!.key).toBe('website');
    expect(step({ postsOn: false, lastPostDaysAgo: null })!.key).toBe('posts');
  });

  it('a post waiting for the shop comes first of all', () => {
    expect(step({ waitingPosts: 2, hoursSet: false })).toMatchObject({ key: 'approve_post', title: '2 posts are waiting for you' });
  });

  it('says plainly when only the shop can do it, and sends them to Google', () => {
    const photos = step({ photos: 0 })!;
    expect(photos.byUs).toBe(false);
    expect(photos.why).toMatch(/We do not add photos for you/);
    expect(photos.href).toBe('https://business.google.com/');
    expect(step({ hasPhone: false })!.byUs).toBe(false);
    expect(step({ hoursSet: false })).toMatchObject({ byUs: true, href: '/settings#listing' });
  });

  it('never promises a result', () => {
    const every = [{ hoursSet: false }, { hasPhone: false }, { unrepliedLow: 2 }, { descriptionLength: 0 }, { servicesCount: 0 }, { photos: 1 }, { unrepliedGood: 1 }, { hasWebsite: false }, { postsOn: false, lastPostDaysAgo: 60 }, { waitingPosts: 1 }];
    for (const o of every) {
      const s = step(o)!;
      expect(`${s.title} ${s.why}`).not.toMatch(/more calls|more customers|more enquiries|rank|first page|guarantee|boost|increase/i);
      expect(s.button.length).toBeGreaterThan(3);
    }
  });
});

describe('the other small improvements, wired safely', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  it('a shop can only see and undo its OWN changes, and cannot override the later-change check', () => {
    const r = src('../app/api/changes/route.ts');
    expect(r).toMatch(/getSessionUserId/);
    expect(r).toMatch(/row\.profile_id !== me\.profileId/);
    expect(r).toMatch(/undoChange\(supabaseAdmin, row\.id, \{ confirm: true \}\)/);
    expect(r).not.toMatch(/allowLaterEdits/);
  });
  it('the invite page says which account to use and to tick the box, before Google', () => {
    const p = src('../app/invite/[token]/page.tsx');
    expect(p).toMatch(/Sign in with the Google account you use for your shop/);
    expect(p).toMatch(/Tick the box about business listings/);
    expect(p).toMatch(/Nothing changes on your listing/);
  });
  it('passing the invitation on is done by the shop\'s own phone: we send nothing', () => {
    const f = src('../components/ForwardInvite.tsx');
    expect(f).toMatch(/navigator\.share/);
    expect(f).not.toMatch(/fetch\(/);
  });
  it('the needs-help file has no contact details in it', () => {
    const p = src('../app/admin/pilot/page.tsx');
    const header = /'shop,town,status,waiting since,what happened,what to do,note'/.exec(p);
    expect(header).not.toBeNull();
    const fn = p.slice(p.indexOf('const downloadHelp'), p.indexOf('const openVoice'));
    expect(fn).not.toMatch(/contactEmail|phone/);
  });
  it('the readiness check sits behind the admin password like everything else there', () => {
    const r = src('../app/api/admin/pilot/route.ts');
    expect(r.indexOf('verifyAdminAuth(')).toBeLessThan(r.indexOf("case 'readiness'"));
  });
});
