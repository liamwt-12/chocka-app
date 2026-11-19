import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { middleware, config } from '../middleware';

const req = (path: string, host = 'app.stellarlocal.co.uk') => new NextRequest(new URL(`https://${host}${path}`), { headers: { host } });

describe('the image endpoint is shut', () => {
  it('answers /_next/image with a plain 404, whatever is asked for', async () => {
    for (const path of [
      '/_next/image?url=%2Ffavicon.ico&w=64&q=75',
      '/_next/image?url=https%3A%2F%2Fexample.com%2Fa.svg&w=64&q=75',
      '/_next/image',
      '/_next/image/anything',
    ]) {
      const res = middleware(req(path));
      expect(res.status, path).toBe(404);
      expect(res.headers.get('x-middleware-next'), path).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('Not found');
    }
  });

  it('leaves every other page alone, with the brand header as before', () => {
    for (const path of ['/', '/login', '/admin/pilot', '/api/dashboard', '/_next/imagery', '/images/a']) {
      const res = middleware(req(path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get('x-middleware-next'), path).toBe('1');
      expect(res.headers.get('x-middleware-request-x-tenant-slug'), path).toBe('stellar');
    }
  });

  it('the matcher sends /_next/image to the middleware, and still skips static files', () => {
    expect(config.matcher).toContain('/_next/image');
    expect(config.matcher).toContain('/_next/image/:path*');
    expect(config.matcher[2]).toMatch(/_next\/static/);
  });

  it('nothing in the app uses next/image, and Next never optimises images', () => {
    const cfg = readFileSync(new URL('../next.config.js', import.meta.url), 'utf8');
    expect(cfg).toMatch(/images:\s*\{\s*unoptimized:\s*true\s*\}/);
    const root = new URL('..', import.meta.url).pathname;
    const files = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((f) => {
      const p = join(dir, f);
      return statSync(join(root, p)).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
    });
    const users = ['app', 'components', 'lib'].flatMap(files).filter((f) => /from ['"]next\/image['"]/.test(readFileSync(join(root, f), 'utf8')));
    expect(users).toEqual([]);
  });
});
