import { expect, test, type Locator } from '@playwright/test';

async function finishMotion(slots: Locator) {
  await slots.evaluateAll(elements => {
    for (const element of elements) {
      for (const animation of element.getAnimations({ subtree: true })) animation.finish();
    }
  });
}

async function pauseMotion(slot: Locator) {
  await slot.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) animation.pause();
  });
}

async function spaceAt(slot: Locator, progress: number) {
  return slot.evaluate((element, progress) => {
    const animation = element.getAnimations().find(animation =>
      animation instanceof CSSTransition && animation.transitionProperty === 'grid-template-rows',
    );
    if (!animation) throw new Error('Expected a native grid-track transition');
    animation.pause();
    animation.currentTime = Number(animation.effect!.getTiming().duration) * progress;
    return element.getBoundingClientRect().height;
  }, progress);
}

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/todos');
  await expect(page.locator('.todo-slot')).toHaveCount(4);
  await finishMotion(page.locator('.todo-slot'));
});
test.afterEach(() => expect(errors).toEqual([]));

test('Undo reverses a retained row and its space without losing DOM or local input state', async ({ page }) => {
  const card = page.locator('.todo-slot').first();
  const original = await card.elementHandle();
  await card.getByRole('textbox').fill('The duck understands generics now');
  await card.getByRole('button').click();
  const retained = page.locator('.todo-slot[data-phase="exiting"]');
  await pauseMotion(retained);
  const halfway = await spaceAt(retained, 0.5);
  await expect(retained).toHaveJSProperty('inert', true);
  await expect(retained).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByLabel('Your next very important mission')).toBeFocused();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card).toHaveAttribute('data-phase', 'present');
  expect(await card.evaluate((element, original) => element === original, original)).toBe(true);
  expect(Math.abs(await spaceAt(card, 0) - halfway)).toBeLessThan(1);
  await expect(card.getByRole('textbox')).toHaveValue('The duck understands generics now');
  await expect(card).toHaveJSProperty('inert', false);
  await finishMotion(card);
});

for (const mobile of [false, true]) {
  test(`cards grow and shrink their full spacing without a disposal jump (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const stage = page.locator('.todos-stage');
    const baseline = await stage.evaluate(element => element.getBoundingClientRect().height);
    await page.getByLabel('Your next very important mission').fill('A mission with a smooth landing');
    await page.getByRole('button', { name: 'Add a little drama' }).click();
    const added = page.locator('.todo-slot').last();
    await pauseMotion(added);
    expect(await spaceAt(added, 0)).toBeLessThan(1);
    expect(Math.abs(await stage.evaluate(element => element.getBoundingClientRect().height) - baseline)).toBeLessThan(1);
    const enteringHalfway = await spaceAt(added, 0.5);
    const enteringEnd = await spaceAt(added, 0.99);
    expect(enteringHalfway).toBeGreaterThan(1);
    expect(enteringEnd).toBeGreaterThan(enteringHalfway);
    await finishMotion(added);

    const card = page.locator('.todo-slot').first();
    const following = page.locator('.todo-slot').nth(1);
    const followingNode = await following.elementHandle();
    const fullHeight = await card.evaluate(element => element.getBoundingClientRect().height);
    await card.getByRole('button').click();
    await pauseMotion(card);
    const exitingStart = await spaceAt(card, 0);
    const exitingHalfway = await spaceAt(card, 0.5);
    const exitingEnd = await spaceAt(card, 0.99);
    expect(Math.abs(exitingStart - fullHeight)).toBeLessThan(1);
    expect(exitingHalfway).toBeGreaterThan(1);
    expect(exitingHalfway).toBeLessThan(exitingStart);
    expect(exitingEnd).toBeLessThan(1);
    const beforePruning = await followingNode!.evaluate(element => element.getBoundingClientRect().top + scrollY);
    await finishMotion(card);
    await expect(page.locator('.todo-slot')).toHaveCount(4);
    const afterPruning = await followingNode!.evaluate(element => element.getBoundingClientRect().top + scrollY);
    expect(Math.abs(afterPruning - beforePruning)).toBeLessThan(1);
  });
}

test('the empty-state Show also grows and collapses its space before disposal', async ({ page }) => {
  await page.getByRole('button', { name: 'Complete all', exact: true }).click();
  await finishMotion(page.locator('.todo-slot'));
  await expect(page.locator('.todo-slot')).toHaveCount(0);
  const victory = page.locator('.todos-victory-slot');
  await pauseMotion(victory);
  expect(await spaceAt(victory, 0)).toBeLessThan(1);
  const enteringHalfway = await spaceAt(victory, 0.5);
  const enteringEnd = await spaceAt(victory, 0.99);
  expect(enteringHalfway).toBeGreaterThan(1);
  expect(enteringEnd).toBeGreaterThan(enteringHalfway);
  await finishMotion(victory);
  await expect(page.getByRole('heading', { name: 'All done. All glory.' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Zero tasks. Maximum glory.');
  await page.getByLabel('Your next very important mission').fill('Plan the victory parade');
  await page.getByRole('button', { name: 'Add a little drama' }).click();
  await pauseMotion(victory);
  const exitingStart = await spaceAt(victory, 0);
  const exitingHalfway = await spaceAt(victory, 0.5);
  const exitingEnd = await spaceAt(victory, 0.99);
  expect(exitingStart).toBeGreaterThan(exitingHalfway);
  expect(exitingHalfway).toBeGreaterThan(1);
  expect(exitingEnd).toBeLessThan(1);
  await expect(victory).toHaveAttribute('data-phase', 'exiting');
  await expect(victory).toHaveAttribute('aria-hidden', 'true');
  // Hold the entering card at zero so it doesn't mask the banner's layout change.
  const added = page.locator('.todo-slot');
  await pauseMotion(added);
  await spaceAt(added, 0);
  const stage = page.locator('.todos-stage');
  const beforePruning = await stage.evaluate(element => element.getBoundingClientRect().height);
  await finishMotion(victory);
  await expect(victory).toHaveCount(0);
  const afterPruning = await stage.evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(afterPruning - beforePruning)).toBeLessThan(1);
  await finishMotion(added);
  await expect(page.locator('.todo-card h2')).toHaveText('Plan the victory parade');
});

for (const banner of [false, true]) {
  for (const entering of [false, true]) {
    test(`${entering ? 'entering' : 'exiting'} ${banner ? 'banner' : 'card'} remains visible outside its shrinking slot`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1800 });
      if (banner) {
        await page.getByRole('button', { name: 'Complete all', exact: true }).click();
        await finishMotion(page.locator('.todo-slot'));
        await expect(page.locator('.todo-slot')).toHaveCount(0);
        if (!entering) {
          await finishMotion(page.locator('.todos-victory-slot'));
          await page.getByLabel('Your next very important mission').fill('Start another mission');
          await page.getByRole('button', { name: 'Add a little drama' }).click();
        }
      } else if (entering) {
        await page.getByLabel('Your next very important mission').fill('Fly beyond the layout slot');
        await page.getByRole('button', { name: 'Add a little drama' }).click();
      } else {
        await page.locator('.todo-slot').first().getByRole('button').click();
      }
      const slot = banner ? page.locator('.todos-victory-slot') : entering
        ? page.locator('.todo-slot').last() : page.locator('.todo-slot').first();
      await pauseMotion(slot);
      await spaceAt(slot, entering ? 0.01 : 0.99);
      const probe = await slot.evaluate((element, banner) => {
        const visual = element.querySelector<HTMLElement>(banner ? '.todos-victory' : '.todo-card')!;
        const motion = visual.getAnimations()[0]!;
        motion.currentTime = Number(motion.effect!.getTiming().duration) * 0.7;
        const bounds = visual.getBoundingClientRect();
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        // Inert intentionally disables hit testing. Temporarily lift it only to
        // probe painting outside the slot; no events are dispatched.
        const inert = (element as HTMLElement).inert;
        (element as HTMLElement).inert = false;
        try {
          return {
            outsideSlot: y > element.getBoundingClientRect().bottom + 5,
            visible: visual.contains(document.elementFromPoint(x, y)),
          };
        } finally {
          (element as HTMLElement).inert = inert;
        }
      }, banner);
      expect(probe.outsideSlot).toBe(true);
      expect(probe.visible).toBe(true);
      await finishMotion(slot);
    });
  }
}

test('reduced motion, form validation, mobile layout, and cached navigation work together', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByLabel('Your next very important mission');
  await input.fill('   ');
  await page.getByRole('button', { name: 'Add a little drama' }).click();
  await expect(page.locator('.todo-slot')).toHaveCount(4);
  await input.fill('Remember to take a bow');
  await input.press('Enter');
  await expect(page.locator('.todo-slot')).toHaveCount(5);
  await expect(input).toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to the homepage!' })).toBeVisible();
  await page.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(page.locator('.todo-slot')).toHaveCount(5);
  await page.getByRole('button', { name: 'Complete all', exact: true }).click();
  await expect(page.locator('.todo-slot')).toHaveCount(0);
  await expect(page.locator('.todos-victory')).toHaveCSS('opacity', '1');
  expect(await page.locator('.todos-confetti').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test('enabling reduced motion during exit settles both layout and decorative motion', async ({ page }) => {
  await page.getByRole('button', { name: 'Complete all', exact: true }).click();
  await expect(page.locator('.todo-slot[data-phase="exiting"]')).toHaveCount(4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.todo-slot')).toHaveCount(0);
  await expect(page.locator('.todos-victory')).toHaveCSS('opacity', '1');
  expect(await page.locator('.todos-victory-slot').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(1);
});
