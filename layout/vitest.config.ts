import { defineConfig } from 'vitest/config'
import solid from '@solidjs/vite-plugin'

export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ['browser', 'development'] },
  test: {
    environment: 'happy-dom',
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
})
