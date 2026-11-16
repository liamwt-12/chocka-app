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
    // Vitest's default is 5 seconds. Nothing here should take that long, but a
    // few tests do real work (building a 4 MB image, stepping a virtual clock
    // thousands of times), and on a machine busy with other things they have
    // been seen to pass 5 seconds and fail with nothing wrong. A failure should
    // mean the code is wrong, not that the laptop was busy.
    testTimeout: 30_000,
  },
});
