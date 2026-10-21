import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.e2e.ts',
  forbidOnly: !!process.env.CI,
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  webServer: {
    command: process.env.LIFECYCLE_DEV
      ? 'pnpm exec vite demo --host 127.0.0.1 --port 4174 --strictPort'
      : 'pnpm exec vite preview demo --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
  },
})
