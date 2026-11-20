import { renderDumbSsr } from '@kinetic-router/solid/dumb-ssr.js';
import { SolidImplementationMap } from '@kinetic-router/solid/implementation-map.js';
import { createComponent } from 'solid-js';
import { App, basePath, registerPages, sitemap, type Metadata } from './pages.js';

export { DumbSsrUrlError } from '@kinetic-router/solid/dumb-ssr.js';

const pages = new SolidImplementationMap<{}, Metadata>(sitemap);
registerPages(pages, { load: async name => `Public ${name}` });

export function renderPublicPage(url: URL, signal: AbortSignal) {
  return renderDumbSsr({ sitemap, pages, url, basePath, signal, app: () => createComponent(App, {}) });
}
