import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['node'] },
  test: {
    name: 'solid-server',
    environment: 'node',
    include: ['src/**/*.server.test.ts'],
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
  },
});
