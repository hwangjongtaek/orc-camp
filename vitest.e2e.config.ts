import { defineConfig } from 'vitest/config';

// Non-gated e2e config (SPEC-007 §3.1-2): live tmux, separate from `npm test`.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // serialize: one live tmux session at a time
  },
});
