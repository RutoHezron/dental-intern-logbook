import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (service worker included).
 * Uses the locally installed Chrome, so no browser download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4180',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4180 --strictPort',
    url: 'http://localhost:4180',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
