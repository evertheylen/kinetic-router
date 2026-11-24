import { Lifecycle, onInOut, useLifecycle, type ForProps } from '@kinetic-router/lifecycle'
import { createMemo, flatten, onCleanup, untrack, type Accessor, type Element as SolidElement } from 'solid-js'

/** Native timing sampled at each structural change. Duration is seconds (default
 * 0.25); zero skips playback. Ease is a CSS easing string (default 'ease-out'). */
export interface LayoutTransition {
  duration?: number
  ease?: string
}

export interface LayoutListProps<T> extends Pick<ForProps<T>, 'each' | 'by' | 'children'> {
  transition?: LayoutTransition
}

interface Row {
  root: HTMLElement
  exiting: Accessor<boolean>
  exit?: { animation: Animation; hasPose: boolean }
}

function isHTMLRoot(node: unknown): node is HTMLElement {
  const element = node as Element | null | undefined
  return element?.nodeType === Node.ELEMENT_NODE && element.namespaceURI === 'http://www.w3.org/1999/xhtml'
}

function pixels(value: number) { return `${value}px` }
function length(value: string) { return Number.parseFloat(value) || 0 }

function measureContainer(container: HTMLElement, style = getComputedStyle(container)) {
  const rect = container.getBoundingClientRect()
  const borderLeft = length(style.borderLeftWidth)
  return {
    height: rect.height,
    heightOffset: style.boxSizing === 'border-box' ? 0 : length(style.paddingTop) + length(style.paddingBottom)
      + length(style.borderTopWidth) + length(style.borderBottomWidth),
    // The padding edge is the absolute containing block's origin. clientLeft
    // also includes a left-side scrollbar in RTL, but rounds the border width.
    left: rect.left + borderLeft + Math.max(0, container.clientLeft - Math.round(borderLeft)) - container.scrollLeft,
    top: rect.top + length(style.borderTopWidth) - container.scrollTop,
  }
}

function measureRow(root: HTMLElement, origin: { left: number; top: number }) {
  const { left, top, width, height } = root.getBoundingClientRect()
  return { left: left - origin.left, top: top - origin.top, width, height, opacity: getComputedStyle(root).opacity }
}

type Pose = ReturnType<typeof measureRow>

function captureFirst(container: HTMLElement, style: CSSStyleDeclaration, rows: Iterable<Row>) {
  const box = measureContainer(container, style)
  const poses = new Map<HTMLElement, Pose>()
  for (const { root, exit } of rows) {
    if (root.parentNode === container && exit?.hasPose !== false) poses.set(root, measureRow(root, box))
  }
  return { parent: container, height: box.height, poses }
}

function moveFrames(first: Pose | undefined, last: Pose): Keyframe[] | undefined {
  const dx = first ? first.left - last.left : 0
  const dy = first ? first.top - last.top : 0
  const fade = !first || first.opacity !== last.opacity
  if (!dx && !dy && !fade) return
  const from: Keyframe = {}, to: Keyframe = {}
  if (dx || dy) {
    from.translate = `${pixels(dx)} ${pixels(dy)}`
    to.translate = '0px 0px'
  }
  if (fade) {
    from.opacity = first?.opacity ?? 0
    to.opacity = last.opacity
  }
  return [from, to]
}

function exitFrames(pose: Pose | undefined): Keyframe[] {
  // Reset grid placement so the containing block is the parent's padding edge,
  // not the row's authored grid area.
  const pin: Keyframe = { position: 'absolute', gridArea: 'auto' }
  if (pose) Object.assign(pin, {
    boxSizing: 'border-box',
    left: pixels(pose.left), top: pixels(pose.top), right: 'auto', bottom: 'auto',
    width: pixels(pose.width), height: pixels(pose.height),
    minWidth: '0px', minHeight: '0px', maxWidth: 'none', maxHeight: 'none',
    marginLeft: '0px', marginRight: '0px', marginTop: '0px', marginBottom: '0px',
  })
  return [{ ...pin, opacity: pose?.opacity ?? 0 }, { ...pin, opacity: 0 }]
}

function animate(root: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
  if (typeof root.animate === 'function') return root.animate(frames, { ...timing, fill: 'both' })
}

/**
 * Client-only keyed FLIP list. The callback receives item/index accessors and
 * runs once per row owner and returns one stable, direct HTML element (including
 * a component with that output). Keys default to item identity and must be unique.
 * No wrappers or forwarded refs; Solid owns insertion, reorder and disposal.
 * Same-key undo during an exit restores the same row owner and DOM.
 *
 * Use one authored HTML parent with non-static positioning (e.g. `position: relative`),
 * natural height and untransformed geometry. Positioning is checked on structural
 * edits to a rendered, animation-capable parent. Rows must lay out normally and
 * not redistribute spare height (e.g. use `align-content: start` on a grid). Put
 * visual transforms on a child of the row. While animating, LayoutList controls
 * row translate/opacity, exit positioning and box geometry, and parent height; don't
 * animate those same CSS properties independently. Inline styles are not changed.
 * Initial rows do not enter; structural changes after mount do. Zero duration
 * and reduced motion skip playback. An edit that starts in either mode or lacks
 * a parent layout box (e.g. detached or display: none) snaps without a recorded
 * position. New exits stay invisible and out of flow; undo does not animate
 * from a guessed box.
 */
export function LayoutList<T>(props: LayoutListProps<T>): SolidElement {
  const render = props.children
  // A layout-inert anchor lets the first insertion into an empty list measure
  // its authored parent before Solid has any row elements to insert.
  const anchor = document.createComment('LayoutList')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const rows = new Map<HTMLElement, Row>()
  const transients = new Map<HTMLElement, Animation>()

  function clearTransient(root: HTMLElement) {
    const animation = transients.get(root)
    transients.delete(root)
    animation?.cancel()
  }

  function clearTransients() {
    for (const root of transients.keys()) clearTransient(root)
  }

  function playTransient(root: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    const animation = animate(root, frames, timing)
    if (!animation) return
    transients.set(root, animation)
    const clearCurrent = () => { if (transients.get(root) === animation) clearTransient(root) }
    void animation.finished.then(clearCurrent, clearCurrent)
  }

  function clearExit(row: Row) {
    const exit = row.exit
    row.exit = undefined
    exit?.animation.cancel()
  }

  function finishExit(row: Row) {
    const animation = row.exit?.animation
    if (animation && animation.playState !== 'finished') animation.finish()
  }

  function pinExit(row: Row, pose: Pose | undefined, timing: KeyframeAnimationOptions) {
    // With no measurable pose, only apply the invisible, out-of-flow endpoint.
    const animation = animate(row.root, exitFrames(pose), pose ? timing : { duration: 0 })
    if (!animation) return
    const exit = { animation, hasPose: !!pose }
    row.exit = exit
    // Completion alone does not release the pin: other lifecycle handlers can
    // still hold the row. Only cancellation, reentry or disposal clears it.
    void animation.finished.catch(() => { if (row.exit === exit) clearExit(row) })
    if (!pose || timing.duration === 0) finishExit(row)
  }

  function clearEffects() {
    clearTransients()
    for (const row of rows.values()) clearExit(row)
  }

  function container() {
    const parent = anchor.parentElement
    return isHTMLRoot(parent) ? parent : undefined
  }

  function transitionTiming(): KeyframeAnimationOptions {
    const { duration = 0.25, ease: easing = 'ease-out' } = props.transition ?? {}
    if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(duration * 1000)) {
      throw new TypeError('LayoutList duration must be finite non-negative seconds')
    }
    return duration === 0 ? { duration: 0 } : { duration: duration * 1000, easing }
  }

  const output = Lifecycle.For({
    get each() { return props.each },
    get by() { return props.by },
    onBeforeChange() {
      const parent = container()
      if (!parent?.isConnected || typeof parent.animate !== 'function') return commitLayout
      try {
        // Test for a layout box, not a nonzero height: an empty list can grow.
        if (parent.getClientRects().length === 0) return commitLayout
        const timing = untrack(transitionTiming)
        const style = getComputedStyle(parent)
        if (style.position === 'static') {
          throw new TypeError('LayoutList requires a positioned parent; set position: relative on its parent')
        }
        if (timing.duration === 0 || reduced.matches) return commitLayout
        const first = captureFirst(parent, style, rows.values())
        return () => commitLayout(first, timing)
      } catch (error) {
        clearEffects()
        throw error
      }
    },
    children(item, index) {
      const { phase } = useLifecycle()
      let row: Row | undefined
      // Join the exit immediately, without waiting for standalone enter hooks.
      onInOut(({ direction }) => direction === 'out' ? row?.exit?.animation.finished.catch(() => undefined) : undefined)
      onCleanup(() => {
        if (!row) return
        clearTransient(row.root)
        clearExit(row)
        rows.delete(row.root)
      })
      // Lifecycle.For invokes setup untracked in the row owner. Resolve only its
      // returned JSX reactively, never the row factory itself.
      const output = render(item, index)
      return createMemo(() => {
        const content: unknown = flatten(output, { skipNonRendered: true })
        const root = Array.isArray(content) && content.length === 1 ? content[0] : content
        if (!isHTMLRoot(root)) throw new TypeError('LayoutList requires one stable HTML root per row')
        if (row && row.root !== root) throw new TypeError('LayoutList row replaced its root; keep the row root stable')
        if (!row) {
          if (rows.has(root)) throw new TypeError('LayoutList rows cannot share a root')
          row = { root, exiting: () => phase() === 'exiting' }
          rows.set(root, row)
        }
        return root
      }, { sync: true }) as unknown as SolidElement
    },
  })

  function commitLayout(before?: ReturnType<typeof captureFirst>, sampled: KeyframeAnimationOptions = { duration: 0 }) {
    const parent = container()
    try {
      clearTransients()
      const first = parent?.isConnected && before?.parent === parent && parent.getClientRects().length > 0 ? before : undefined
      const timing = first && !reduced.matches ? sampled : { duration: 0 }

      // Keep each retained exit's original pin through unrelated edits, even
      // while detached. Release pins on reentry before reading the flow layout.
      const liveRoots: HTMLElement[] = []
      for (const row of rows.values()) {
        if (!untrack(row.exiting)) {
          clearExit(row)
          if (row.root.parentNode === parent) liveRoots.push(row.root)
        } else if (row.exit) {
          if (timing.duration === 0) finishExit(row)
        } else if (parent ? row.root.parentNode === parent : !anchor.isConnected && !row.root.isConnected) {
          // Cached output can be removed without its authored parent; its
          // retained exits must already be invisible when it is reinserted.
          pinExit(row, first?.poses.get(row.root), timing)
        }
      }

      if (!parent || !first || timing.duration === 0) return
      // Read all Last geometry before installing effects that can change it.
      const lastBox = measureContainer(parent)
      const lastPoses = liveRoots.map(root => ({ root, pose: measureRow(root, lastBox) }))

      if (first.height !== lastBox.height) {
        const frames = [first.height, lastBox.height].map(height => ({ height: pixels(Math.max(0, height - lastBox.heightOffset)) }))
        playTransient(parent, frames, timing)
      }
      for (const { root, pose } of lastPoses) {
        const frames = moveFrames(first.poses.get(root), pose)
        if (frames) playTransient(root, frames, timing)
      }
    } catch (error) {
      clearEffects()
      throw error
    }
  }

  function motionPreferenceChanged(event: MediaQueryListEvent) {
    if (!event.matches) return
    clearTransients()
    for (const row of rows.values()) finishExit(row)
  }
  reduced.addEventListener('change', motionPreferenceChanged)
  onCleanup(() => {
    reduced.removeEventListener('change', motionPreferenceChanged)
    clearEffects()
  })
  return [anchor, output]
}
