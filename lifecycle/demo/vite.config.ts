import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [solid()],
  // The integration demo consumes both packages' sources without a dependency cycle.
  resolve: { alias: { '@kinetic-router/lifecycle': fileURLToPath(new URL('../src/index.ts', import.meta.url)) } },
  build: { target: 'esnext' },
})
