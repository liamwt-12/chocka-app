import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config for the 92-shops-in-a-week simulation only. Not part of `npm test`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['scripts/scale-check/day-one.sim.ts'],
    testTimeout: 600_000,
    fileParallelism: false,
  },
});
