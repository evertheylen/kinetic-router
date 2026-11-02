import { render } from '@solidjs/web';
import { onCleanup } from 'solid-js';
import { Router } from '@kinetic-router/solid/router.js';
import { App, registerPages, sitemap, type Metadata } from './pages.js';

const root = document.getElementById('root');
const status = document.getElementById('bootstrap-status');
if (!root || !status) throw new Error('Missing app root/status');
const query = new URL(location.href).searchParams;
let dispose = () => {};
let attempt = 0;
let disposedPages = 0;
let disposedRoots = 0;

function stop() {
  attempt++; // Invalidate async callbacks before disposing their work.
  dispose();
  dispose = () => {};
}

function start() {
  stop();
  const current = attempt;
  status!.replaceChildren();
  const fail = (error: unknown) => {
    if (attempt !== current) return;
    stop();
    // This is the application's controlled API-error seam, not general Router
    // initialization recovery. Disposal after takeover does NOT restore SSR.
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = `Client failed: ${String(error)}`;
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = start;
    status!.replaceChildren(message, retry);
  };
  try {
    dispose = render(() => {
      onCleanup(() => disposedRoots++);
      const router = new Router<{}, Metadata>(sitemap);
      registerPages(router, {
        disposed: () => disposedPages++,
        async load(name, context) {
          try {
            const response = await fetch(`/api/public/${name}`, { signal: context.signal });
            if (!response.ok) throw new Error(`Public API: ${response.status}`);
            return await response.text();
          } catch (error) {
            if (!context.signal.aborted && attempt === current) fail(error);
            throw error;
          }
        },
      });
      if (query.has('startupFailure') && current === 1) throw new Error('Synchronous startup failure');
      // Fresh element-rooted output: even loading/error text cannot adopt an SSR
      // Text node. The Outlet mounts immediately, before Router's init microtask.
      return <div class="client-shell"><App router={router} /></div>;
    }, root!, Array.from(root!.childNodes));
  } catch (error) {
    fail(error); // An uncaught synchronous construction failure preserves SSR.
  }
}

// Fixture diagnostics only; no server snapshot, data transfer or readiness API.
window.dumbSsrFixture = {
  start, stop,
  get attempt() { return attempt; },
  get disposedPages() { return disposedPages; },
  get disposedRoots() { return disposedRoots; },
};
start();
import.meta.hot?.dispose(stop);

export type DumbSsrFixture = typeof window.dumbSsrFixture;
declare global {
  interface Window {
    dumbSsrFixture: { start(): void, stop(): void, readonly attempt: number, readonly disposedPages: number, readonly disposedRoots: number },
  }
}
