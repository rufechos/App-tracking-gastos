// End-to-end tests: the real app in Chromium at iPhone size, with the bank server replaced by a fake.
import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'iphone', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node tools/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
