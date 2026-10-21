import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4175';

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.e2e.ts',
  forbidOnly: !!process.env.CI,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
    url: baseURL,
  },
});
