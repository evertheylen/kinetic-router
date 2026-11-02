import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';

export default defineConfig(({ mode, isSsrBuild }) => ({
  // Only the server build uses SSR transforms. The client is ordinary DOM,
  // deliberately not hydratable, even though its document contains SSR HTML.
  plugins: [solid({ ssr: !!isSsrBuild })],
  base: mode === 'dumb-ssr' ? '/ssr-assets/' : '/',
  build: {
    target: 'esnext',
    ...(mode === 'dumb-ssr' ? {
      outDir: 'dist-ssr-client',
      rolldownOptions: { input: 'dumb-ssr.html' },
    } : {}),
  },
}));
