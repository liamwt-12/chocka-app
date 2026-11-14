import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Same '@/' alias as tsconfig, so route handlers can be tested directly.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    // `.netlify/` holds generated Deno edge-function bundles, including a
    // vendored utils.test.ts that imports over https: and cannot be loaded by
    // the Node ESM loader. It is build output (gitignored), not our source, so
    // collecting it only ever produced a spurious failure alongside a green
    // suite. Excluded so `npm test` exits non-zero for real reasons.
    exclude: ['**/node_modules/**', '**/.netlify/**', '**/.next/**'],
  },
});
