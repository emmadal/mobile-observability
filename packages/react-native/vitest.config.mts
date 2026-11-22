import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'cli/**/*.test.mjs'],
    environment: 'node',
  },
});
