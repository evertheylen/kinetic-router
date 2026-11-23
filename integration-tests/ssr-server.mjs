// Production fixture adapter only: markup/head/assets/HTTP policy belong to the
// host, not the router. No bot detection, private credentials, or worker fallback.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { renderPublicPage, DumbSsrUrlError } from './dist-ssr/server.js';

const template = await readFile(new URL('./dist-ssr-client/dumb-ssr.html', import.meta.url), 'utf8');
const publicOrigin = 'https://public.example'; // Trusted configuration, not Host.
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const assets = resolve('dist-ssr-client');

createServer(async (request, response) => {
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const url = new URL(request.url, 'http://127.0.0.1:4174');
    if (url.pathname.startsWith('/ssr-assets/')) {
      const path = resolve(assets, decodeURIComponent(url.pathname.slice('/ssr-assets/'.length)));
      if (!path.startsWith(assets + sep)) { response.writeHead(403).end(); return; }
      const data = await readFile(path);
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css');
      response.end(data);
      return;
    }
    if (url.pathname.startsWith('/api/public/')) {
      response.setHeader('Content-Type', 'text/plain');
      response.end(`Client ${url.pathname.split('/').at(-1)}`);
      return;
    }
    const result = url.searchParams.has('shell')
      ? { html: '', title: 'CSR shell', description: 'Empty client shell' }
      : await renderPublicPage(url, controller.signal);
    const canonical = new URL(url.pathname, publicOrigin).href;
    const head = `<title>${escape(result.title)}</title><meta name="description" content="${escape(result.description)}"><link rel="canonical" href="${escape(canonical)}"><meta property="og:url" content="${escape(canonical)}">`;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(template.replace('<!--head-->', () => head).replace('<!--app-->', () => result.html));
  } catch (error) {
    // URL errors remain distinct; arbitrary renderer/serde failures aren't all
    // "not found". A real adapter chooses its own reporting/error-document policy.
    response.writeHead(error instanceof DumbSsrUrlError ? 400 : 500).end('Public render failed');
  }
}).listen(4174, '127.0.0.1');
