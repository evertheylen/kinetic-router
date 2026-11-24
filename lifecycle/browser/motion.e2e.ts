import { expect, test, type Locator, type Page } from '@playwright/test'

test.use({ reducedMotion: 'no-preference' })

let errors: string[]
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
})
test.afterEach(() => { expect(errors).toEqual([]) })

function studio(page: Page) {
  const root = page.getByRole('region', { name: 'Postcard studio', exact: true })
  return {
    card: page.locator('.postcard-studio li.postcard'),
    discard: root.getByRole('button', { name: 'Discard draft', exact: true }),
    undo: root.getByRole('button', { name: 'Undo discard', exact: true }),
    newDraft: root.getByRole('button', { name: 'New postcard', exact: true }),
    tilt: root.getByRole('button', { name: 'Tilt postcard', exact: true }),
    slow: root.getByRole('checkbox', { name: 'Slow preview', exact: true }),
  }
}

async function finishMotion(card: Locator) {
  await card.evaluate(async element => {
    const finished = element.getAnimations().map(animation => {
      const completion = animation.finished
      animation.finish()
      return completion
    })
    // The owner can cancel its effect as soon as finishing releases the exit.
    await Promise.allSettled(finished)
  })
}

async function pose(card: Locator, progress?: number) {
  if (progress !== undefined) {
    await expect.poll(() => card.evaluate(element => element.getAnimations().some(animation =>
      animation.pending || animation.playState === 'running' || animation.playState === 'paused',
    ))).toBe(true)
  }
  return card.evaluate(async (element, progress) => {
    const effects = element.getAnimations().filter(animation =>
      animation.pending || animation.playState === 'running' || animation.playState === 'paused',
    )
    if (progress !== undefined) {
      for (const animation of effects) animation.pause()
      await Promise.all(effects.map(animation => animation.ready))
      for (const animation of effects) {
        const { delay = 0, duration } = animation.effect!.getTiming()
        // At zero, also check the pose presented during the delay.
        animation.currentTime = progress === 0 ? 0 : delay + Number(duration) * progress
      }
    }
    const style = getComputedStyle(element)
    const transform = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform)
    return {
      opacity: Number(style.opacity),
      x: transform.m41,
      y: transform.m42,
      degrees: Math.atan2(transform.b, transform.a) * 180 / Math.PI,
      scale: Math.hypot(transform.a, transform.b),
      effects: effects.map(animation => ({
        native: animation.constructor === Animation && animation.effect instanceof KeyframeEffect,
        timing: animation.effect!.getTiming(),
      })),
    }
  }, progress)
}

async function openSlowDraft(page: Page, tilted = false) {
  const controls = studio(page)
  await finishMotion(controls.card)
  await controls.slow.check()
  await controls.discard.click()
  await finishMotion(controls.card)
  if (tilted) await controls.tilt.click()
  await controls.newDraft.click()
  return controls
}

test('Motion targets the custom list item directly with partial initial targets and native timing in seconds', async ({ page }) => {
  const { card } = await openSlowDraft(page, true)
  const list = page.getByRole('list', { name: 'Draft tray', exact: true })
  await expect(list).toHaveJSProperty('tagName', 'UL')
  await expect(list.locator(':scope > *')).toHaveCount(1)
  await expect(list.locator(':scope > li.postcard')).toHaveCount(1)

  const start = await pose(card, 0)
  expect(start.effects.length).toBeGreaterThan(0)
  expect(await card.evaluate(element => {
    const effects = element.getAnimations({ subtree: true }).map(animation => animation.effect)
    return effects.length > 0 && effects.every(effect => effect instanceof KeyframeEffect && effect.target === element)
  })).toBe(true)
  for (const effect of start.effects) {
    expect(effect.native).toBe(true)
    expect(effect.timing).toMatchObject({ duration: 4000, delay: 125, easing: 'ease-out' })
  }
  expect(start.opacity).toBeCloseTo(0.65)
  expect(start.y).toBeGreaterThan(18)
  expect(start.y).toBeLessThan(28)
  expect(start.degrees).toBeCloseTo(-5)
  expect(start.scale).toBeCloseTo(0.94)

  await finishMotion(card)
  const rest = await pose(card)
  expect(rest.opacity).toBe(1)
  expect(rest.x).toBeGreaterThan(25) // the numeric x target is 28px
  expect(rest.x).toBeLessThan(31)
  expect(start.x).toBeCloseTo(rest.x, -1)
  expect(Math.abs(rest.y)).toBeLessThan(3)
  expect(rest.degrees).toBeCloseTo(start.degrees)
  expect(rest.scale).toBeCloseTo(start.scale)
})

test('reactive animate retargets from the displayed pose with the latest timing', async ({ page }) => {
  const { card, tilt, slow } = studio(page)
  await finishMotion(card)
  await slow.check()
  await tilt.click()
  await expect(tilt).toHaveAttribute('aria-pressed', 'true')
  const moving = await pose(card, 0.5)
  expect(moving.x).toBeGreaterThan(5)
  expect(moving.x).toBeLessThan(27)
  expect(moving.effects.map(effect => effect.timing.duration)).toEqual(moving.effects.map(() => 4000))

  await slow.uncheck()
  expect((await pose(card)).effects).toEqual(moving.effects)
  await tilt.click()
  const retargeted = await pose(card, 0)
  expect(retargeted.effects.map(effect => effect.timing.duration)).toEqual(retargeted.effects.map(() => 1100))
  expect(retargeted.x).toBeCloseTo(moving.x, 1)
  expect(retargeted.degrees).toBeCloseTo(moving.degrees, 1)
  await finishMotion(card)
  const rest = await pose(card)
  expect(rest.x).toBeCloseTo(0)
  expect(rest.degrees).toBeCloseTo(0)
  expect(rest.scale).toBeCloseTo(1)
})

test('a newly claimed transform animates from authored CSS and stays owned on omission', async ({ page }) => {
  const { tilt, slow } = studio(page)
  await page.addStyleTag({ content: '.postcard-tools button[aria-pressed] { transform: scale(0.9); }' })
  expect((await pose(tilt)).scale).toBeCloseTo(0.9)
  await slow.check()
  await tilt.click()
  const start = await pose(tilt, 0)
  expect(start.scale).toBeCloseTo(0.9)
  expect(start.opacity).toBeCloseTo(1)
  expect(start.effects).toHaveLength(1)
  const middle = await pose(tilt, 0.5)
  expect(middle.scale).toBeGreaterThan(0.9)
  expect(middle.scale).toBeLessThan(1.05)
  await finishMotion(tilt)
  expect((await pose(tilt)).scale).toBeCloseTo(1.05)

  await tilt.click()
  await finishMotion(tilt)
  expect(await pose(tilt)).toMatchObject({ scale: 1, opacity: 1 })
})

test('an interrupted motion target snaps while the element is disconnected', async ({ page }) => {
  const { card, tilt, slow } = studio(page)
  await finishMotion(card)
  await slow.check()
  await tilt.click()
  await pose(card, 0.5)
  const active = await card.evaluateHandle(element => element.getAnimations()[0]!)
  const original = (await card.elementHandle())!
  const parent = await original.evaluateHandle(element => element.parentElement!)
  await original.evaluate(element => element.remove())
  await tilt.click()
  await expect.poll(() => active.evaluate(animation => animation.playState)).toBe('idle')
  await original.evaluate((element, parent) => { parent.append(element) }, parent)
  expect(await pose(card)).toMatchObject({ x: 0, y: 0, degrees: 0, scale: 1, opacity: 1, effects: [] })
})

test('keyboard Undo reenters from a partial exit, retaining the exact node and its draft', async ({ page }) => {
  const { card, discard, undo, newDraft } = await openSlowDraft(page, true)
  await finishMotion(card)
  const original = await card.elementHandle()
  const note = card.locator('input')
  await expect(card).toHaveAccessibleName('Afterglow postcard')
  await expect(discard).toHaveAttribute('type', 'button')
  expect((await pose(discard)).effects).toEqual([]) // initial={false}
  await note.fill('Keep this light')
  await note.press('Escape')
  await expect(undo).toBeFocused() // The card's own handler focuses the motion.button via its ref.
  await expect(card).toHaveJSProperty('inert', true)
  const exiting = await pose(card, 0.5)
  expect(exiting.opacity).toBeGreaterThan(0)
  expect(exiting.opacity).toBeLessThan(1)
  expect(exiting.degrees).toBeCloseTo(-5)
  expect(exiting.scale).toBeCloseTo(0.94)
  expect(await note.evaluate(input => {
    input.focus()
    return document.activeElement === input
  })).toBe(false)

  await undo.press('Enter')
  const reentering = await pose(card, 0)
  expect(reentering.opacity).toBeCloseTo(exiting.opacity, 2)
  expect(reentering.y).toBeCloseTo(exiting.y, 1)
  expect(await card.evaluate((element, original) => element === original, original)).toBe(true)
  await expect(card).toHaveJSProperty('inert', false)
  await expect(note).toHaveValue('Keep this light')
  await finishMotion(card)
  await expect(card).toHaveCSS('opacity', '1')

  await discard.click()
  await pose(card, 0.5)
  await finishMotion(card)
  await expect(card).toHaveCount(0)
  expect(await original!.evaluate(element => element.getAnimations().length)).toBe(0)
  await newDraft.click()
  await expect(note).toHaveValue('')
})

test('reduced motion settles a paused exit and skips motion and delays on later targets', async ({ page }) => {
  const { card, discard, newDraft, tilt } = await openSlowDraft(page)
  const reducedHint = page.getByText('Reduced motion is on', { exact: false })
  await expect(reducedHint).toBeHidden()
  await finishMotion(card)
  await discard.click()
  await pose(card, 0.5)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card).toHaveCount(0, { timeout: 2000 })
  await expect(reducedHint).toBeVisible()

  await newDraft.click()
  const entry = await pose(card)
  expect(entry.opacity).toBe(1)
  expect(entry.effects).toEqual([])
  await tilt.click()
  const target = await pose(card)
  expect(target.degrees).toBeCloseTo(-5)
  expect(target.effects).toEqual([])
  await discard.click()
  await expect(card).toHaveCount(0, { timeout: 2000 })
})
