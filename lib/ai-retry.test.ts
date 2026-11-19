import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { suggestCategories, setModelRetryDelaysForTests } from './ai';

const ok = () => new Response(JSON.stringify({ content: [{ type: 'text', text: '["Carpet store"]' }], stop_reason: 'end_turn' }), { status: 200 });
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('a busy model is tried again before anybody sees a failure', () => {
  it('429 then 529 then an answer: three calls, and the answer is used', async () => {
    const before = setModelRetryDelaysForTests([0, 0]);
    let calls = 0;
    global.fetch = vi.fn(async () => (++calls === 1 ? new Response('slow down', { status: 429 }) : calls === 2 ? new Response('overloaded', { status: 529 }) : ok())) as any;
    try { expect(await suggestCategories({ primaryCategory: 'Flooring shop', businessName: 'Test' })).toEqual(['Carpet store']); } finally { setModelRetryDelaysForTests(before); }
    expect(calls).toBe(3);
  });

  it('gives up after the configured tries and says which answer it got', async () => {
    const before = setModelRetryDelaysForTests([0, 0]);
    let calls = 0;
    global.fetch = vi.fn(async () => { calls++; return new Response('slow down', { status: 429 }); }) as any;
    try { await expect(suggestCategories({ primaryCategory: 'x', businessName: 'y' })).rejects.toThrow(/\(429\)/); } finally { setModelRetryDelaysForTests(before); }
    expect(calls).toBe(3);
  });

  it('a refusal that will be the same next time is not retried', async () => {
    const before = setModelRetryDelaysForTests([0, 0]);
    let calls = 0;
    global.fetch = vi.fn(async () => { calls++; return new Response('bad key', { status: 401 }); }) as any;
    try { await expect(suggestCategories({ primaryCategory: 'x', businessName: 'y' })).rejects.toThrow(/\(401\)/); } finally { setModelRetryDelaysForTests(before); }
    expect(calls).toBe(1);
  });
});

describe('the screen can tell "nothing needed" from "could not write it"', () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  it('the suggestions route says which ones failed', () => {
    const r = src('../app/api/audit/previews/route.ts');
    expect(r).toMatch(/failed,\n\s+\}\);/);
    expect(r).toMatch(/failed: \['description', 'services', 'firstPost', 'categories'\]/);
  });
  it('the screen shows that, with a way to try again, and does not claim the listing needs nothing', () => {
    const c = src('../components/ImproveListing.tsx');
    expect(c).toMatch(/We could not write everything just now/);
    expect(c).toMatch(/const nothingToOffer = !loading && !notWritten\.length/);
  });
});
