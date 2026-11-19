import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePost, generateDescription, validateContent, defaultCategory } from './ai';
import { getTenantBySlug } from './tenant';

// The model is never called: fetch is stubbed and records what was sent.
const realFetch = global.fetch;
let bodies: any[];
const modelSays = (...texts: string[]) => {
  let i = 0;
  global.fetch = vi.fn(async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: texts[Math.min(i++, texts.length - 1)] }] }), { status: 200 });
  }) as any;
};
beforeEach(() => { bodies = []; process.env.ANTHROPIC_API_KEY = 'test-key'; });
afterEach(() => { global.fetch = realFetch; });

const POST = { businessName: 'Testwell', category: 'Flooring store', city: 'Testtown', month: 'November', season: 'autumn', recentPosts: [] };
const GOOD_POST = 'Autumn is a good moment to freshen up a tired hallway with something hard-wearing. Pop in to the showroom and have a look.';
const GOOD_DESC = 'We are an independent flooring shop in Testtown, helping people choose carpet, vinyl, laminate and wood for every room in the house. Our showroom has plenty of samples to look through, and we are happy to talk through what will suit a busy hallway or a quiet bedroom. Pop in and say hello whenever you are passing.';

describe('who the post writer is told it writes for', () => {
  it('Stellar shops are flooring retailers', async () => {
    modelSays(GOOD_POST);
    await generatePost({ ...POST, businessType: getTenantBySlug('stellar').businessType });
    expect(bodies[0].system).toMatch(/^You write Google Business Profile posts for independent UK flooring retailers/);
  });

  it('Chocka shops, and callers that say nothing, get the neutral local-business wording', async () => {
    modelSays(GOOD_POST);
    await generatePost({ ...POST, businessType: getTenantBySlug('chocka').businessType });
    await generatePost(POST);
    expect(bodies[0].system).toMatch(/^You write Google Business Profile posts for small local UK businesses\./);
    expect(bodies[1].system).toBe(bodies[0].system);
  });

  it('no brand is told to sound like a tradesperson any more', async () => {
    modelSays(GOOD_POST);
    await generatePost({ ...POST, businessType: 'flooring_retailer' });
    await generatePost({ ...POST, businessType: 'local_business' });
    for (const b of bodies) expect(b.system).not.toMatch(/tradesp/i);
  });

  it('the description writer follows the same brand wording', async () => {
    modelSays(GOOD_DESC);
    await generateDescription({ businessName: 'Testwell', category: 'Flooring store', city: 'Testtown', businessType: 'flooring_retailer' });
    expect(bodies[0].system).toMatch(/descriptions for independent UK flooring retailers/);
    expect(bodies[0].system).not.toMatch(/tradesp/i);
  });

  it('the default category follows the brand', () => {
    expect(defaultCategory('flooring_retailer')).toBe('Flooring retailer');
    expect(defaultCategory('local_business')).toBe('Local business');
    expect(defaultCategory(undefined)).toBe('Local business');
  });

  it('the town goes in on its own line', async () => {
    modelSays(GOOD_POST);
    await generatePost(POST);
    expect(bodies[0].messages[0].content).toContain('\nTown: Testtown\n');
  });
});

describe('the no-inventions rules come last', () => {
  it('after the strict rules, for posts and descriptions', async () => {
    modelSays(GOOD_POST);
    await generatePost(POST);
    const s: string = bodies[0].system;
    expect(s.indexOf('NOTHING INVENTED')).toBeGreaterThan(s.indexOf('STRICT RULES'));
    expect(s.trimEnd().endsWith('then invite people to get in touch')).toBe(true);
    for (const word of ['discount', '"free"', 'award-winning', 'we just fitted', 'one of our customers', 'quotes from customers']) {
      expect(s).toContain(word);
    }
  });

  it('a post that invents an offer is written again, then refused', async () => {
    modelSays('Free fitting on every carpet this month, so pop in to the showroom and have a look.');
    await expect(generatePost(POST)).rejects.toThrow(/free offer/);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].system).toContain('no offers, sales, discounts, percentages, the word "free", awards or customer stories');
  });

  it('a post that invents a customer story is replaced by the retry when that one is clean', async () => {
    modelSays('We just fitted a lovely stair runner for a family in Testtown. Pop in and have a look.', GOOD_POST);
    await expect(generatePost(POST)).resolves.toBe(GOOD_POST);
  });
});

describe('validateContent: which content types get the invention checks', () => {
  it('posts and descriptions', () => {
    expect(validateContent('Our winter sale is on now, so pop in to the showroom and have a look.', 'post')).toEqual({ valid: false, reason: 'contains offer or discount' });
    expect(validateContent(GOOD_DESC + ' Award-winning service.', 'description')).toEqual({ valid: false, reason: 'contains award claim' });
    expect(validateContent(GOOD_POST, 'post').valid).toBe(true);
    expect(validateContent(GOOD_DESC, 'description').valid).toBe(true);
  });

  it('not review replies, which talk to a real customer by name', () => {
    expect(validateContent('Thank you so much, Mrs Smith. We are really glad you love the new hallway.', 'reply').valid).toBe(true);
  });

  it('the existing checks still apply', () => {
    expect(validateContent('Carpets from £9 a metre, pop in to the showroom and have a look.', 'post').reason).toBe('contains pricing');
    expect(validateContent('We are TrustMark accredited, pop in to the showroom and have a look.', 'post').reason).toBe('contains unverifiable claim');
  });
});
