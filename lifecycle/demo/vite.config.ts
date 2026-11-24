import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [solid()],
  // The integration demo consumes workspace sources without dependency cycles.
  resolve: { alias: {
    '@kinetic-router/lifecycle': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    '@kinetic-router/animations': fileURLToPath(new URL('../../animations/src/index.ts', import.meta.url)),
    '@kinetic-router/layout': fileURLToPath(new URL('../../layout/src/index.ts', import.meta.url)),
  } },
  build: { target: 'esnext' },
})
