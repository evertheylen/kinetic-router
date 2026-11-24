import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'definition',
      'url',
      'solid',
      'solid/vitest.server.config.ts',
      'lifecycle',
      'motion',
      'motion-layout',
    ],
  },
})
