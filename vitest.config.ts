import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'definition',
      'url',
      'solid',
      'native-bridge',
    ],
  },
})
