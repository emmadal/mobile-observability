import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a production build (`next build && next start`),
 * so the nonce CSP and Server Actions behave as on Vercel. e2e/prepare.ts
 * recreates a throwaway database first; the setup project signs in and sends
 * SDK-shaped envelopes through the real ingest endpoint.
 *
 *   docker compose up -d db && pnpm --filter @mobile-observability/dashboard test:e2e
 */
const PORT = 3200;
const baseURL = `http://localhost:${PORT}`;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://mobs:mobs@localhost:5433/mobs_e2e';

export default defineConfig({
  testDir: './e2e',
  // One database shared by every spec: run them in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.cache/owner.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `tsx e2e/prepare.ts && next build && next start -p ${PORT}`,
    url: `${baseURL}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL,
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-e2e-only-secret',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
