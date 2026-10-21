import { expect, test } from '@playwright/test'

let errors: string[]
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByLabel('Exit duration').fill('5000')
})

// Include asynchronous promise/WAAPI failures, not just initial render errors.
test.afterEach(() => { expect(errors).toEqual([]) })

test('separate CSS entry is hidden on its first frame and finishes before a queued exit', async ({ page }) => {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Separate in / out', exact: true }) })
  const toggle = section.getByRole('button', { name: 'Toggle separate' })
  const firstFrame = page.evaluate(() => new Promise<number>(resolve => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector('.css-separate')
      if (!element) return
      observer.disconnect()
      requestAnimationFrame(() => resolve(Number(getComputedStyle(element).opacity)))
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }))
  await toggle.click()
  expect(await firstFrame).toBe(0) // fill-mode applies the first keyframe during the delay
  const card = section.locator('.card')
  await expect(card).toHaveAttribute('data-runs', 'in')
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  await expect(card).toHaveAttribute('data-runs', 'in')
  await card.evaluate(element => element.getAnimations().forEach(animation => animation.finish()))
  await expect(card).toHaveAttribute('data-runs', 'in,out')
  await card.evaluate(element => element.getAnimations().forEach(animation => animation.finish()))
  await expect(card).toHaveCount(0)
})

test('CSS motion respects reduced motion, including the entry delay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Toggle separate' }).click()
  const separate = page.locator('.css-separate')
  await expect(separate).toHaveCSS('animation-duration', '0.001s')
  await expect(separate).toHaveCSS('animation-delay', '0s')
  await page.getByRole('button', { name: 'Toggle separate' }).click()
  await expect(separate).toHaveCount(0)

  await page.getByRole('button', { name: 'Toggle bidirectional' }).click()
  const bidirectional = page.locator('.css-inout')
  await expect(bidirectional).toHaveCSS('transition-duration', '0.001s')
  await page.getByRole('button', { name: 'Toggle bidirectional' }).click()
  await expect(bidirectional).toHaveCount(0)
})

test('CSS inout starts from its initial style and reverses mid-flight without snapping or remounting', async ({ page }) => {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Bidirectional inout', exact: true }) })
  const toggle = section.getByRole('button', { name: 'Toggle bidirectional' })
  const firstFrame = page.evaluate(() => new Promise<number>(resolve => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector('.css-inout')
      if (!element) return
      observer.disconnect()
      requestAnimationFrame(() => resolve(Number(getComputedStyle(element).opacity)))
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }))
  await toggle.click()
  expect(await firstFrame).toBeLessThan(0.05)
  const card = section.locator('.card')
  await expect(card).toHaveAttribute('data-runs', 'in')
  const instance = await card.locator('code').textContent()
  await card.evaluate(element => {
    const animation = element.getAnimations()[0]!
    animation.pause()
    animation.currentTime = Number(animation.effect!.getComputedTiming().duration) / 2
  })
  await card.getByRole('textbox').fill('same instance')
  await toggle.click()
  await expect(card).toHaveAttribute('data-runs', 'in,out')
  const opacity = await card.evaluate(element => Number(getComputedStyle(element).opacity))
  expect(opacity).toBeGreaterThan(0.2)
  expect(opacity).toBeLessThan(0.8)
  await toggle.click()
  await expect(card).toHaveAttribute('data-runs', 'in,out,in')
  await expect(card.locator('code')).toHaveText(instance!)
  await expect(card.getByRole('textbox')).toHaveValue('same instance')
  await card.evaluate(element => element.getAnimations().forEach(animation => animation.finish()))
  await expect(card).toHaveCSS('opacity', '1')
  await toggle.click()
  await expect(card).toHaveAttribute('data-runs', 'in,out,in,out')
  await card.evaluate(element => element.getAnimations().forEach(animation => animation.finish()))
  await expect(card).toHaveCount(0)
})

test('Show keeps real event handlers and local state alive through WAAPI cancellation', async ({ page }) => {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Show', exact: true }) })
  const toggle = section.getByRole('button', { name: 'Toggle modal' })
  await toggle.click()
  const card = section.locator('.card')
  const instance = await card.locator('code').textContent()
  await card.getByRole('textbox').fill('keep my state')
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  await card.getByRole('button', { name: 'Still interactive: 0' }).click()
  await expect(card.getByRole('button')).toHaveText('Still interactive: 1')
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'present')
  await expect(card.locator('code')).toHaveText(instance!)
  await expect(card.getByRole('textbox')).toHaveValue('keep my state')
  await expect(card).toHaveCSS('opacity', '1')
  // Cancelled animation.finished rejects; it must not remove the reused instance.
  await page.waitForTimeout(100)
  await expect(card).toBeVisible()
  await page.getByLabel('Exit duration').fill('500')
  await toggle.click()
  await expect(card).toHaveCount(0)
})

test('For preserves keyed DOM instances across replacement, removal and reorder', async ({ page }) => {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Keyed For', exact: true }) })
  const alpha = section.locator('.card').filter({ has: page.getByText('1. Alpha', { exact: true }) })
  await alpha.getByRole('textbox').fill('alpha state')
  const instance = (await alpha.locator('code').textContent())!.split(' · ')[0]
  await section.getByRole('button', { name: 'Remove first' }).click()
  await expect(alpha).toHaveAttribute('data-phase', 'exiting')
  await expect(section.locator('.card').first().locator('strong')).toHaveText('1. Alpha')
  await section.getByRole('button', { name: 'Restore all' }).click()
  await section.getByRole('button', { name: 'Update objects, same keys' }).click()
  await section.getByRole('button', { name: 'Reverse', exact: true }).click()
  const restored = section.locator('.card').filter({ has: page.getByText('3. Alpha!', { exact: true }) })
  await expect(restored.getByRole('textbox')).toHaveValue('alpha state')
  await expect(restored.locator('code')).toHaveText(`${instance} · present`)
  await page.getByLabel('Exit duration').fill('500')
  await section.getByRole('button', { name: 'Remove all' }).click()
  await expect(section.locator('.card')).toHaveCount(0)
})

test('nested flows animate only their own data changes', async ({ page }) => {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Independent nested flows', exact: true }) })
  const parent = section.locator('.card').first()
  const child = section.locator('.card').filter({ has: page.getByText('Child', { exact: true }) }).last()
  const instance = await child.locator('code').textContent()
  await child.getByRole('textbox').fill('nested state')
  await section.getByRole('button', { name: 'Toggle parent' }).click()
  await expect(parent).toHaveAttribute('data-phase', 'exiting')
  await expect(child).toHaveAttribute('data-phase', 'present')
  expect(await child.evaluate(element => element.getAnimations().length)).toBe(0)
  await section.getByRole('button', { name: 'Toggle parent' }).click()
  await expect(child.locator('code')).toHaveText(instance!)
  await expect(child.getByRole('textbox')).toHaveValue('nested state')

  await section.getByRole('button', { name: 'Toggle parent' }).click()
  await section.getByRole('button', { name: 'Toggle child' }).click()
  await expect(child).toHaveAttribute('data-phase', 'exiting')
  await expect(child).toHaveCount(0)
  await expect(parent).toHaveAttribute('data-phase', 'exiting')
  // Restoring the parent must not resurrect a child removed by its own data.
  await section.getByRole('button', { name: 'Toggle parent' }).click()
  await expect(parent).toHaveAttribute('data-phase', 'present')
  await expect(child).toHaveCount(0)
})
