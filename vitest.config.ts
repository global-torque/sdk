import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/testing.ts', 'src/types.ts'],
      thresholds: {
        statements: 90,
        lines: 90,
        branches: 85,
      },
    },
  },
});
