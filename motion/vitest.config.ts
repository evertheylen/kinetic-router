import { defineConfig } from 'vitest/config'
import solid from '@solidjs/vite-plugin'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ['browser', 'development'],
    alias: { '@kinetic-router/lifecycle': fileURLToPath(new URL('../lifecycle/src/index.ts', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
})
