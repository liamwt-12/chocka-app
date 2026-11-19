import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config for the scale check only. Not part of `npm test`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['scripts/scale-check/scale-check.scale.ts'],
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
