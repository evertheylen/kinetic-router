import { expect, test } from '@playwright/test'

let errors: string[] = []
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByLabel('Motion duration', { exact: true }).fill('5000')
})
test.afterEach(() => { expect(errors).toEqual([]) })

test('prepares a hidden first frame, including the entrance delay', async ({ page }) => {
  await page.getByLabel('Motion delay', { exact: true }).fill('1000')
  const firstFrame = page.evaluate(() => new Promise<number>(resolve => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector('.motion-card')
      if (!element) return
      observer.disconnect()
      requestAnimationFrame(() => resolve(Number(getComputedStyle(element).opacity)))
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }))
  await page.getByRole('button', { name: 'Toggle motion', exact: true }).click()
  expect(await firstFrame).toBe(0)
  const card = page.locator('.motion-card')
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await expect(card).toHaveCSS('opacity', '1')
})

test('reverses the same native animation repeatedly without snapping or remounting', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  const instance = await card.locator('code').textContent()
  await card.getByRole('textbox').fill('retained')
  const animation = await card.evaluateHandle(element => {
    const animation = element.getAnimations()[0]!
    animation.pause()
    animation.currentTime = 2750 // delay + half of the active duration
    return animation
  })
  for (const rate of [-1, 1, -1, 1]) {
    await toggle.click()
    await expect.poll(() => animation.evaluate(animation => animation.playbackRate)).toBe(rate)
    expect(await card.evaluate((element, animation) => element.getAnimations()[0] === animation, animation)).toBe(true)
    const opacity = await card.evaluate(element => Number(getComputedStyle(element).opacity))
    expect(opacity).toBeGreaterThan(0.25)
    expect(opacity).toBeLessThan(0.75)
  }
  await expect(card.locator('code')).toHaveText(instance!)
  await expect(card.getByRole('textbox')).toHaveValue('retained')
  await animation.evaluate(animation => animation.finish())
  await expect(card).toHaveCSS('opacity', '1')
  await toggle.click()
  await expect.poll(() => animation.evaluate(animation => animation.playbackRate)).toBe(-1)
  await animation.evaluate(animation => animation.finish())
  await expect(card).toHaveCount(0)
  expect(await animation.evaluate(animation => animation.playState)).toBe('idle')
})

test('reversing at time zero does not rewind to the visible endpoint', async ({ page }) => {
  await page.getByLabel('Hold other work', { exact: true }).check()
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  await card.evaluate(element => {
    const animation = element.getAnimations()[0]!
    animation.pause()
    animation.currentTime = 0
  })
  await toggle.click()
  await expect(card).toHaveAttribute('data-pending', 'true')
  await expect(card).toHaveCSS('opacity', '0')
  expect(await card.evaluate(element => element.getAnimations()[0]!.currentTime)).toBe(0)
  await card.getByRole('button', { name: 'Release other work' }).click({ force: true })
  await expect(card).toHaveCount(0)
})

test('separate entry finishes before exit and a completed exit stays applied until other work finishes', async ({ page }) => {
  await page.getByLabel('Separate motion', { exact: true }).check()
  await page.getByLabel('Hold other work', { exact: true }).check()
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  const entering = await card.evaluateHandle(element => element.getAnimations()[0]!)
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  await expect(card).toHaveAttribute('data-pending', 'false')
  expect(await card.evaluate((element, entering) => element.getAnimations()[0] === entering, entering)).toBe(true)
  await entering.evaluate(animation => animation.finish())
  await expect(card).toHaveAttribute('data-pending', 'true')
  expect(await card.evaluate((element, entering) => element.getAnimations()[0] !== entering, entering)).toBe(true)
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await expect(card).toHaveCSS('opacity', '0')
  // The independent lifecycle handler, not the animation, still retains this owner.
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: 'Release other work' }).click({ force: true })
  await expect(card).toHaveCount(0)
})

test('separate exit cancellation restarts entry on the same instance', async ({ page }) => {
  await page.getByLabel('Separate motion', { exact: true }).check()
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  const instance = await card.locator('code').textContent()
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  const exiting = await card.evaluateHandle(element => element.getAnimations()[0]!)
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'present')
  await expect(card.locator('code')).toHaveText(instance!)
  expect(await exiting.evaluate(animation => animation.playState)).toBe('idle')
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await expect(card).toHaveCSS('opacity', '1')
})

for (const separate of [false, true]) {
  test(`reduced motion skips delays without skipping other work (${separate ? 'separate' : 'inout'})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByLabel('Motion delay', { exact: true }).fill('5000')
    await page.getByLabel('Separate motion', { exact: true }).setChecked(separate)
    await page.getByLabel('Hold other work', { exact: true }).check()
    const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
    await toggle.click()
    const card = page.locator('.motion-card')
    await expect(card).toHaveCSS('opacity', '1')
    await toggle.click()
    await expect(card).toHaveAttribute('data-pending', 'true')
    await expect(card).toHaveCSS('opacity', '0')
    await toggle.click()
    await expect(card).toHaveAttribute('data-pending', 'false')
    await expect(card).toHaveCSS('opacity', '1')
    await toggle.click()
    await expect(card).toHaveCSS('opacity', '0')
    await card.getByRole('button', { name: 'Release other work' }).click({ force: true })
    await expect(card).toHaveCount(0)
  })
}

test('a preference change finishes running motion in its current direction', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card).toHaveCSS('opacity', '1')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card).toHaveCount(0)
})

test('zero-duration motion settles at the correct endpoints', async ({ page }) => {
  await page.getByLabel('Motion duration', { exact: true }).fill('0')
  await page.getByLabel('Motion delay', { exact: true }).fill('0')
  await page.getByLabel('Hold other work', { exact: true }).check()
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  await expect(card).toHaveCSS('opacity', '1')
  await toggle.click()
  await expect(card).toHaveAttribute('data-pending', 'true')
  await expect(card).toHaveCSS('opacity', '0')
  await toggle.click()
  await expect(card).toHaveCSS('opacity', '1')
})

test('exit-only reentry restores styles and reduced motion cannot revive the cancelled effect', async ({ page }) => {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Show', exact: true }) })
  const toggle = section.getByRole('button', { name: 'Toggle modal' })
  await toggle.click()
  const card = section.locator('.card')
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await expect(card).toHaveCSS('opacity', '0.25')
  await toggle.click()
  await expect(card).toHaveCSS('opacity', '1')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card).toHaveCSS('opacity', '1')
  expect(await card.evaluate(element => element.getAnimations().length)).toBe(0)
})

test('snapshots settings rather than changing a running timeline', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle motion', exact: true }).click()
  const card = page.locator('.motion-card')
  await page.getByLabel('Motion duration', { exact: true }).fill('100')
  await page.getByLabel('Motion preset', { exact: true }).selectOption('slide')
  const effect = await card.evaluate(element => {
    const effect = element.getAnimations()[0]!.effect as KeyframeEffect
    return { duration: effect.getTiming().duration, frames: effect.getKeyframes() }
  })
  expect(effect.duration).toBe(5000)
  expect(effect.frames.every(frame => frame.transform === undefined)).toBe(true)
})

test('ordinary unmount cancels native animation and removes the preference listener', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle motion', exact: true }).click()
  const card = page.locator('.motion-card')
  const animation = await card.evaluateHandle(element => element.getAnimations()[0]!)
  await page.getByRole('button', { name: 'Unmount motion control', exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(await animation.evaluate(animation => animation.playState)).toBe('idle')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // A leaked preference listener would finish (and revive) the cancelled effect.
  expect(await animation.evaluate(animation => animation.playState)).toBe('idle')
})

for (const preset of ['scale', 'slide']) {
  test(`${preset} uses only explicit opacity/transform frames`, async ({ page }) => {
    await page.getByLabel('Motion preset', { exact: true }).selectOption(preset)
    await page.getByRole('button', { name: 'Toggle motion', exact: true }).click()
    const card = page.locator('.motion-card')
    const frames = await card.evaluate(element => (element.getAnimations()[0]!.effect as KeyframeEffect).getKeyframes())
    expect(frames).toHaveLength(2)
    expect(frames.every(frame => frame.transform !== undefined && frame.opacity !== undefined)).toBe(true)
    await card.evaluate(element => element.getAnimations()[0]!.finish())
    await expect(card).toHaveCSS('opacity', '1')
    await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  })
}
