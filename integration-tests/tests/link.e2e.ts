import { test, expect } from './helpers.js';
import type { LinkFixture } from '../src/link-fixture.js';

declare global {
  interface Window { linkFixture: LinkFixture }
}

test.use({ hasTouch: true });

async function start(page: import('@playwright/test').Page, query = '') {
  await page.goto(`/link-test/home?fixture${query}`);
  await expect(page.getByRole('heading', { name: 'home', exact: true })).toBeVisible();
}

async function center(page: import('@playwright/test').Page, id = 'primary') {
  const bounds = await page.getByTestId(id).boundingBox();
  return { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
}

test('matches deep links under the mount, preserves URL suffixes, and leaves sibling paths to the browser', async ({ page }) => {
  const suffix = '?q=deep%20link&source=email#results';
  const canonical = '/link-test/results' + suffix;
  await page.goto('/link-test//results' + suffix);
  await expect(page.getByTestId('default-query')).toHaveText('deep link');
  await expect(page).toHaveURL(canonical);
  await page.evaluate(() => { document.documentElement.dataset.mountTest = 'same-document'; });

  const managed = page.getByTestId('primary');
  await expect(managed).toHaveAttribute('href', '/link-test/a');
  await managed.click();
  await expect(page).toHaveTitle('a');
  await expect(page).toHaveURL(/\/link-test\/a$/);
  await page.goBack();
  await expect(page.getByTestId('default-query')).toHaveText('deep link');
  await expect(page).toHaveURL(canonical);
  await page.goForward();
  await expect(page).toHaveTitle('a');

  await page.getByTestId('results-fragment').click();
  await expect(page.getByTestId('default-query')).toHaveText('plain link');
  await expect(page).toHaveURL(/\/link-test\/results\?q=plain\+link#results$/);
  await expect(page.locator('html')).toHaveAttribute('data-mount-test', 'same-document');

  await page.getByTestId('outside-mount').click();
  await expect(page).toHaveURL(/\/link-testing\/home$/);
  await expect(page.getByRole('heading', { name: 'Router scenarios' })).toBeVisible();
});

test('real hover across children stages once, preserves focus/history/title, and click adopts exactly once', async ({ page }) => {
  await start(page);
  await page.getByLabel('Notes').focus();
  const link = page.getByTestId('primary');
  await link.locator('span').first().hover();
  await expect.poll(() => page.evaluate(() => window.linkFixture.constructed.a)).toBe(1);
  await link.locator('span').last().hover();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => ({
    attempts: window.linkFixture.contexts.a.length,
    entries: window.navigation.entries().length,
    focus: document.activeElement?.tagName,
    staged: document.querySelectorAll('[data-kinetic-router-backstage] section').length,
    visible: window.linkFixture.contexts.a[0].pageStatus.isVisible(),
  }))).toEqual({ attempts: 1, entries: 1, focus: 'INPUT', staged: 1, visible: false });
  await expect(page).toHaveTitle('home');
  await link.click();
  await expect(page.getByRole('heading', { name: 'a', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ count: window.linkFixture.constructed.a, entries: window.navigation.entries().length,
    clickEntries: window.linkFixture.events.find(event => event.type === 'click')?.entries })))
    .toEqual({ count: 1, entries: 2, clickEntries: 1 });
  await page.getByTestId('plain').click();
  await expect(page).toHaveTitle('b');
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(3);
});

test('an ongoing hover retains fetching after adoption and a subsequent navigation', async ({ page }) => {
  await start(page);
  await page.getByTestId('second').hover();
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  const result = await page.evaluate(async () => {
    const fixture = window.linkFixture;
    const status = fixture.contexts.a[0].pageStatus;
    const fetching = status.fetchSignal()!;
    await fixture.router.navigate(fixture.routes.a.locate({})).finished;
    await fixture.router.navigate(fixture.routes.b.locate({})).finished;
    return { visible: status.isVisible(), fetching: status.shouldFetch(),
      sameSignal: status.fetchSignal() === fetching, aborted: fetching.aborted };
  });
  expect(result).toEqual({ visible: false, fetching: true, sameSignal: true, aborted: false });
  await page.mouse.move(0, 600);
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a[0].pageStatus.shouldFetch())).toBe(false);
  await expect(page).toHaveTitle('b');
});

test('a bare alias revalidates changes made by the caller click handler', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('alias')).toHaveAttribute('href', '/link-test/a');
  await page.getByTestId('alias').hover();
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  await page.getByTestId('alias').click();
  await expect(page).toHaveURL(/\/link-test\/b$/);
  await expect(page).toHaveTitle('b');
  expect(await page.evaluate(() => ({ entries: window.navigation.entries().length,
    attempts: window.linkFixture.contexts.b.length }))).toEqual({ entries: 2, attempts: 1 });
});

test('omitted defaults agree across preparation, managed clicks, fresh tabs and ordinary anchors', async ({ page }) => {
  await start(page);
  await page.getByTestId('default-managed').hover();
  await expect(page.locator('[data-kinetic-router-backstage] [data-testid="default-query"]')).toHaveText('all');
  await page.getByTestId('default-managed').click();
  await expect(page.locator('main').getByTestId('default-query')).toHaveText('all');
  await expect(page).toHaveURL(/\/link-test\/results$/);
  await page.goBack();
  await expect(page).toHaveTitle('home');
  const opened = page.waitForEvent('popup');
  await page.getByTestId('default-new-tab').click();
  const popup = await opened;
  await expect(popup.locator('main').getByTestId('default-query')).toHaveText('all');
  await popup.close();
  await page.getByTestId('default-plain').click();
  await expect(page.locator('main').getByTestId('default-query')).toHaveText('all');
});

test('an interrupted ordinary-anchor visit keeps its generated hidden values when prepared and resumed', async ({ page }) => {
  await start(page, '&hold&press');
  await page.getByTestId('draft-plain').click();
  await expect.poll(() => page.evaluate(() => window.linkFixture.draftTokens)).toEqual([1]);
  const committed = await page.evaluate(() => ({ id: window.navigation.currentEntry!.id, state: window.navigation.currentEntry!.getState() }));
  expect(committed.state).toMatchObject({ snapShotByKey: { token: 1 } });
  await page.evaluate(async () => {
    const f = window.linkFixture;
    await f.router.navigate(f.routes.home.locate({})).finished;
  });
  const result = await page.evaluate(async () => {
    const f = window.linkFixture;
    const target = f.routes.draft.locate({ token: 999 });
    const snapshot = f.router.resolveDestination(target, 'menu');
    const repeated = f.router.resolveDestination(target, 'menu');
    const one = f.router.acquirePreparation(snapshot)!;
    const two = f.router.acquirePreparation(repeated)!;
    const shared = one.ready === two.ready;
    const navigation = f.router.activateDestination(snapshot);
    one.release(); two.release();
    f.release();
    await navigation.finished;
    return { shared, planned: [snapshot.locator.values.token, repeated.locator.values.token],
      tokens: f.draftTokens, defaults: f.draftDefaults, values: f.router.currentLocator()!.values,
      id: window.navigation.currentEntry!.id, entries: window.navigation.entries().length };
  });
  expect(result).toEqual({ shared: true, planned: [1, 1], tokens: [1, 1], defaults: 1,
    values: { token: 1 }, id: committed.id, entries: 3 });
  await expect(page.locator('main').getByTestId('draft-token')).toHaveText('1');
  await expect(page).toHaveTitle('draft');
});

test('caller unmount during a real click preserves unfinished press preparation', async ({ page }) => {
  await start(page, '&hold&press&unmount-on-click');
  const link = page.getByTestId('primary');
  await link.hover();
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  await page.mouse.up();
  await expect(link).toHaveCount(0);
  expect(await page.evaluate(() => ({ attempts: window.linkFixture.contexts.a.length,
    aborted: window.linkFixture.contexts.a[0].signal.aborted, entries: window.navigation.entries().length })))
    .toEqual({ attempts: 1, aborted: false, entries: 2 });
  await page.evaluate(() => window.linkFixture.release());
  await expect(page).toHaveTitle('a');
  expect(await page.evaluate(() => window.linkFixture.constructed.a)).toBe(1);
});

test('trusted modified clicks open a native tab without press preparation or current-context navigation', async ({ page }) => {
  await start(page, '&press');
  const opened = page.context().waitForEvent('page');
  await page.getByTestId('primary').click({ modifiers: ['ControlOrMeta'] });
  const popup = await opened;
  await expect(popup).toHaveURL(/\/link-test\/a$/);
  await expect(popup).toHaveTitle('a');
  await popup.close();
  await expect(page).toHaveTitle('home');
  expect(await page.evaluate(() => ({ preparations: window.linkFixture.contexts.a.length,
    entries: window.navigation.entries().length }))).toEqual({ preparations: 0, entries: 1 });
});

test('keyboard focus prepares and blurring releases; Enter remains normal anchor activation', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('primary')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a[0].signal.aborted)).toBe(true);
  await page.keyboard.press('Tab');
  await page.getByTestId('primary').focus();
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(2);
  await page.keyboard.press('Enter');
  await expect(page).toHaveTitle('a');
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(2);
});

test('real touch implicit capture/release hands unfinished preparation to replace navigation', async ({ page }) => {
  await start(page, '&hold&press');
  await page.evaluate(() => window.linkFixture.setMode('replace'));
  const client = await page.context().newCDPSession(page);
  const point = await center(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(1);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/link-test/a');
  const before = await page.evaluate(() => ({
    aborted: window.linkFixture.contexts.a[0].signal.aborted,
    events: window.linkFixture.events.map(event => event.type),
    entries: window.navigation.entries().length,
  }));
  expect(before.aborted).toBe(false);
  expect(before.entries).toBe(1);
  expect(before.events).toEqual(['pointerdown', 'pointerup', 'lostpointercapture', 'click']);
  await page.getByRole('button', { name: 'Unmount primary' }).click();
  await page.evaluate(() => window.linkFixture.release());
  await expect(page).toHaveTitle('a');
  expect(await page.evaluate(() => window.linkFixture.constructed.a)).toBe(1);
});

test('captured touch dragged geometrically away cancels without pointer-induced focus keeping it alive', async ({ page }) => {
  await start(page, '&hold&press');
  const client = await page.context().newCDPSession(page);
  const point = await center(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 150 }] });
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a[0].signal.aborted)).toBe(true);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.evaluate(() => window.linkFixture.release());
  await expect(page).toHaveTitle('home');
  expect(await page.evaluate(() => window.linkFixture.constructed.a)).toBe(0);
});

test('a cancelled real click releases press ownership and missing-click handoffs expire', async ({ page }) => {
  await start(page, '&hold&press');
  await page.getByTestId('prevented').click();
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  expect(await page.evaluate(() => window.linkFixture.contexts.a[0].signal.aborted)).toBe(true);
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(1);
  await page.getByTestId('primary').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true });
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(2);
  const point = await center(page);
  await page.getByTestId('primary').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: point.x, clientY: point.y });
  await page.getByTestId('primary').dispatchEvent('lostpointercapture', { pointerId: 7, pointerType: 'touch' });
  expect(await page.evaluate(() => window.linkFixture.contexts.a[1].signal.aborted)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a[1].signal.aborted)).toBe(true);
  await page.evaluate(() => window.linkFixture.release());
  await expect(page).toHaveTitle('home');
});

test('new-tab and download anchors do not speculate or navigate the current context', async ({ page }) => {
  await start(page);
  await page.getByTestId('new-tab').hover();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(0);
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('new-tab').click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/a$/);
  await expect(popup).toHaveTitle('a');
  expect(await popup.evaluate(() => window.navigation.entries().length)).toBe(1);
  await popup.close();
  await page.getByTestId('download').hover();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download').click();
  await downloadPromise;
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(1);
  await expect(page).toHaveTitle('home');
});

test('menu URLs resume visits reactively and managed mode changes keep one activation per operation', async ({ page }) => {
  await start(page, '&press');
  await page.getByTestId('primary').click();
  await expect(page).toHaveTitle('a');
  await page.getByTestId('detail').click();
  await expect(page).toHaveTitle('detail');
  await page.getByTestId('plain').click();
  await expect(page).toHaveTitle('b');
  await expect(page.getByTestId('menu')).toHaveAttribute('href', '/link-test/a/detail');
  await page.getByTestId('menu').click();
  await expect(page).toHaveTitle('detail');
  await expect(page.getByTestId('menu')).toHaveAttribute('href', '/link-test/a');
  await page.getByTestId('menu').click();
  await expect(page).toHaveTitle('a');
  await page.getByTestId('menu').click();
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(4);
  await page.evaluate(() => {
    const fixture = window.linkFixture;
    fixture.setTarget(fixture.routes.b.locate({}));
    fixture.setMode('replace');
    fixture.setPrefetch(false);
  });
  await expect(page.getByTestId('primary')).toHaveAttribute('href', '/link-test/b');
  await page.getByTestId('primary').click();
  await expect(page).toHaveTitle('b');
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(4);
});

test('saveData changes cancel respected interests, restart hover, and preserve bypass and actual navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      value: Object.assign(new EventTarget(), { saveData: true, effectiveType: '2g' }),
    });
  });
  await start(page, '&hold');
  const change = (value: boolean) => page.evaluate(saveData => {
    const connection = (navigator as Navigator & { connection: EventTarget & { saveData: boolean } }).connection;
    connection.saveData = saveData;
    connection.dispatchEvent(new Event('change'));
  }, value);
  await page.getByTestId('primary').hover();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(0);
  await change(false); // effectiveType stays slow; only saveData matters
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(1);
  await change(true);
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a[0].signal.aborted)).toBe(true);
  await page.getByTestId('bypass').hover();
  await expect.poll(() => page.evaluate(() => window.linkFixture.contexts.a.length)).toBe(2);
  await change(false); await change(true);
  expect(await page.evaluate(() => window.linkFixture.contexts.a[1].signal.aborted)).toBe(false);
  await page.getByTestId('primary').click();
  await page.evaluate(() => window.linkFixture.release());
  await expect(page).toHaveTitle('a');
  expect(await page.evaluate(() => window.navigation.entries().length)).toBe(2);
});
