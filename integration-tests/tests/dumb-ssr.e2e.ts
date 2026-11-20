import { test, expect } from './helpers.js';
import type { DumbSsrFixture } from '../src/dumb-ssr/client.js';
import type { Page } from '@playwright/test';

// Production SSR and DOM builds, served by the small example HTTP adapter.
test.use({ baseURL: 'http://127.0.0.1:4174' });
// Type-only reference ensures the client diagnostic interface stays checked.
const stats = (page: Page) => page.evaluate(() => {
  const fixture: DumbSsrFixture = window.dumbSsrFixture;
  return { pages: fixture.disposedPages, roots: fixture.disposedRoots, attempt: fixture.attempt };
});

async function pauseBootstrap(page: Page, path = '/go/home') {
  const gate = Promise.withResolvers<void>();
  await page.route('**/ssr-assets/assets/*.js', async route => { await gate.promise; await route.continue(); });
  await page.goto(path, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Public home' })).toBeVisible();
  return gate.resolve;
}

test('JS-disabled responses contain useful public HTML, escaped head metadata, non-editable controls and native links', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: 'http://127.0.0.1:4174' });
  const page = await context.newPage();
  try {
    const response = await page.goto('/go/home');
    expect(response!.status()).toBe(200);
    const html = await response!.text();
    expect(html).toContain('Public home &lt;&amp;&gt;');
    expect(html).not.toMatch(/\_\$HY|data-hk|hydration|bootstrap-data/);
    await expect(page).toHaveTitle('Public home <&>');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Public description of home <&>');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://public.example/go/home');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://public.example/go/home');
    await expect(page.getByRole('heading')).toHaveText('Public home');
    await expect(page.getByLabel('Notes')).toBeDisabled();
    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Public next');
    await expect(page).toHaveTitle('Public next <&>');
  } finally { await context.close(); }
});

test('a bootstrap failure before takeover leaves public content and native anchors usable', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/ssr-assets/assets/*.js', route => route.fulfill({
      contentType: 'text/javascript', body: 'throw new Error("Bootstrap unavailable")',
    }));
    await page.goto('/go/home');
    await expect(page.getByRole('heading')).toHaveText('Public home');
    await expect(page.getByLabel('Notes')).toBeDisabled();
    expect(errors).toEqual(['Bootstrap unavailable']);
    expect(await page.evaluate(() => typeof window.dumbSsrFixture)).toBe('undefined');
    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Public next');
  } finally { await context.close(); }
});

test('the adapter can distinguish an invalid URL from a rendering failure', async ({ request }) => {
  const response = await request.get('/go/missing');
  expect(response.status()).toBe(400);
  expect(await response.text()).toBe('Public render failed');
});

test('replaces every SSR node once with fresh DOM, then loads client data; preserves document/head/root and native history', async ({ page }) => {
  const bootstrap = await pauseBootstrap(page);
  const nextLink = page.getByRole('link', { name: 'Next' });
  await expect(nextLink).toHaveAttribute('href', '/go/next');
  const api = Promise.withResolvers<void>();
  await page.route('**/api/public/**', async route => { await api.promise; await route.continue(); });
  await page.evaluate(() => {
    const root = document.getElementById('root')!;
    const nodes: Node[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const old = root.firstElementChild!;
    const saved = { root, document, head: document.head, nodes, removals: 0 };
    Object.assign(window, { saved });
    new MutationObserver(records => {
      for (const record of records) if ([...record.removedNodes].includes(old)) saved.removals++;
    }).observe(root, { childList: true });
  });
  await expect(page.getByLabel('Notes')).toBeDisabled();
  bootstrap();
  await expect(page.getByRole('status')).toHaveText('Loading client content…');
  await expect(page.locator('[data-render="server"]')).toHaveCount(0);
  await expect(page.getByRole('heading')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const saved = (window as unknown as { saved: { root: Node, document: Document, head: Node, nodes: Node[], removals: number } }).saved;
    return { sameRoot: saved.root === document.getElementById('root'), sameDocument: saved.document === document,
      sameHead: saved.head === document.head, reused: saved.nodes.some(node => saved.root.contains(node)), removals: saved.removals,
      focus: document.activeElement?.tagName };
  })).toEqual({ sameRoot: true, sameDocument: true, sameHead: true, reused: false, removals: 1, focus: 'BODY' });
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Public description of home <&>');
  api.resolve();
  await expect(page.getByRole('heading')).toHaveText('Client home');
  await expect(page).toHaveTitle('Client home <&>');
  await expect(page.getByLabel('Notes')).toBeEnabled();
  await expect(nextLink).toHaveAttribute('href', '/go/next');
  await nextLink.click();
  await expect(page.getByRole('heading')).toHaveText('Client next');
  await page.goBack();
  await expect(page.getByRole('heading')).toHaveText('Client home');
  await page.goForward();
  await expect(page.getByRole('heading')).toHaveText('Client next');
  await page.evaluate(() => window.dumbSsrFixture.stop());
  expect(await stats(page)).toMatchObject({ roots: 1, pages: 2 });
  await expect(page.locator('#root')).toBeEmpty();
  await page.evaluate(() => window.dumbSsrFixture.start());
  await expect(page.getByRole('heading')).toHaveText('Client next');
});

test('uses exactly the same bootstrap for an empty CSR shell', async ({ page }) => {
  await page.goto('/go/home?shell');
  await expect(page.getByRole('heading')).toHaveText('Client home');
  await expect(page.locator('.client-shell')).toHaveCount(1);
  expect(await stats(page)).toMatchObject({ roots: 0, pages: 0, attempt: 1 });
});

test('an uncaught synchronous app-construction failure preserves public nodes and disposes the Router before retry', async ({ page }) => {
  await page.goto('/go/home?startupFailure');
  await expect(page.getByRole('alert')).toContainText('Synchronous startup failure');
  await expect(page.getByRole('heading')).toHaveText('Public home');
  await expect(page.getByLabel('Notes')).toBeDisabled();
  expect(await stats(page)).toMatchObject({ roots: 1, pages: 0 });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading')).toHaveText('Client home');
  await expect(page.locator('.client-shell')).toHaveCount(1);
});

test('explicitly handled initial API failure disposes the failed shell and offers visible retry, without claiming general init recovery', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/public/home', async route => {
    calls++;
    await route.fulfill({ status: 200, body: calls === 1 ? '' : 'Client home' });
  });
  // Network failures generate browser console errors, so model a failed body
  // read instead: application loader sees the genuine fetch rejection.
  await page.addInitScript(() => {
    const fetch = window.fetch;
    let first = true;
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (first && String(args[0]).includes('/api/public/')) {
        first = false;
        response.text = async () => { throw new Error('API body failed'); };
      }
      return response;
    };
  });
  await page.goto('/go/home');
  await expect(page.getByRole('alert')).toContainText('API body failed');
  await expect(page.locator('#root')).toBeEmpty();
  expect(await stats(page)).toMatchObject({ roots: 1, pages: 1 });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading')).toHaveText('Client home');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('stale async failure cannot tear down a newer client attempt', async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch;
    let first = true;
    window.fetch = async (...args) => {
      if (first && String(args[0]).includes('/api/public/')) {
        first = false;
        // Deliberately ignore AbortSignal to exercise the stale-attempt guard.
        return new Response(new ReadableStream({ start(controller) {
          Object.assign(window, { rejectOldBody: () => controller.error(new Error('Stale API failure')) });
        } }));
      }
      return fetch(...args);
    };
  });
  await page.goto('/go/home');
  await expect(page.getByRole('status')).toHaveText('Loading client content…');
  await page.evaluate(() => window.dumbSsrFixture.start());
  await expect(page.getByRole('heading')).toHaveText('Client home');
  await page.evaluate(() => (window as unknown as { rejectOldBody(): void }).rejectOldBody());
  await expect(page.getByRole('heading')).toHaveText('Client home');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await stats(page)).toMatchObject({ roots: 1, pages: 1 });
});
