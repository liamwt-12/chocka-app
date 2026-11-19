import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config for the staging dummy run only. Started by scripts/dummy-run/run.py,
// never by `npm test`: the run file is not named *.test.ts on purpose.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['scripts/dummy-run/dummy-run.staging.ts'],
    testTimeout: 900_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    reporters: ['default'],
  },
});
