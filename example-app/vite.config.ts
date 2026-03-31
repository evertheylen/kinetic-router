import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  base: './',
  optimizeDeps: {
    exclude: ['@kinetic-router/definition', '@kinetic-router/url', '@kinetic-router/solid']
  }
});
