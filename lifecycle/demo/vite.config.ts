import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [solid()],
  // The integration demo consumes workspace sources without dependency cycles.
  resolve: { alias: {
    '@kinetic-router/lifecycle': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    '@kinetic-router/presence': fileURLToPath(new URL('../../presence/src/index.ts', import.meta.url)),
    '@kinetic-router/motion': fileURLToPath(new URL('../../motion/src/index.ts', import.meta.url)),
    '@kinetic-router/motion-layout': fileURLToPath(new URL('../../motion-layout/src/index.ts', import.meta.url)),
  } },
  build: { target: 'esnext' },
})
