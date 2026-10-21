import { test, expect } from './helpers.js';

test('cached pages keep a moving, ten-second fingerprint border even without animate timeline options', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    // Older browsers ignore this optional dictionary member. The animation must
    // not end up on the inert template document's timeline in that case.
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(keyframes, options) {
      if (options && typeof options === 'object') {
        const { timeline, ...timing } = options;
        return animate.call(this, keyframes, timing);
      }
      return animate.call(this, keyframes, options);
    };
  });
  await page.goto('/home?scenario=links&checks=manual');
  const app = page.getByTestId('scenario-app');
  const badge = app.getByTestId('page-fingerprint');
  await expect(badge).toBeVisible();
  const homeId = (await badge.getAttribute('data-instance'))!;
  const home = (await badge.elementHandle())!;
  const border = badge.locator('rect');
  await expect.poll(() => border.evaluate(rect => rect.getAnimations().length)).toBe(1);
  const animation = await border.evaluateHandle(rect => rect.getAnimations()[0]);
  expect(await animation.evaluate(animation => animation.effect!.getTiming().duration)).toBe(10_000);
  expect(await animation.evaluate(animation => animation.timeline === document.timeline)).toBe(true);
  const firstTime = await animation.evaluate(animation => Number(animation.currentTime));
  await expect.poll(() => animation.evaluate(animation => Number(animation.currentTime))).toBeGreaterThan(firstTime);
  expect(await badge.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('repeating-conic-gradient');

  // Check painted output, not just the existence of an Animation object.
  await animation.evaluate(animation => { animation.pause(); animation.currentTime = 0; });
  const initial = await badge.screenshot();
  await animation.evaluate(animation => { animation.currentTime = 2500; });
  expect((await badge.screenshot()).equals(initial)).toBe(false);
  await animation.evaluate(animation => { animation.currentTime = 10_000; });
  expect((await badge.screenshot()).equals(initial)).toBe(true);
  await animation.evaluate(animation => animation.play());

  await app.getByRole('link', { name: 'About', exact: true }).click();
  await expect(app.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
  const aboutId = (await badge.getAttribute('data-instance'))!;
  expect(aboutId).not.toBe(homeId);

  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(badge).toHaveAttribute('data-instance', homeId);
  expect(await home.evaluate(element => element === document.querySelector('[data-testid="scenario-app"] [data-testid="page-fingerprint"]'))).toBe(true);
  expect(await border.evaluate((rect, previous) => rect.getAnimations()[0] === previous, animation)).toBe(true);

  await app.getByRole('button', { name: 'Forward', exact: true }).click();
  await expect(badge).toHaveAttribute('data-instance', aboutId);
});

test('fingerprints respond to reduced-motion preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/home?scenario=links&checks=manual');
  const badge = page.getByTestId('scenario-app').getByTestId('page-fingerprint');
  await expect(badge).toBeVisible();
  const border = badge.locator('rect');
  const animations = () => border.evaluate(rect => rect.getAnimations().length);
  await expect.poll(animations).toBe(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(animations).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animations).toBe(0);
});
