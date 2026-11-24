import type { Locator, Page } from '@playwright/test';
import { test, expect } from './helpers.js';

test.use({ reducedMotion: 'no-preference' });

async function start(page: Page, query = '') {
  await page.goto(`/motion-test/library/home${query}`);
  await expect(page.getByRole('heading', { name: 'Library home' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Library slot' })).toHaveJSProperty('tagName', 'SECTION');
  return page.getByTestId('album-page');
}

// Prepared and snapped poses may have finished fill effects; neither is playing.
async function pose(target: Locator, progress?: number): Promise<{ opacity: number; active: boolean }> {
  if (progress !== undefined) await expect.poll(async () => (await pose(target)).active).toBe(true);
  return target.evaluate(async (element, progress) => {
    const effects = element.getAnimations().filter(animation =>
      animation.pending || animation.playState === 'running' || animation.playState === 'paused');
    if (progress !== undefined) {
      effects.forEach(animation => animation.pause());
      await Promise.all(effects.map(animation => animation.ready));
      for (const animation of effects) animation.currentTime = Number(animation.effect!.getTiming().duration) * progress;
    }
    return { opacity: Number(getComputedStyle(element).opacity), active: effects.length > 0 };
  }, progress);
}

async function finishMotion(target: Locator) {
  await target.evaluate(async element => {
    const completions = element.getAnimations({ subtree: true }).map(animation => {
      const done = animation.finished;
      animation.finish();
      return done;
    });
    await Promise.allSettled(completions);
  });
}

const back = (page: Page) => page.evaluate(async () => { await window.navigation.back().finished; });
const forward = (page: Page) => page.evaluate(async () => { await window.navigation.forward().finished; });
const startedExits = (page: Page) => page.evaluate(() => window.routeMotionFixture.albumExits.length);
const readNotesStatus = (page: Page) => page.evaluate(() => {
  const { notesStatus: status } = window.routeMotionFixture;
  return { fetching: status.shouldFetch(), visible: status.isVisible(), focused: status.hasFocus() };
});

test('hover constructs in parallel and adopts dormant poses; only the opted-in outlet animates', async ({ page }) => {
  const album = await start(page, '?hold-album');
  const card = album.getByTestId('local-card');
  const notes = album.getByTestId('notes-page');
  const legacyEntry = notes.locator('h2');
  const homeDraft = page.getByLabel('Home draft');
  const open = page.getByRole('link', { name: 'Open album' });
  const before = await page.evaluate(() => ({ url: location.href, entries: window.navigation.entries().map(entry => entry.id) }));
  await homeDraft.focus();
  await open.hover();
  await expect.poll(() => page.evaluate(() => [...window.routeMotionFixture.started].sort())).toEqual(['album', 'notes']);
  await expect(album).toHaveCount(0); // The child started while the parent's factory remains blocked.
  await page.evaluate(() => window.routeMotionFixture.releaseAlbum());
  await expect(notes).toHaveCount(1);
  const stagedAlbum = (await album.elementHandle())!;
  const stagedNotes = (await notes.elementHandle())!;
  expect(await pose(album)).toEqual({ opacity: 0.25, active: false });
  expect(await pose(card)).toEqual({ opacity: 0.4, active: false });
  await expect(legacyEntry).toHaveCSS('opacity', '0');
  await expect(legacyEntry).not.toHaveAttribute('data-entered');
  await expect(page.getByTestId('album-portal-control')).toHaveCount(0);
  expect(await page.evaluate(() => window.routeMotionFixture.localEnters)).toBe(0);
  expect(await readNotesStatus(page)).toEqual({ fetching: true, visible: false, focused: false });
  await expect(page.getByRole('heading', { name: 'Album', exact: true })).toHaveCount(0);
  await expect(homeDraft).toBeFocused();
  await expect(page).toHaveTitle('Library home');
  expect(await page.evaluate(() => ({ url: location.href, entries: window.navigation.entries().map(entry => entry.id) }))).toEqual(before);

  await open.click();
  await expect(page.getByRole('heading', { name: 'Album', exact: true })).toBeVisible();
  expect(await album.evaluate((element, staged) => element === staged, stagedAlbum)).toBe(true);
  expect(await notes.evaluate((element, staged) => element === staged, stagedNotes)).toBe(true);
  expect(await pose(album, 0)).toEqual({ opacity: 0.25, active: true });
  expect(await pose(card, 0)).toEqual({ opacity: 0.4, active: true });
  await expect.poll(() => page.evaluate(() => window.routeMotionFixture.localEnters)).toBe(1);
  expect(await pose(notes)).toEqual({ opacity: 1, active: false });
  // Legacy local hooks keep their normal behavior in a plain outlet, even
  // though the page-level Motion adapter snaps instead of playing.
  await expect(legacyEntry).toHaveCSS('opacity', '1');
  await expect(legacyEntry).toHaveAttribute('data-entered', 'true');
  expect(await readNotesStatus(page)).toEqual({ fetching: true, visible: true, focused: true });

  // The parent animation is still paused, but its ordinary nested outlet can
  // replace the child immediately without changing the parent instance or pose.
  await page.evaluate(() => window.routeMotionFixture.showSummary());
  await expect(page).toHaveTitle('Summary');
  expect(await stagedNotes.evaluate(element => element.isConnected)).toBe(false);
  expect(await album.evaluate((element, staged) => element === staged, stagedAlbum)).toBe(true);
  expect(await pose(album)).toEqual({ opacity: 0.25, active: true });
  expect(await pose(album.getByTestId('summary-page'))).toEqual({ opacity: 1, active: false });
});

test('retention does not block finished, cached entry replays, and interrupted exit cannot remove the restored page', async ({ page }) => {
  const album = await start(page);
  await page.evaluate(() => window.routeMotionFixture.openAlbum());
  expect(await pose(album, 0)).toEqual({ opacity: 0.25, active: true });
  await finishMotion(album);
  const original = (await album.elementHandle())!;
  await page.getByLabel('Album draft').fill('Keep this draft');

  await back(page); // Both the native exit animation and user gate are still unfinished.
  await expect(page.getByRole('heading', { name: 'Library home' })).toBeVisible();
  await expect.poll(() => startedExits(page)).toBe(1);
  expect(await pose(album, 0.5)).toEqual({ opacity: 0.75, active: true });
  expect(await album.locator('input').evaluate(input => {
    input.focus();
    return { inert: input.closest('[inert]') !== null, focused: document.activeElement === input };
  })).toEqual({ inert: true, focused: false });
  expect(await readNotesStatus(page)).toEqual({ fetching: false, visible: false, focused: false });
  await finishMotion(album);
  expect(await original.evaluate(element => element.isConnected)).toBe(true); // onExit still holds it.
  await page.evaluate(() => window.routeMotionFixture.albumExits[0].release());
  await expect(album).toHaveCount(0);

  await forward(page);
  expect(await album.evaluate((element, cached) => element === cached, original)).toBe(true);
  expect(await pose(album, 0)).toEqual({ opacity: 0.25, active: true });
  await expect(page.getByLabel('Album draft')).toHaveValue('Keep this draft');
  await finishMotion(album);

  await back(page);
  await expect.poll(() => startedExits(page)).toBe(2);
  const interrupted = await pose(album, 0.5);
  await forward(page);
  await expect.poll(async () => (await pose(album)).active).toBe(true);
  // The 1h test effect bounds drift across the native traversal to far below
  // this tolerance, without assuming that reversal creates a new Animation.
  expect((await pose(album)).opacity).toBeCloseTo(interrupted.opacity, 2);
  expect(await page.evaluate(() => window.routeMotionFixture.albumExits[1].signal.aborted)).toBe(true);
  await page.evaluate(async () => {
    window.routeMotionFixture.albumExits[1].release();
    await new Promise(requestAnimationFrame);
  });
  expect(await album.evaluate((element, cached) => element === cached, original)).toBe(true);
  const draft = page.getByLabel('Album draft');
  await expect(draft).toHaveValue('Keep this draft');
  await draft.focus();
  await expect(draft).toBeFocused();
  await finishMotion(album);
  expect(await pose(album)).toEqual({ opacity: 1, active: false });
});

test('visibility-gated portals and native modals release focus while the page is retained for exit', async ({ page }) => {
  const album = await start(page, '?evict');
  const portal = page.getByRole('button', { name: 'Album action' });
  await page.evaluate(() => window.routeMotionFixture.openAlbum());
  await expect(portal).toBeVisible();
  expect(await portal.evaluate(element => element.closest('[data-testid=album-page]') === null)).toBe(true);
  await portal.focus();
  await expect(portal).toBeFocused();
  await album.locator('dialog').evaluate((dialog: HTMLDialogElement) => dialog.showModal());
  await expect(album.locator('dialog:modal')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Inside modal' })).toBeFocused();
  await finishMotion(album);

  // Replace the entry without replacing the layout instance that owns the slot.
  await page.evaluate(() => window.routeMotionFixture.replaceWithHome());
  await expect.poll(() => startedExits(page)).toBe(1);
  await expect(album).toHaveAttribute('inert', '');
  await expect(page.getByTestId('album-portal-control')).toHaveCount(0);
  await expect(portal).toHaveCount(0);
  await expect(album.locator('dialog')).toHaveCount(0);
  const incoming = page.getByLabel('Home draft');
  await incoming.focus();
  await expect(incoming).toBeFocused();
  await finishMotion(album);
  await expect(album).toHaveCount(1);
  await page.evaluate(() => window.routeMotionFixture.albumExits[0].release());
  await expect(album).toHaveCount(0);
});

test('retained page keeps its percentage layout box and its direct-child CSS transition', async ({ page }) => {
  await start(page);
  const cssPage = page.locator('.css-page');
  await page.evaluate(() => window.routeMotionFixture.openCssPage());
  await expect(cssPage).toHaveClass('css-page selected');
  await finishMotion(cssPage);
  const liveBox = await cssPage.boundingBox();
  expect(liveBox?.width).toBe(200); // 50% of the 400px slot, plus 20px margins outside the box.

  await back(page);
  await expect(page.locator('.library-slot > .css-page[data-kinetic-router-outgoing]')).toHaveCount(1);
  expect(await cssPage.boundingBox()).toEqual(liveBox);
  expect(await cssPage.evaluate(element => element.getAnimations()
    .some(effect => effect instanceof CSSTransition && effect.transitionProperty === 'opacity'))).toBe(true);
  expect(await pose(cssPage, 0.5)).toEqual({ opacity: 0.5, active: true });
  await finishMotion(cssPage);
  await expect(cssPage).toHaveCount(0);

  await forward(page);
  await expect(cssPage).not.toHaveAttribute('inert');
  await expect(cssPage).not.toHaveAttribute('data-kinetic-router-outgoing');
  await page.locator('.library-slot').evaluate((element: HTMLElement) => { element.style.width = '600px'; });
  expect((await cssPage.boundingBox())?.width).toBe(300);
});

test('reduced motion snaps the opted-in page but preserves the explicit exit gate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const album = await start(page);
  await page.evaluate(() => window.routeMotionFixture.openAlbum());
  expect(await pose(album)).toEqual({ opacity: 1, active: false });
  expect(await pose(album.getByTestId('local-card'))).toEqual({ opacity: 1, active: false });
  await back(page);
  await expect.poll(() => startedExits(page)).toBe(1);
  expect((await pose(album)).active).toBe(false);
  await page.evaluate(() => window.routeMotionFixture.albumExits[0].release());
  await expect(album).toHaveCount(0);
  await forward(page);
  expect(await pose(album)).toEqual({ opacity: 1, active: false });
});
