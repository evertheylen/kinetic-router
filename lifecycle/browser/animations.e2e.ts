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

for (const separate of [false, true]) {
  test(`nested Loading preserves first frames and starts motion after reveal (${separate ? 'separate' : 'inout'})`, async ({ page }) => {
    await page.getByLabel('Exit duration', { exact: true }).fill('500')
    await page.getByLabel('Separate suspended motion', { exact: true }).setChecked(separate)
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Suspended motion', exact: true }) })
    await section.getByRole('button', { name: 'Toggle suspended motion', exact: true }).click()
    await expect(section.getByText('Loading motion…', { exact: true })).toBeVisible()
    // Longer than both 500ms animations plus their 250ms entrance delays:
    // playback during suspension would have finished before the reveal.
    await page.waitForTimeout(1000)
    const firstFrame = section.evaluate(section => new Promise<number[]>(resolve => {
      const observer = new MutationObserver(() => {
        const native = section.querySelector('.motion-card')
        const css = section.querySelector('.css-inout, .css-separate')
        if (!native || !css) return
        observer.disconnect()
        requestAnimationFrame(() => resolve([native, css].map(element => Number(getComputedStyle(element).opacity))))
      })
      observer.observe(section, { childList: true, subtree: true })
    }))
    await section.getByRole('button', { name: 'Resolve motion loading', exact: true }).click()
    const [nativeOpacity, cssOpacity] = await firstFrame
    expect(nativeOpacity).toBe(0)
    expect(cssOpacity).toBeLessThan(0.1)
    const native = section.locator('.motion-card'), css = section.locator('.css-inout, .css-separate')
    // This diagnostic is recorded only by a connected CSS run, not preparation.
    await expect(css).toHaveAttribute('data-runs', 'in')
    await expect.poll(() => native.evaluate(element => element.getAnimations()[0]!.playState)).toBe('running')
    await native.evaluate(element => {
      const animation = element.getAnimations()[0]!
      animation.pause(); animation.currentTime = 500 // delay + half the active duration
    })
    expect(await native.evaluate(element => Number(getComputedStyle(element).opacity))).toBeCloseTo(0.5, 1)
    await section.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.finish()))
    await expect(native).toHaveCSS('opacity', '1')
    await expect(css).toHaveCSS('opacity', '1')
    await section.getByRole('button', { name: 'Toggle suspended motion', exact: true }).click()
    await expect(css).toHaveAttribute('data-runs', 'in,out')
    await section.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.finish()))
    await expect(section.locator('.card')).toHaveCount(0)
  })
}

test('removing a pending Loading boundary does not wait for or later mount its animations', async ({ page }) => {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Suspended motion', exact: true }) })
  const toggle = section.getByRole('button', { name: 'Toggle suspended motion', exact: true })
  await toggle.click()
  await expect(section.getByText('Loading motion…', { exact: true })).toBeVisible()
  await toggle.click()
  await expect(section.getByText('Loading motion…', { exact: true })).toHaveCount(0)
  await section.getByRole('button', { name: 'Resolve motion loading', exact: true }).click()
  await expect(section.locator('.card')).toHaveCount(0)
  await toggle.click()
  await section.getByRole('button', { name: 'Resolve motion loading', exact: true }).click()
  await expect(section.locator('.card')).toHaveCount(2)
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

test('CSS adapter ignores unrelated decorations and descendant effects', async ({ page }) => {
  await page.addStyleTag({ content: `
    @keyframes unrelated { from { outline-color: red; } to { outline-color: blue; } }
    .css-inout { animation: unrelated 60s linear infinite; }
    .css-inout input { animation: unrelated 60s linear; }
  ` })
  const toggle = page.getByRole('button', { name: 'Toggle bidirectional' })
  await toggle.click()
  const card = page.locator('.css-inout')
  const finishTransition = () => card.evaluate(element => {
    for (const animation of element.getAnimations()) if (animation instanceof CSSTransition) animation.finish()
  })
  await finishTransition()
  await toggle.click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  await finishTransition()
  await expect(card).toHaveCount(0)
})

test('CSS cancellation settles exit without an unhandled rejection', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Toggle bidirectional' })
  await toggle.click()
  const card = page.locator('.css-inout')
  await card.evaluate(element => element.getAnimations().forEach(animation => animation.finish()))
  await toggle.click()
  await card.evaluate(element => element.getAnimations().forEach(animation => animation.cancel()))
  await expect(card).toHaveCount(0)
})

test('CSS reduced motion skips delays even without cooperating media rules', async ({ page }) => {
  await page.addStyleTag({ content: '.css-separate[data-direction] { animation-duration: 10s; animation-delay: 10s; }' })
  const toggle = page.getByRole('button', { name: 'Toggle separate' })
  await toggle.click()
  const card = page.locator('.css-separate')
  await expect(card).toHaveCSS('opacity', '0')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card).toHaveCSS('opacity', '1')
  await toggle.click()
  await expect(card).toHaveCount(0)
})

test('even explicitly named infinite CSS animations cannot pin a boundary', async ({ page }) => {
  await page.addStyleTag({ content: '.css-separate[data-direction] { animation-iteration-count: infinite; }' })
  const toggle = page.getByRole('button', { name: 'Toggle separate' })
  await toggle.click()
  await toggle.click()
  await expect(page.locator('.css-separate')).toHaveCount(0)
})

test('directional durations retime one native effect without changing its progress or delay', async ({ page }) => {
  await page.getByLabel('Directional duration', { exact: true }).check()
  await page.getByLabel('Exit motion duration', { exact: true }).fill('1000')
  await page.getByLabel('Motion delay', { exact: true }).fill('1000')
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  const animation = await card.evaluateHandle(element => {
    const animation = element.getAnimations()[0]!
    animation.pause(); animation.currentTime = 3500
    return animation
  })
  for (const duration of [1000, 5000, 1000]) {
    await toggle.click()
    await expect.poll(() => animation.evaluate(animation => animation.effect!.getTiming().duration)).toBe(duration)
    await animation.evaluate(animation => animation.pause())
    expect(await card.evaluate((element, animation) => element.getAnimations()[0] === animation, animation)).toBe(true)
    const opacity = await card.evaluate(element => Number(getComputedStyle(element).opacity))
    expect(opacity).toBeGreaterThan(0.35)
    expect(opacity).toBeLessThan(0.65)
    expect(await animation.evaluate(animation => animation.effect!.getTiming().delay)).toBe(1000)
  }
  await animation.evaluate(animation => animation.finish())
  await expect(card).toHaveCount(0)
})

for (const inward of [0, 5000]) {
  test(`zero directional duration keeps the correct endpoint (entry ${inward}ms)`, async ({ page }) => {
    await page.getByLabel('Directional duration', { exact: true }).check()
    await page.getByLabel('Motion duration', { exact: true }).fill(String(inward))
    await page.getByLabel('Exit motion duration', { exact: true }).fill(inward === 0 ? '5000' : '0')
    await page.getByLabel('Motion delay', { exact: true }).fill('0')
    await page.getByLabel('Hold other work', { exact: true }).check()
    const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
    await toggle.click()
    const card = page.locator('.motion-card')
    await card.evaluate(element => element.getAnimations()[0]!.finish())
    await expect(card).toHaveCSS('opacity', '1')
    await toggle.click()
    if (inward === 0) {
      const opacity = await card.evaluate(element => Number(getComputedStyle(element).opacity))
      expect(opacity).toBeGreaterThan(0.8)
    }
    await card.evaluate(element => element.getAnimations()[0]!.finish())
    await expect(card).toHaveCSS('opacity', '0')
    await toggle.click()
    await card.evaluate(element => element.getAnimations()[0]!.finish())
    await expect(card).toHaveCSS('opacity', '1')
  })
}

test('separate entry and exit use their own native durations', async ({ page }) => {
  await page.getByLabel('Directional duration', { exact: true }).check()
  await page.getByLabel('Separate motion', { exact: true }).check()
  await page.getByLabel('Exit motion duration', { exact: true }).fill('1000')
  const toggle = page.getByRole('button', { name: 'Toggle motion', exact: true })
  await toggle.click()
  const card = page.locator('.motion-card')
  expect(await card.evaluate(element => element.getAnimations()[0]!.effect!.getTiming().duration)).toBe(5000)
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await toggle.click()
  await expect.poll(() => card.evaluate(element => element.getAnimations()[0]!.effect!.getTiming().duration)).toBe(1000)
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await expect(card).toHaveCount(0)
})

test('reactive targets retarget from the current native presentation outside a lifecycle boundary', async ({ page }) => {
  const card = page.locator('.reactive-card')
  expect(await card.evaluate(element => element.getAnimations()[0]!.effect!.getTiming().duration)).toBe(0)
  await page.getByRole('button', { name: 'Move target', exact: true }).click()
  const old = await card.evaluateHandle(element => {
    const animation = element.getAnimations()[0]!
    animation.pause(); animation.currentTime = 2500
    return animation
  })
  await page.getByRole('button', { name: 'Move target', exact: true }).click()
  expect(await old.evaluate(animation => animation.playState)).toBe('idle')
  const origin = await card.evaluate(element => {
    const effect = element.getAnimations()[0]!.effect as KeyframeEffect
    return new DOMMatrixReadOnly(String(effect.getKeyframes()[0]!.transform)).m41
  })
  expect(origin).toBeCloseTo(100, 0)
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
})

test('the first reactive target applies before insertion even when remounting at a different target', async ({ page }) => {
  await page.getByRole('button', { name: 'Unmount target', exact: true }).click()
  await page.getByRole('button', { name: 'Move target', exact: true }).click()
  const first = page.evaluate(() => new Promise<number>(resolve => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector('.reactive-card')
      if (!element) return
      observer.disconnect()
      resolve(new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)
    })
    observer.observe(document.body, { subtree: true, childList: true })
  }))
  await page.getByRole('button', { name: 'Unmount target', exact: true }).click()
  expect(await first).toBe(200)
})

test('reactive targets skip motion on preference changes and clean up on ordinary disposal', async ({ page }) => {
  const card = page.locator('.reactive-card')
  await page.getByRole('button', { name: 'Move target', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 200, 0)')
  await page.getByRole('button', { name: 'Move target', exact: true }).click()
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  const animation = await card.evaluateHandle(element => element.getAnimations()[0]!)
  await page.getByRole('button', { name: 'Unmount target', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await animation.evaluate(animation => animation.playState)).toBe('idle')
})

test('compiled spring easing overshoots and reverses on the same native timeline', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Toggle spring', exact: true })
  await toggle.click()
  const card = page.locator('.spring-card')
  const animation = await card.evaluateHandle(element => {
    const animation = element.getAnimations()[0]!
    animation.pause()
    animation.currentTime = Number(animation.effect!.getTiming().duration) * 0.2
    return animation
  })
  expect(await animation.evaluate(animation => (animation.effect!.getTiming().easing ?? '').startsWith('linear('))).toBe(true)
  expect(await card.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBeGreaterThan(100)
  await toggle.click()
  await expect.poll(() => animation.evaluate(animation => animation.playbackRate)).toBe(-1)
  expect(await card.evaluate((element, animation) => element.getAnimations()[0] === animation, animation)).toBe(true)
  await animation.evaluate(animation => animation.finish())
  await expect(card).toHaveCount(0)
})

test('out-in mounts only the latest branch after native motion AND other work finish', async ({ page }) => {
  const card = page.locator('.sequence-card')
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  const old = await card.elementHandle()
  await page.getByRole('button', { name: 'Sequence B', exact: true }).click()
  await page.getByRole('button', { name: 'Sequence C', exact: true }).click()
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-name', 'A')
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  await expect(card).toHaveAttribute('data-pending', 'true')
  await card.getByRole('button', { name: 'Release sequence work', exact: true }).click({ force: true })
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-name', 'C')
  expect(await old!.evaluate(element => element.isConnected)).toBe(false)
})

test('out-in reselects an exiting instance and preserves local input state', async ({ page }) => {
  const card = page.locator('.sequence-card')
  await card.evaluate(element => element.getAnimations()[0]!.finish())
  const old = await card.elementHandle()
  await card.getByRole('textbox').fill('keep me')
  await page.getByRole('button', { name: 'Sequence B', exact: true }).click()
  await expect(card).toHaveAttribute('data-phase', 'exiting')
  await page.getByRole('button', { name: 'Sequence A', exact: true }).click()
  await expect(card).toHaveAttribute('data-phase', 'present')
  await expect(card.getByRole('textbox')).toHaveValue('keep me')
  expect(await card.evaluate((element, old) => element === old, old)).toBe(true)
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
