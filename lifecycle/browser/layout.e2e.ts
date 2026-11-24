import { expect, test, type Locator } from '@playwright/test'

test.use({ reducedMotion: 'no-preference' })

const listSelector = '.layout-queue-list'
const rowSelector = (id: number) => `[data-entry="${id}"]`
const speed = (queue: Locator) => queue.getByRole('combobox', { name: 'Animation speed' })
const initialOrder = [1, 2, 3, 4, 5]
const withoutFirst = initialOrder.slice(1)
const rotatedOrder = [...withoutFirst, 1]

let errors: string[]
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  // Keep document scroll anchoring from moving the viewport during a geometry sample.
  await page.addStyleTag({ content: 'html, body { overflow-anchor: none; }' })
  const selector = speed(page.getByRole('region', { name: 'Reading queue' }))
  await expect(selector).toHaveValue('0.25')
  await selector.selectOption({ label: 'Slow' })
})
test.afterEach(() => { expect(errors).toEqual([]) })

async function pauseEffects(queue: Locator, ...targets: string[]) {
  await expect.poll(() => queue.locator(listSelector).evaluate(async (list, targets) => {
    const playing = [list, ...list.children].map(element => ({
      element,
      effects: element.getAnimations().filter(a =>
        (a.pending || a.playState === 'running') && a.effect instanceof KeyframeEffect && a.effect.target === element),
    }))
    const missing = targets.filter(selector => !playing.some(({ element, effects }) => element.matches(selector) && effects.length))
    if (missing.length) return missing

    // Freeze the new effects together, leaving any already-paused exit alone.
    const effects = playing.flatMap(({ effects }) => effects)
    for (const animation of effects) animation.pause()
    await Promise.all(effects.map(animation => animation.ready))
    return []
  }, targets), { message: 'Targets without a playing, element-owned effect' }).toEqual([])
}

async function sample(queue: Locator, progress?: number) {
  return queue.evaluate((root, { listSelector, progress }) => {
    const list = root.querySelector<HTMLUListElement>(listSelector)!
    const rows = Array.from(list.querySelectorAll<HTMLLIElement>(':scope > li[data-entry]'))
    const own = (element: Element) => element.getAnimations().filter(a =>
      a.effect instanceof KeyframeEffect && a.effect.target === element)
    if (progress !== undefined) {
      for (const animation of [list, ...rows].flatMap(own)) {
        if (animation.playState !== 'paused') continue
        const { delay = 0, duration } = animation.effect!.getComputedTiming()
        animation.currentTime = delay + Number(duration) * (animation.playbackRate < 0 ? 1 - progress : progress)
      }
    }
    const host = list.getBoundingClientRect()
    return {
      list: { height: host.height, style: list.style.cssText, effects: own(list).length, scrollTop: list.scrollTop },
      footerY: root.querySelector('.layout-queue-summary')!.getBoundingClientRect().y - host.y,
      order: rows.map(row => Number(row.dataset.entry)),
      rows: Object.fromEntries(rows.map(row => {
        const { x, y, width, height } = row.getBoundingClientRect()
        return [Number(row.dataset.entry), {
          x: x - host.x, y: y - host.y, width, height, style: row.style.cssText, effects: own(row).length,
          opacity: Number(getComputedStyle(row).opacity), inert: row.inert,
        }]
      })),
    }
  }, { listSelector, progress })
}

async function finish(queue: Locator) {
  await queue.locator(listSelector).evaluate(async list => {
    const effects = [list, ...list.querySelectorAll(':scope > li')].flatMap(node => node.getAnimations())
    const completions = effects.map(animation => {
      const finished = animation.finished
      animation.finish()
      return finished
    })
    await Promise.allSettled(completions)
  })
}

async function resting(queue: Locator, order: number[]) {
  await expect.poll(async () => {
    const frame = await sample(queue)
    return { order: frame.order, effects: [frame.list, ...Object.values(frame.rows)].map(box => box.effects) }
  }).toEqual({ order, effects: Array(order.length + 1).fill(0) })
  return sample(queue)
}

function close(actual: number, expected: number, pixels = 1.5) {
  expect(Math.abs(actual - expected)).toBeLessThan(pixels)
}

function between(actual: number, start: number, end: number) {
  expect(actual).toBeGreaterThan(Math.min(start, end) + 2)
  expect(actual).toBeLessThan(Math.max(start, end) - 2)
}

function sameBox(actual: { x: number; y: number; width: number; height: number }, expected: typeof actual) {
  for (const dim of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[dim] - expected[dim]), `${dim}: ${actual[dim]} vs ${expected[dim]}`).toBeLessThan(1.5)
  }
}

function styles(frame: Awaited<ReturnType<typeof sample>>) {
  return [frame.list.style, ...Object.values(frame.rows).map(row => row.style)]
}

test('the Reading queue grid moves multiple LayoutList rows at once without owning descendant effects', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await queue.scrollIntoViewIfNeeded()
  await expect(queue.locator(listSelector)).toHaveCSS('display', 'grid')
  await expect(queue.locator(`${listSelector} > *`)).toHaveCount(initialOrder.length)
  const before = await resting(queue, initialOrder)
  close(before.rows[1].y, before.rows[2].y)
  expect(before.rows[2].x).toBeGreaterThan(before.rows[1].x)
  close(before.rows[1].x, before.rows[3].x)
  expect(before.rows[3].y).toBeGreaterThan(before.rows[1].y)
  const note = queue.locator(`${rowSelector(3)} input`)
  const independent = await note.evaluateHandle(input => input.animate(
    [{ outlineOffset: '0px' }, { outlineOffset: '2px' }], { duration: 300, iterations: Infinity },
  ))

  await queue.getByRole('button', { name: 'Rotate queue' }).click()
  await pauseEffects(queue, ...initialOrder.map(rowSelector))
  const start = await sample(queue, 0)
  const mid = await sample(queue, 0.5)
  expect(start.order).toEqual(rotatedOrder)
  for (const id of initialOrder) sameBox(start.rows[id], before.rows[id])
  close(mid.rows[1].x, before.rows[1].x)
  between(mid.rows[1].y, before.rows[1].y, before.rows[5].y)
  between(mid.rows[2].x, before.rows[2].x, before.rows[1].x)
  close(mid.rows[2].y, before.rows[2].y)
  between(mid.rows[3].x, before.rows[3].x, before.rows[2].x)
  between(mid.rows[3].y, before.rows[3].y, before.rows[2].y)
  expect(await note.evaluate((input, animation) => input.getAnimations().length === 1 && input.getAnimations()[0] === animation, independent)).toBe(true)

  await finish(queue)
  const after = await resting(queue, rotatedOrder)
  rotatedOrder.forEach((id, slot) => sameBox(after.rows[id], before.rows[initialOrder[slot]!]))
  close(after.list.height, before.list.height)
  expect(styles(after)).toEqual(styles(before))
  expect(await independent.evaluate(animation => animation.playState)).toBe('running')
})

test('the Reading queue fits a narrow phone in one column', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  const queue = page.getByRole('region', { name: 'Reading queue' })
  const frame = await resting(queue, initialOrder)
  for (const [index, id] of withoutFirst.entries()) {
    const previous = frame.rows[initialOrder[index]!]
    const card = frame.rows[id]
    close(card.x, previous.x)
    close(card.width, previous.width)
    expect(card.y).toBeGreaterThan(previous.y + previous.height)
  }
  expect(await queue.evaluate(element => {
    const { left, right } = element.getBoundingClientRect()
    return left >= 0 && right <= window.innerWidth && element.scrollWidth <= element.clientWidth
  })).toBe(true)
  expect(await queue.locator(listSelector).evaluate(list =>
    [list, ...list.children].every(element => element.scrollWidth <= element.clientWidth),
  )).toBe(true)
})

test('LayoutList moves survivors and animates flow height through remove and add in a scrolled tray', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await page.addStyleTag({ content: `
    .layout-queue-list { display: flex; flex-direction: column; align-items: stretch; }
    .layout-queue-list > li { flex: none; }
    .layout-queue-tray { max-height: 135px; overflow-y: scroll; overflow-anchor: none; }
  ` })
  await queue.scrollIntoViewIfNeeded()
  const tray = queue.locator('.layout-queue-tray')
  expect(await tray.evaluate(element => { element.scrollTop = 20; return element.scrollTop })).toBe(20)
  const before = await resting(queue, initialOrder)
  const outgoing = queue.locator(rowSelector(1))
  const originalRow = (await outgoing.elementHandle())!

  await outgoing.getByRole('button', { name: 'Remove The night atlas' }).click()
  await pauseEffects(queue, listSelector, rowSelector(1), rowSelector(2))
  const start = await sample(queue, 0)
  const mid = await sample(queue, 0.5)
  const almostDone = await sample(queue, 0.99)
  sameBox(start.rows[1], before.rows[1])
  sameBox(mid.rows[1], before.rows[1])
  sameBox(start.rows[2], before.rows[2])
  close(start.list.height, before.list.height)
  close(start.footerY, before.footerY)
  expect(mid.rows[1]).toMatchObject({ inert: true })
  expect(mid.rows[1].opacity).toBeGreaterThan(0)
  expect(mid.rows[1].opacity).toBeLessThan(1)

  await finish(queue)
  const smaller = await resting(queue, withoutFirst)
  expect(await originalRow.evaluate(row => ({
    connected: row.isConnected, effects: row.getAnimations().length, style: row.style.cssText,
  }))).toEqual({ connected: false, effects: 0, style: before.rows[1].style })
  between(mid.rows[2].y, before.rows[2].y, smaller.rows[2].y)
  between(mid.list.height, before.list.height, smaller.list.height)
  between(mid.footerY, before.footerY, smaller.footerY)
  close(smaller.rows[2].y, before.rows[1].y)
  close(almostDone.rows[2].y, smaller.rows[2].y, 3)
  close(almostDone.list.height, smaller.list.height, 3)
  close(almostDone.footerY, smaller.footerY, 3)

  await queue.getByRole('button', { name: 'Add title' }).click()
  await pauseEffects(queue, listSelector, rowSelector(6), rowSelector(2))
  const enter = await sample(queue, 0)
  const growing = await sample(queue, 0.5)
  const almostFull = await sample(queue, 0.99)
  close(enter.list.height, smaller.list.height)
  sameBox(enter.rows[2], smaller.rows[2])
  expect(enter.rows[6].opacity).toBeLessThan(0.05)
  expect(growing.rows[6].opacity).toBeGreaterThan(enter.rows[6].opacity)
  expect(growing.rows[6].opacity).toBeLessThan(1)
  await finish(queue)
  const after = await resting(queue, [6, ...withoutFirst])
  between(growing.list.height, smaller.list.height, after.list.height)
  between(growing.rows[2].y, smaller.rows[2].y, after.rows[2].y)
  sameBox(after.rows[2], before.rows[2])
  close(almostFull.list.height, after.list.height, 3)
  close(almostFull.footerY, after.footerY, 3)
  expect(after.rows[6].opacity).toBe(1)
  expect(styles(after)).toEqual(styles(before))
  expect(await tray.evaluate(element => element.scrollTop)).toBe(20)
})

test('an unrelated insertion does not restart or unpin an exit in a scrolling LayoutList grid', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  // Exercise both the host's scroll origin and the explicitly placed grid area's origin.
  await page.addStyleTag({ content: `
    .layout-queue-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-content: start;
      max-height: 115px;
      overflow-y: scroll;
      overflow-anchor: none;
    }
    .layout-queue-list > li { grid-column: 2; margin: .15rem .2rem; }
  ` })
  await queue.scrollIntoViewIfNeeded()
  const list = queue.locator(listSelector)
  const scroll = (top: number) => list.evaluate((node, top) => { node.scrollTop = top; return node.scrollTop }, top)
  expect(await scroll(20)).toBe(20)
  const before = await resting(queue, initialOrder)
  const outgoing = queue.locator(rowSelector(2))
  await outgoing.getByRole('button', { name: 'Remove Notes from the coast' }).click()
  await pauseEffects(queue, rowSelector(2))
  const firstPin = await sample(queue, 0)
  const pinned = await sample(queue, 0.5)
  sameBox(firstPin.rows[2], before.rows[2])
  sameBox(pinned.rows[2], before.rows[2])
  expect(pinned.rows[2].opacity).toBeGreaterThan(0)
  expect(pinned.rows[2].opacity).toBeLessThan(1)
  const exit = await outgoing.evaluateHandle(row => row.getAnimations())
  const holdTimes = await exit.evaluate(animations => animations.map(animation => animation.currentTime))

  expect(await scroll(30)).toBe(30)
  await queue.getByRole('button', { name: 'Add title' }).click()
  await pauseEffects(queue, rowSelector(6))
  const edited = await sample(queue)
  expect(edited.rows[2].inert).toBe(true)
  // Compare the same point in the host's scrolling coordinate space, using
  // the actual scroll offsets on either side of the edit.
  expect(edited.list.scrollTop).not.toBe(pinned.list.scrollTop)
  sameBox(edited.rows[2], {
    ...pinned.rows[2], y: pinned.rows[2].y + pinned.list.scrollTop - edited.list.scrollTop,
  })
  close(edited.rows[2].opacity, pinned.rows[2].opacity, 0.01)
  expect(await outgoing.evaluate((row, animations) => {
    const current = row.getAnimations()
    return current.length === animations.length && animations.every(animation => current.includes(animation) && animation.playState === 'paused')
  }, exit)).toBe(true)
  expect(await exit.evaluate(animations => animations.map(animation => animation.currentTime))).toEqual(holdTimes)

  // Both the still-paused exit and the unrelated entrance must release owned work.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const settled = await resting(queue, [6, 1, 3, 4, 5])
  expect(styles(settled)).toEqual(styles(before))
  expect(await exit.evaluate(animations => animations.every(animation => animation.playState === 'idle'))).toBe(true)
})

test('an initially empty LayoutList grows and returns to its natural empty height after the last exit', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await queue.scrollIntoViewIfNeeded()
  await speed(queue).selectOption({ label: 'Instant' })
  for (const id of initialOrder) {
    await queue.locator(`${rowSelector(id)} button`).click()
  }
  // Remount with no rows, so the first insertion has no previous row to measure.
  await queue.getByRole('button', { name: 'Hide list' }).click()
  await speed(queue).selectOption({ label: 'Slow' })
  await queue.getByRole('button', { name: 'Show list' }).click()
  const empty = await resting(queue, [])
  const boxEdges = await queue.locator(listSelector).evaluate(node => {
    const { paddingTop, paddingBottom, borderTopWidth, borderBottomWidth } = getComputedStyle(node)
    return [paddingTop, paddingBottom, borderTopWidth, borderBottomWidth].reduce((sum, value) => sum + parseFloat(value), 0)
  })
  close(empty.list.height, boxEdges)

  async function grow(id: number) {
    await queue.getByRole('button', { name: 'Add title' }).click()
    await pauseEffects(queue, listSelector, rowSelector(id))
    const start = await sample(queue, 0)
    const mid = await sample(queue, 0.5)
    const end = await sample(queue, 0.99)
    await finish(queue)
    const full = await resting(queue, [id])
    close(start.list.height, empty.list.height)
    between(mid.list.height, empty.list.height, full.list.height)
    close(end.list.height, full.list.height, 3)
    close(end.footerY, full.footerY, 3)
    expect(full.list.style).toBe(empty.list.style)
    return full
  }

  const full = await grow(6)
  await queue.locator(`${rowSelector(6)} button`).click()
  await pauseEffects(queue, listSelector, rowSelector(6))
  const start = await sample(queue, 0)
  const mid = await sample(queue, 0.5)
  const end = await sample(queue, 0.99)
  sameBox(mid.rows[6], full.rows[6])
  expect(mid.rows[6].inert).toBe(true)
  await finish(queue)
  const cleared = await resting(queue, [])
  close(start.list.height, full.list.height)
  between(mid.list.height, full.list.height, cleared.list.height)
  close(end.list.height, cleared.list.height, 3)
  close(end.footerY, cleared.footerY, 3)
  close(cleared.list.height, empty.list.height)
  expect(styles(cleared)).toEqual(styles(empty))
  await grow(7)
})

test('interrupting a reorder with removal and quick Undo restores the same focused input and draft', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await queue.scrollIntoViewIfNeeded()
  const before = await resting(queue, initialOrder)
  const row = queue.locator(rowSelector(1))
  const note = row.getByRole('textbox')
  const original = await note.elementHandle()
  const undo = queue.getByRole('button', { name: 'Undo removal' })
  await note.fill('Keep this draft')
  await queue.getByRole('button', { name: 'Rotate queue' }).click()
  await pauseEffects(queue, rowSelector(1))
  const moving = await sample(queue, 0.5)
  between(moving.rows[1].y, before.rows[1].y, before.rows[5].y)
  await note.evaluate(input => input.focus({ preventScroll: true }))

  await page.keyboard.press('Escape')
  await pauseEffects(queue, `${rowSelector(1)}[inert]`)
  const held = await sample(queue, 0)
  const leaving = await sample(queue, 0.5)
  sameBox(held.rows[1], moving.rows[1])
  expect(leaving.rows[1].opacity).toBeGreaterThan(0)
  expect(leaving.rows[1].opacity).toBeLessThan(1)
  await expect(undo).toBeFocused()
  await expect(undo).toBeEnabled()
  await expect(undo).toHaveCSS('opacity', '1')
  await expect(queue.getByRole('button', { name: 'Add title' })).toBeEnabled()
  await row.locator('input').evaluate(input => input.focus())
  await expect(undo).toBeFocused()

  await page.keyboard.press('Enter')
  await pauseEffects(queue, `${rowSelector(1)}:not([inert])`)
  const reentering = await sample(queue, 0)
  close(reentering.rows[1].opacity, leaving.rows[1].opacity, 0.2)
  expect(await note.evaluate((input, saved) => input === saved, original)).toBe(true)
  await expect(note).toBeFocused()
  await expect(note).toHaveValue('Keep this draft')
  await finish(queue)
  const after = await resting(queue, rotatedOrder)
  sameBox(after.rows[1], before.rows[5])
  expect(styles(after)).toEqual(styles(before))
})

for (const mode of ['reduced motion', 'zero duration'] as const) {
  test(`LayoutList snaps list changes with ${mode}`, async ({ page }) => {
    const queue = page.getByRole('region', { name: 'Reading queue' })
    if (mode === 'reduced motion') await page.emulateMedia({ reducedMotion: 'reduce' })
    else await speed(queue).selectOption({ label: 'Instant' })
    await queue.scrollIntoViewIfNeeded()
    const before = await resting(queue, initialOrder)
    await queue.getByRole('button', { name: 'Rotate queue' }).click()
    const reordered = await sample(queue)
    expect(reordered.order).toEqual(rotatedOrder)
    sameBox(reordered.rows[1], before.rows[5])
    expect(styles(reordered)).toEqual(styles(before))
    expect([reordered.list, ...Object.values(reordered.rows)].every(box => box.effects === 0)).toBe(true)

    await queue.getByRole('button', { name: 'Remove The night atlas' }).click()
    const removed = await sample(queue)
    expect(removed.order).toEqual(withoutFirst)
    expect(removed.list.height).toBeLessThan(before.list.height - 20)
    expect([removed.list, ...Object.values(removed.rows)].every(box => box.effects === 0)).toBe(true)
  })
}

test('ordinary unmount cancels active LayoutList effects and restores owned styles', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await queue.scrollIntoViewIfNeeded()
  const before = await resting(queue, initialOrder)
  const list = await queue.locator(listSelector).elementHandle()
  const row = await queue.locator(rowSelector(1)).elementHandle()
  await queue.getByRole('button', { name: 'Remove The night atlas' }).click()
  await pauseEffects(queue, listSelector, rowSelector(1))
  await sample(queue, 0.5)
  const effects = await queue.locator(listSelector).evaluateHandle(list => [list, ...list.children].flatMap(el => el.getAnimations()))
  await queue.getByRole('button', { name: 'Hide list' }).click()
  await expect(queue.locator(listSelector)).toHaveCount(0)
  expect(await effects.evaluate(animations => animations.every(animation => animation.playState === 'idle'))).toBe(true)
  expect(await list!.evaluate(element => element.style.cssText)).toBe(before.list.style)
  expect(await row!.evaluate(element => element.style.cssText)).toBe(before.rows[1].style)
  await queue.getByRole('button', { name: 'Show list' }).click()
  await expect(queue.locator(`${listSelector} > li`)).toHaveCount(withoutFirst.length)
  await resting(queue, withoutFirst)
})
