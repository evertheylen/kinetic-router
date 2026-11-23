import { test, expect } from './helpers.js';
import type { Page } from '@playwright/test';
import type { TransientHandle } from '@kinetic-router/solid/router.js';
import type { LinkFixture } from '../src/link-fixture.js';

declare global {
  interface Window {
    linkFixture: LinkFixture,
    transientHandles: Record<string, TransientHandle>,
    transientEvents: string[],
  }
}

async function start(page: Page, zeroCache = false) {
  await page.goto(`/link-test/home?fixture${zeroCache ? '&zero-cache' : ''}`);
  await expect(page).toHaveTitle('home');
  await page.evaluate(() => {
    window.transientHandles = {};
    window.transientEvents = [];
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.body.append(spacer);
  });
}

async function open(page: Page, name = 'parent') {
  await page.evaluate(async name => {
    window.transientHandles[name] = window.linkFixture.router.pushTransient(() => {
      window.transientEvents.push(`enter ${name}`);
      const dialog = document.createElement('div');
      dialog.role = 'dialog';
      dialog.ariaLabel = name;
      dialog.style.cssText = 'position:fixed;right:0;bottom:0;padding:20px;background:white';
      dialog.textContent = name;
      document.body.append(dialog);
      return () => { window.transientEvents.push(`cleanup ${name}`); dialog.remove(); };
    });
    await window.transientHandles[name].finished;
  }, name);
}

for (const zeroCache of [false, true]) test(`Back/Forward preserve DOM, focus, scroll and lifecycle (zero cache ${zeroCache})`, async ({ page }) => {
  await start(page, zeroCache);
  await page.getByLabel('Notes').fill('local edits');
  const before = await page.evaluate(() => {
    (document.querySelector('input') as HTMLElement).focus({ preventScroll: true });
    window.scrollTo(0, 600);
    const status = window.linkFixture.contexts.home[0].pageStatus;
    return { y: scrollY, focused: status.hasFocus(), visible: status.isVisible() };
  });
  expect(before.y).toBe(600);
  await open(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => ({ y: scrollY, focus: document.activeElement?.tagName,
    entries: window.navigation.entries().length }))).toEqual({ y: 600, focus: 'INPUT', entries: 2 });
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => ({ y: scrollY, focus: document.activeElement?.tagName }))).toEqual({ y: 600, focus: 'INPUT' });
  await page.goForward();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Notes')).toHaveValue('local edits');
  await expect(page).toHaveTitle('home');
  expect(await page.evaluate(() => ({
    events: window.transientEvents, constructed: window.linkFixture.constructed.home,
    y: scrollY, focus: document.activeElement?.tagName,
    focused: window.linkFixture.contexts.home[0].pageStatus.hasFocus(),
    visible: window.linkFixture.contexts.home[0].pageStatus.isVisible(),
  }))).toEqual({ events: ['enter parent', 'cleanup parent'], constructed: 1, y: 600, focus: 'INPUT', focused: true, visible: true });
});

for (const action of ['primary', 'replace', 'navigate'] as const) test(`managed ${action} replaces transient entries`, async ({ page }) => {
  await start(page);
  await open(page);
  if (action === 'navigate') await page.evaluate(async () => {
    const f = window.linkFixture;
    await f.router.navigate(f.routes.b.locate({})).finished;
  });
  else await page.getByTestId(action).click();
  await expect(page).toHaveTitle(action === 'primary' ? 'a' : 'b');
  expect(await page.evaluate(() => ({ entries: window.navigation.entries().length, events: window.transientEvents })))
    .toEqual({ entries: 2, events: ['enter parent', 'cleanup parent'] });
  await page.goBack();
  await expect(page).toHaveTitle('home');
});

test('nested Back/Forward preserves the parent; explicit parent close crosses the expired child', async ({ page }) => {
  await start(page, true);
  const warnings: string[] = [];
  page.on('console', event => { if (event.type() === 'warning') warnings.push(event.text()); });
  await open(page);
  await open(page, 'child');
  expect(warnings.filter(text => text.includes('extra Back steps'))).toHaveLength(1);
  await page.evaluate(async () => { await window.transientHandles.parent.close().finished; });
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'child', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'parent', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.evaluate(async () => { await window.transientHandles.parent.close().finished; });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => ({ events: window.transientEvents, index: window.navigation.currentEntry!.index,
    count: window.linkFixture.constructed.home, entries: window.navigation.entries().length })))
    .toEqual({ events: ['enter parent', 'enter child', 'cleanup child', 'cleanup parent'], index: 0, count: 1, entries: 3 });
});

test('reload of a marked entry shows only the underlying page and still replaces on managed navigation', async ({ page }) => {
  await start(page);
  await open(page);
  await page.reload();
  await expect(page).toHaveTitle('home');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.navigation.currentEntry!.getState())).toHaveProperty('$transient', true);
  await page.getByTestId('primary').click();
  await expect(page).toHaveTitle('a');
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(2);
});

test('native dialog cancel prevents independent dismissal and closes through history', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const handle = window.linkFixture.router.pushTransient(() => {
      const dialog = document.createElement('dialog');
      dialog.textContent = 'Native dialog';
      dialog.oncancel = event => { event.preventDefault(); handle.close(); };
      document.body.append(dialog);
      dialog.showModal();
      return () => { dialog.close(); dialog.remove(); window.transientEvents.push('cleanup'); };
    });
    await handle.finished;
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => ({ index: window.navigation.currentEntry!.index, events: window.transientEvents })))
    .toEqual({ index: 0, events: ['cleanup'] });
});
