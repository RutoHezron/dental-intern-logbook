import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (service worker included).
 * Uses the locally installed Chrome, so no browser download is needed. The
 * build is pointed at a test-only sync server, so account features run too.
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
  webServer: [
    {
      // Test-only stand-in for Supabase: the real migrations in PGlite (see e2e/fake-supabase.mjs).
      command: 'node e2e/fake-supabase.mjs',
      url: 'http://localhost:54329/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4180 --strictPort',
      url: 'http://localhost:4180',
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_SUPABASE_URL: 'http://localhost:54329', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
    },
  ],
});
