import { expect, test, type Locator } from '@playwright/test'

test.use({ reducedMotion: 'no-preference' })

let errors: string[]
test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
})
test.afterEach(() => { expect(errors).toEqual([]) })

const listSelector = '.layout-queue-list'
const rowSelector = (id: number) => `[data-entry="${id}"]`

// Pause inside the page as soon as the requested element effects start: the
// public demo uses a real 250ms transition, not a test-only slow clock.
async function frames(queue: Locator, options: {
  click?: Locator
  watch?: string[]
  seek?: number[]
} = {}) {
  const { click, watch = [], seek = [] } = options
  return queue.evaluate(async (root, { button, watch, seek, listSelector }) => {
    function own(element: Element) {
      return element.getAnimations().filter(animation =>
        animation.effect instanceof KeyframeEffect && animation.effect.target === element)
    }
    const list = root.querySelector<HTMLUListElement>(listSelector)!
    const directRows = () => Array.from(list.querySelectorAll<HTMLLIElement>(':scope > li[data-entry]'))
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const active = (element: Element) => own(element).filter(a => a.pending || a.playState === 'running' || a.playState === 'paused')
    const watched = () => watch.every(selector => {
      const element = root.querySelector(selector)
      return element && active(element).length > 0
    })

    if (button) (button as HTMLButtonElement).click()
    if (watch.length) {
      const deadline = performance.now() + 1500
      while (!watched() && performance.now() < deadline) await nextFrame()
      if (!watched()) throw new Error(`No element-owned native effect on ${watch.join(', ')}`)
    } else if (button) {
      await nextFrame()
    }
    const playing = [list, ...directRows()].flatMap(active)
    if (watch.length) {
      for (const animation of playing) animation.pause()
      await Promise.all(playing.map(animation => animation.ready))
    }

    return (seek.length ? seek : [undefined]).map(progress => {
      if (progress !== undefined) {
        for (const animation of playing) {
          const { delay = 0, duration } = animation.effect!.getComputedTiming()
          animation.currentTime = delay + Number(duration) * (animation.playbackRate < 0 ? 1 - progress : progress)
        }
      }
      // Focus can scroll the page a few pixels; measure geometry within the demo.
      const origin = root.getBoundingClientRect()
      function box(element: HTMLElement) {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x: x - origin.x, y: y - origin.y, width, height, style: element.style.cssText, effects: own(element).length }
      }
      const rows = directRows()
      return {
        list: { ...box(list), scrollTop: list.scrollTop },
        footerY: root.querySelector('.layout-queue-summary')!.getBoundingClientRect().y - origin.y,
        order: rows.map(row => Number(row.dataset.entry)),
        rows: Object.fromEntries(rows.map(row => [Number(row.dataset.entry), {
          ...box(row), opacity: Number(getComputedStyle(row).opacity), inert: row.inert,
        }])),
      }
    })
  }, { button: await click?.elementHandle(), watch, seek, listSelector })
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
    const [frame] = await frames(queue)
    return { order: frame.order, effects: [frame.list, ...Object.values(frame.rows)].map(box => box.effects) }
  }).toEqual({ order, effects: Array(order.length + 1).fill(0) })
  return (await frames(queue))[0]
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

function styles(frame: Awaited<ReturnType<typeof frames>>[number]) {
  return [frame.list.style, ...Object.values(frame.rows).map(row => row.style)]
}

test('LayoutList reorders direct custom rows on both axes without owning descendant effects', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await page.addStyleTag({ content: '.layout-queue-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; align-items: start; }' })
  await queue.scrollIntoViewIfNeeded()
  await expect(queue.locator(`${listSelector} > *`)).toHaveCount(3)
  await finish(queue)
  const before = await resting(queue, [1, 2, 3])
  const note = queue.locator(`${rowSelector(3)} input`)
  const independent = await note.evaluateHandle(input => input.animate(
    [{ outlineOffset: '0px' }, { outlineOffset: '2px' }], { duration: 300, iterations: Infinity },
  ))

  const [start, mid] = await frames(queue, {
    click: queue.getByRole('button', { name: 'Rotate queue' }), watch: [rowSelector(3)], seek: [0, 0.5],
  })
  expect(start.order).toEqual([2, 3, 1])
  sameBox(start.rows[3], before.rows[3])
  between(mid.rows[3].x, before.rows[3].x, before.rows[2].x)
  between(mid.rows[3].y, before.rows[3].y, before.rows[2].y)
  expect(await note.evaluate((input, animation) => input.getAnimations().length === 1 && input.getAnimations()[0] === animation, independent)).toBe(true)

  await finish(queue)
  const after = await resting(queue, [2, 3, 1])
  sameBox(after.rows[3], before.rows[2])
  close(after.list.height, before.list.height)
  expect(styles(after)).toEqual(styles(before))
  expect(await independent.evaluate(animation => animation.playState)).toBe('running')
})

test('LayoutList moves survivors and animates flow height through remove and add in a scrolled tray', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await page.addStyleTag({ content: '.layout-queue-tray { max-height: 135px; overflow-y: scroll; overflow-anchor: none; }' })
  await queue.scrollIntoViewIfNeeded()
  await finish(queue)
  const tray = queue.locator('.layout-queue-tray')
  expect(await tray.evaluate(element => { element.scrollTop = 20; return element.scrollTop })).toBe(20)
  const before = await resting(queue, [1, 2, 3])
  const outgoing = queue.locator(rowSelector(1))
  const originalRow = (await outgoing.elementHandle())!

  const [start, mid, almostDone] = await frames(queue, {
    click: outgoing.getByRole('button', { name: 'Remove The night atlas' }),
    watch: [listSelector, rowSelector(1), rowSelector(2)], seek: [0, 0.5, 0.99],
  })
  sameBox(start.rows[1], before.rows[1])
  sameBox(mid.rows[1], before.rows[1])
  sameBox(start.rows[2], before.rows[2])
  close(start.list.height, before.list.height)
  close(start.footerY, before.footerY)
  expect(mid.rows[1]).toMatchObject({ inert: true })
  expect(mid.rows[1].opacity).toBeGreaterThan(0)
  expect(mid.rows[1].opacity).toBeLessThan(1)

  await finish(queue)
  const smaller = await resting(queue, [2, 3])
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

  const [enter, growing, almostFull] = await frames(queue, {
    click: queue.getByRole('button', { name: 'Add title' }),
    watch: [listSelector, rowSelector(4), rowSelector(2)], seek: [0, 0.5, 0.99],
  })
  close(enter.list.height, smaller.list.height)
  sameBox(enter.rows[2], smaller.rows[2])
  expect(enter.rows[4].opacity).toBeLessThan(0.05)
  expect(growing.rows[4].opacity).toBeGreaterThan(enter.rows[4].opacity)
  expect(growing.rows[4].opacity).toBeLessThan(1)
  await finish(queue)
  const after = await resting(queue, [4, 2, 3])
  between(growing.list.height, smaller.list.height, after.list.height)
  between(growing.rows[2].y, smaller.rows[2].y, after.rows[2].y)
  sameBox(after.rows[2], before.rows[2])
  close(almostFull.list.height, after.list.height, 3)
  close(almostFull.footerY, after.footerY, 3)
  expect(after.rows[4].opacity).toBe(1)
  expect(styles(after)).toEqual(styles(before))
  expect(await tray.evaluate(element => element.scrollTop)).toBe(20)
})

test('an unrelated insertion does not restart or unpin an exit in a scrolling LayoutList host', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  // Cap the host itself here to exercise its scroll origin, not animated flow height.
  await page.addStyleTag({ content: '.layout-queue-list { max-height: 115px; overflow-y: scroll; overflow-anchor: none; }' })
  await queue.scrollIntoViewIfNeeded()
  await finish(queue)
  const list = queue.locator(listSelector)
  const scroll = (top: number) => list.evaluate((node, top) => { node.scrollTop = top; return node.scrollTop }, top)
  expect(await scroll(20)).toBe(20)
  const before = await resting(queue, [1, 2, 3])
  const outgoing = queue.locator(rowSelector(2))
  const [pinned] = await frames(queue, {
    click: outgoing.getByRole('button', { name: 'Remove Notes from the coast' }), watch: [rowSelector(2)], seek: [0.5],
  })
  sameBox(pinned.rows[2], before.rows[2])
  expect(pinned.rows[2].opacity).toBeGreaterThan(0)
  expect(pinned.rows[2].opacity).toBeLessThan(1)
  const exit = await outgoing.evaluateHandle(row => row.getAnimations())
  const holdTimes = await exit.evaluate(animations => animations.map(animation => animation.currentTime))

  expect(await scroll(30)).toBe(30)
  const [edited] = await frames(queue, {
    click: queue.getByRole('button', { name: 'Add title' }), watch: [rowSelector(4)],
  })
  expect(edited.rows[2].inert).toBe(true)
  // Compare the same point in the host's scrolling coordinate space, using
  // the actual scroll offsets on either side of the edit.
  expect(edited.list.scrollTop).not.toBe(pinned.list.scrollTop)
  sameBox(edited.rows[2], {
    ...pinned.rows[2], y: pinned.rows[2].y + edited.list.y - pinned.list.y + pinned.list.scrollTop - edited.list.scrollTop,
  })
  close(edited.rows[2].opacity, pinned.rows[2].opacity, 0.01)
  expect(await outgoing.evaluate((row, animations) => {
    const current = row.getAnimations()
    return current.length === animations.length && animations.every(animation => current.includes(animation) && animation.playState === 'paused')
  }, exit)).toBe(true)
  expect(await exit.evaluate(animations => animations.map(animation => animation.currentTime))).toEqual(holdTimes)

  // Both the still-paused exit and the unrelated entrance must release owned work.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const settled = await resting(queue, [4, 1, 3])
  expect(styles(settled)).toEqual(styles(before))
  expect(await exit.evaluate(animations => animations.every(animation => animation.playState === 'idle'))).toBe(true)
})

test('an initially empty LayoutList grows and returns to its natural empty height after the last exit', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await queue.scrollIntoViewIfNeeded()
  const instant = queue.getByRole('checkbox', { name: 'Instant' })
  await instant.check()
  for (const id of [1, 2, 3]) {
    await frames(queue, { click: queue.locator(`${rowSelector(id)} button`) })
  }
  // Remount with no rows, so the first insertion has no previous row to measure.
  await queue.getByRole('button', { name: 'Hide list' }).click()
  await instant.uncheck()
  await queue.getByRole('button', { name: 'Show list' }).click()
  const empty = await resting(queue, [])
  const boxEdges = await queue.locator(listSelector).evaluate(node => {
    const { paddingTop, paddingBottom, borderTopWidth, borderBottomWidth } = getComputedStyle(node)
    return [paddingTop, paddingBottom, borderTopWidth, borderBottomWidth].reduce((sum, value) => sum + parseFloat(value), 0)
  })
  close(empty.list.height, boxEdges)

  async function grow(id: number) {
    const [start, mid, end] = await frames(queue, {
      click: queue.getByRole('button', { name: 'Add title' }), watch: [listSelector, rowSelector(id)], seek: [0, 0.5, 0.99],
    })
    await finish(queue)
    const full = await resting(queue, [id])
    close(start.list.height, empty.list.height)
    between(mid.list.height, empty.list.height, full.list.height)
    close(end.list.height, full.list.height, 3)
    close(end.footerY, full.footerY, 3)
    expect(full.list.style).toBe(empty.list.style)
    return full
  }

  const full = await grow(4)
  const [start, mid, end] = await frames(queue, {
    click: queue.locator(`${rowSelector(4)} button`), watch: [listSelector, rowSelector(4)], seek: [0, 0.5, 0.99],
  })
  sameBox(mid.rows[4], full.rows[4])
  expect(mid.rows[4].inert).toBe(true)
  await finish(queue)
  const cleared = await resting(queue, [])
  close(start.list.height, full.list.height)
  between(mid.list.height, full.list.height, cleared.list.height)
  close(end.list.height, cleared.list.height, 3)
  close(end.footerY, cleared.footerY, 3)
  close(cleared.list.height, empty.list.height)
  expect(styles(cleared)).toEqual(styles(empty))
  await grow(5)
})

test('interrupting a reorder with removal and quick Undo restores the same focused input and draft', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await queue.scrollIntoViewIfNeeded()
  await finish(queue)
  const before = await resting(queue, [1, 2, 3])
  const row = queue.locator(rowSelector(1))
  const note = row.getByRole('textbox')
  const original = await note.elementHandle()
  const undo = queue.getByRole('button', { name: 'Undo removal' })
  await note.fill('Keep this draft')
  const [moving] = await frames(queue, {
    click: queue.getByRole('button', { name: 'Rotate queue' }), watch: [rowSelector(1)], seek: [0.5],
  })
  between(moving.rows[1].y, before.rows[1].y, before.rows[3].y)
  await note.evaluate(input => input.focus({ preventScroll: true }))

  const exit = frames(queue, { watch: [`${rowSelector(1)}[inert]`], seek: [0, 0.5] })
  await page.keyboard.press('Escape')
  const [held, leaving] = await exit
  sameBox(held.rows[1], moving.rows[1])
  expect(leaving.rows[1].opacity).toBeGreaterThan(0)
  expect(leaving.rows[1].opacity).toBeLessThan(1)
  await expect(undo).toBeFocused()
  await expect(undo).toBeEnabled()
  await expect(undo).toHaveCSS('opacity', '1')
  await expect(queue.getByRole('button', { name: 'Add title' })).toBeEnabled()
  await row.locator('input').evaluate(input => input.focus())
  await expect(undo).toBeFocused()

  const entry = frames(queue, { watch: [`${rowSelector(1)}:not([inert])`] })
  await page.keyboard.press('Enter')
  const [reentering] = await entry
  close(reentering.rows[1].opacity, leaving.rows[1].opacity, 0.2)
  expect(await note.evaluate((input, saved) => input === saved, original)).toBe(true)
  await expect(note).toBeFocused()
  await expect(note).toHaveValue('Keep this draft')
  await finish(queue)
  const after = await resting(queue, [2, 3, 1])
  sameBox(after.rows[1], before.rows[3])
  expect(styles(after)).toEqual(styles(before))
})

for (const mode of ['reduced motion', 'zero duration'] as const) {
  test(`LayoutList snaps list changes with ${mode}`, async ({ page }) => {
    const queue = page.getByRole('region', { name: 'Reading queue' })
    if (mode === 'reduced motion') await page.emulateMedia({ reducedMotion: 'reduce' })
    else await queue.getByRole('checkbox', { name: 'Instant' }).check()
    await queue.scrollIntoViewIfNeeded()
    const before = await resting(queue, [1, 2, 3])
    const [reordered] = await frames(queue, { click: queue.getByRole('button', { name: 'Rotate queue' }) })
    expect(reordered.order).toEqual([2, 3, 1])
    sameBox(reordered.rows[1], before.rows[3])
    expect(styles(reordered)).toEqual(styles(before))
    expect([reordered.list, ...Object.values(reordered.rows)].every(box => box.effects === 0)).toBe(true)

    const [removed] = await frames(queue, { click: queue.getByRole('button', { name: 'Remove The night atlas' }) })
    expect(removed.order).toEqual([2, 3])
    expect(removed.list.height).toBeLessThan(before.list.height - 20)
    expect([removed.list, ...Object.values(removed.rows)].every(box => box.effects === 0)).toBe(true)
  })
}

test('ordinary unmount cancels active LayoutList effects and restores owned styles', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Reading queue' })
  await queue.scrollIntoViewIfNeeded()
  await finish(queue)
  const before = await resting(queue, [1, 2, 3])
  const list = await queue.locator(listSelector).elementHandle()
  const row = await queue.locator(rowSelector(1)).elementHandle()
  await frames(queue, {
    click: queue.getByRole('button', { name: 'Remove The night atlas' }),
    watch: [listSelector, rowSelector(1)], seek: [0.5],
  })
  const effects = await queue.locator(listSelector).evaluateHandle(list => [list, ...list.children].flatMap(el => el.getAnimations()))
  await queue.getByRole('button', { name: 'Hide list' }).click()
  await expect(queue.locator(listSelector)).toHaveCount(0)
  expect(await effects.evaluate(animations => animations.every(animation => animation.playState === 'idle'))).toBe(true)
  expect(await list!.evaluate(element => element.style.cssText)).toBe(before.list.style)
  expect(await row!.evaluate(element => element.style.cssText)).toBe(before.rows[1].style)
  await queue.getByRole('button', { name: 'Show list' }).click()
  await expect(queue.locator(`${listSelector} > li`)).toHaveCount(2)
  await finish(queue)
  await resting(queue, [2, 3])
})
