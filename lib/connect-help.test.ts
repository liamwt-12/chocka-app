import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HELP, HELP_REASONS, helpPath, isHelpReason } from './connect-help';

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('every reason a sign-in can fail has words and a next step', () => {
  it.each(HELP_REASONS)('%s', (why) => {
    const t = HELP[why];
    for (const text of [t.title, t.what, t.button, t.supportLabel, t.supportAction, ...t.next]) expect(text.trim().length).toBeGreaterThan(3);
    expect(t.next.length).toBeGreaterThan(0);
    // Plain words: nothing a shop owner would have to look up.
    expect(`${t.title} ${t.what} ${t.next.join(' ')}`).not.toMatch(/OAuth|scope|token|API|error code|credential/i);
  });

  it('never claims Google hides the email address: sign-in does share it', () => {
    expect(JSON.stringify(HELP)).not.toMatch(/does not give us your email/i);
  });

  it('the address carries the invite when there is one', () => {
    expect(helpPath('cancelled', 'abc.def')).toBe('/connect-help?why=cancelled&invite=abc.def');
    expect(helpPath('no_listing')).toBe('/connect-help?why=no_listing');
    expect(isHelpReason('unticked')).toBe(true);
    expect(isHelpReason('<script>')).toBe(false);
  });
});

describe('the sign-in return handler has no dead ends', () => {
  const cb = src('../app/api/auth/callback/google/route.ts');

  it('a refusal from Google is handled BEFORE the "no code, go to Google" branch', () => {
    const refusal = cb.indexOf("searchParams.get('error')");
    const start = cb.indexOf('// Step 1: No code yet');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(start);
    expect(cb).toMatch(/helpPath\(why, invite\)/);
  });

  it('an unticked box goes to the help page with the invite, and NOTHING is revoked', () => {
    expect(cb).toMatch(/helpPath\('unticked', invite\)/);
    // Handing that permission back would cancel a working grant the same person gave earlier.
    const block = cb.slice(cb.indexOf("if (!tokens.scope || !tokens.scope.includes('business.manage'))"), cb.indexOf("console.log(`[auth] business.manage granted"));
    expect(block).not.toMatch(/revokeQuietly\(/);
  });

  it('an invited shop gets no account until a listing is found', () => {
    const lookFirst = cb.indexOf('LOOK FOR THE LISTING BEFORE CREATING ANYTHING');
    const insert = cb.indexOf(".from('users')\n      .insert(");
    expect(lookFirst).toBeGreaterThan(0);
    expect(lookFirst).toBeLessThan(insert);
    expect(cb).toMatch(/helpPath\('no_listing', parsedState\.invite\)/);
    expect(cb).toMatch(/helpPath\('google_error', parsedState\.invite\)/);
  });

  it('a stale claim is only cleared once the newcomer is known to manage a listing, and before the invite gate decides', () => {
    const listed = cb.indexOf('listings = await getManageableListings(tokens.access_token)');
    const noListing = cb.indexOf("return NextResponse.redirect(new URL(helpPath('no_listing', parsedState.invite), baseUrl));");
    const release = cb.indexOf('releaseStaleClaim(');
    const gate = cb.indexOf('const admitted = await inviteAdmitsSignup');
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThan(noListing);
    expect(noListing).toBeLessThan(release);
    expect(release).toBeLessThan(gate);
    expect(cb).toMatch(/evenIfRecent: outcome\.status === 'connected'/);
  });

  it('an expired or withdrawn link cannot be restarted from the help page', () => {
    expect(cb).toMatch(/if \(inviteRef && !\(await inviteStillUsable\(inviteRef\)\)\)/);
  });

  it('an account that turned out to manage no listing is not linked to the shop it was told is not connected', () => {
    expect(cb).toMatch(/if \(!dest\.startsWith\('\/connect-help'\)\) await linkInviteToUser/);
  });

  it('"This is not my shop" is a button the signed-in shop presses, not a link that leads nowhere', () => {
    const reset = src('../app/api/connection/reset/route.ts');
    expect(reset).toMatch(/export async function POST/);
    expect(reset).toMatch(/\.eq\('user_id', userId\)/); // only ever the signed-in shop's own connection
    expect(reset).toMatch(/clearSessionCookies\(response\)/);
    expect(src('../app/connected/page.tsx')).toMatch(/action="\/api\/connection\/reset" method="post"/);
    expect(src('../app/api/connected/route.ts')).not.toMatch(/helpPath/);
  });

  it('the help page only links back to Google with a reference that verifies', () => {
    const page = src('../app/connect-help/page.tsx');
    expect(page).toMatch(/parseInviteRef\(searchParams\.invite\)/);
    expect(page).not.toMatch(/method="post"/i);
  });
});

describe('the activation score is written once', () => {
  const audit = src('../app/api/audit/route.ts');
  it('audit_score is only set when it is empty; the latest measured score goes elsewhere', () => {
    expect(audit).toMatch(/if \(profile\.audit_score === null \|\| profile\.audit_score === undefined\) scores\.audit_score = audit\.score/);
    expect(audit).not.toMatch(/update\(\{ audit_score: audit\.score/);
    expect(audit).not.toMatch(/predictedScore/);
  });
});
