import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // unit + integration are deterministic and run in CI (no live tmux).
    // e2e (real tmux) lives outside this config and is run as a separate job.
    environment: 'node',
    globals: false,
  },
});
