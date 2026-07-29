/**
 * Playwright config for MMMIS SPA e2e tests.
 *
 * Kept separate from the SPA's existing tsconfig so it doesn't break
 * `tsc --noEmit` during normal builds. Install with:
 *
 *   pnpm add -D @playwright/test
 *   pnpm dlx playwright install chromium
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Single worker — the CHIT happy-path test uses two browser contexts and
  // assumes no other test is mutating the same DB rows concurrently.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://mmmis.vercel.app',
    headless: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});