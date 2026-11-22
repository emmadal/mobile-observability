import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database; run files serially.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://mobs:mobs@localhost:5433/mobs_test',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
  },
});
