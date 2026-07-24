import { defineConfig } from 'vitest/config'

export default defineConfig({
  // resolve solid-js to its client build (the node/server build turns
  // createEffect into a no-op, but we test real client behaviour)
  resolve: {
    conditions: ['browser', 'development'],
  },
  test: {
    environment: 'happy-dom',
    server: {
      deps: {
        inline: [/solid-js/, /@solidjs/],
      },
    },
  },
})
