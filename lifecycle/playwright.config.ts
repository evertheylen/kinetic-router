import { defineConfig } from '@playwright/test'

// Keep host-specific workarounds out of shared config. An experimental
// PLAYWRIGHT_HOST_PLATFORM_OVERRIDE must be used for both install and test runs;
// switching WebKit variants needs a forced reinstall because revisions share a
// cache directory. Stock system WebKit lacks Playwright's automation patches.
export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.e2e.ts',
  forbidOnly: !!process.env.CI,
  projects: (['chromium', 'firefox', 'webkit'] as const).map(browserName => ({
    name: browserName,
    use: { browserName },
  })),
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  webServer: {
    command: process.env.LIFECYCLE_DEV
      ? 'pnpm exec vite demo --host 127.0.0.1 --port 4174 --strictPort'
      : 'pnpm exec vite preview demo --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
  },
})
