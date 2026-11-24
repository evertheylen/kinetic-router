import { Lifecycle, onExit, useLifecycle, type ForProps } from '@kinetic-router/lifecycle'
import { createMemo, flatten, onCleanup, untrack, type Accessor, type Element as SolidElement } from 'solid-js'

/** Component timing sampled at each structural change. Duration is seconds (default
 * 0.25); zero skips playback. Ease accepts CSS easing (default 'ease-out') or
 * the Motion aliases 'easeIn', 'easeOut', and 'easeInOut'. */
export interface LayoutTransition {
  duration?: number
  ease?: string
  /** Native options with `easing` use milliseconds, not component timing. */
  easing?: never
}

export interface LayoutListProps<T> extends Pick<ForProps<T>, 'each' | 'by' | 'children'> {
  transition?: LayoutTransition
}

interface MoveOwner { move?: Animation }
interface Row extends MoveOwner {
  root: HTMLElement
  exiting: Accessor<boolean>
  exit?: Animation
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

function layoutTiming({ duration = 0.25, ease = 'ease-out', ...other }: LayoutTransition = {}) {
  if (Object.keys(other).length || typeof ease !== 'string' || !ease.trim()) {
    throw new TypeError('LayoutList transition accepts only duration in seconds and a CSS ease string')
  }
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(duration * 1000)) {
    throw new TypeError('LayoutList duration must be finite non-negative seconds')
  }
  const easing = ease === 'easeIn' ? 'ease-in' : ease === 'easeOut' ? 'ease-out' : ease === 'easeInOut' ? 'ease-in-out' : ease
  return { duration: duration * 1000, easing }
}

function animate(root: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
  if (typeof root.animate === 'function') return root.animate(frames, timing)
}

function cancelMove(owner: MoveOwner) {
  owner.move?.cancel()
  owner.move = undefined
}

function playMove(owner: MoveOwner, root: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
  // The end is already the natural layout. Only fill before playback, not after it.
  const move = animate(root, frames, { ...timing, fill: 'backwards' })
  if (!move) return
  owner.move = move
  const release = () => { if (owner.move === move) owner.move = undefined }
  void move.finished.then(release, release)
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
 * and reduced motion skip playback. If the parent has no layout box before or
 * after the edit (e.g. detached or display: none), the list snaps as well. On a
 * snap, new exits stay invisible and out of flow; undo never moves from a guessed box.
 */
export function LayoutList<T>(props: LayoutListProps<T>): SolidElement {
  const render = props.children
  // A layout-inert anchor lets the first insertion into an empty list measure
  // its authored parent before Solid has any row elements to insert.
  const anchor = document.createComment('LayoutList')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const rows = new Map<HTMLElement, Row>()
  const containerHeight: MoveOwner = {}

  function clearExit(row: Row) {
    row.exit?.cancel()
    row.exit = undefined
  }

  function pinExit(row: Row, first?: FirstLayout) {
    // With no measurable pose, only apply the invisible, out-of-flow endpoint.
    const pose = first?.poses.get(row)
    const timing = first && pose ? first.timing : { duration: 0 }
    const animation = animate(row.root, exitFrames(pose), { ...timing, fill: 'both' })
    if (!animation) return
    row.exit = animation
    // Keep a finished pin until reentry or disposal if other work holds the row.
    void animation.finished.catch(() => { if (row.exit === animation) row.exit = undefined })
    if (!pose) animation.finish()
  }

  function clearRow(row: Row) {
    cancelMove(row)
    clearExit(row)
  }

  function clearEffects() {
    cancelMove(containerHeight)
    for (const row of rows.values()) clearRow(row)
  }

  function container() {
    const parent = anchor.parentElement
    return isHTMLRoot(parent) ? parent : undefined
  }

  function captureFirst() {
    const parent = container()
    if (!parent?.isConnected || typeof parent.animate !== 'function') return
    const timing = layoutTiming(props.transition)
    const style = getComputedStyle(parent)
    if (style.position === 'static') {
      if (!parent.getClientRects().length) return
      throw new TypeError('LayoutList requires a positioned parent; set position: relative on its parent')
    }
    // Even a zero-height list has a real first box. A hidden list has none.
    if (timing.duration === 0 || reduced.matches || !parent.getClientRects().length) return
    const box = measureContainer(parent, style)
    const poses = new Map<Row, Pose>()
    for (const row of rows.values()) {
      // A completed exit is invisible; restore it at its new slot.
      if (row.root.parentNode === parent && row.exit?.playState !== 'finished') poses.set(row, measureRow(row.root, box))
    }
    return { parent, height: box.height, poses, timing }
  }
  type FirstLayout = NonNullable<ReturnType<typeof captureFirst>>

  const output = Lifecycle.For({
    get each() { return props.each },
    get by() { return props.by },
    onBeforeChange() {
      try {
        const first = untrack(captureFirst)
        return () => commitLayout(first)
      } catch (error) {
        clearEffects()
        throw error
      }
    },
    children(item, index) {
      const { phase } = useLifecycle()
      let row: Row | undefined
      // The fade starts at DOM commit. The exit hook only waits for it.
      onExit(() => row?.exit?.finished.catch(() => undefined))
      onCleanup(() => {
        if (!row) return
        clearRow(row)
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

  // Leave ongoing exits alone. Release reentered rows back into the flow before
  // measuring, and keep newly exiting rows out of it even in cached output.
  function prepareRows(parent: HTMLElement | undefined, first?: FirstLayout) {
    const present: Row[] = []
    for (const row of rows.values()) {
      cancelMove(row)
      const direct = row.root.parentNode === parent
      if (!untrack(row.exiting)) {
        clearExit(row)
        if (first && direct) present.push(row)
      } else if (row.exit) {
        if (!first) row.exit.finish()
      } else if (direct || !row.root.isConnected) {
        pinExit(row, direct ? first : undefined)
      }
    }
    return present
  }

  function commitLayout(first?: FirstLayout) {
    const parent = container()
    try {
      if (first && (first.parent !== parent || !parent.isConnected || reduced.matches || !parent.getClientRects().length)) {
        first = undefined
      }
      cancelMove(containerHeight)
      const present = prepareRows(parent, first)
      if (!first) return

      // Read all Last geometry before installing effects that can change it.
      const { height, poses, timing } = first
      const last = measureContainer(first.parent)
      const moves = present.map(row => ({ row, frames: moveFrames(poses.get(row), measureRow(row.root, last)) }))

      if (height !== last.height) {
        const frames = [height, last.height].map(h => ({ height: pixels(Math.max(0, h - last.heightOffset)) }))
        playMove(containerHeight, first.parent, frames, timing)
      }
      for (const { row, frames } of moves) if (frames) playMove(row, row.root, frames, timing)
    } catch (error) {
      clearEffects()
      throw error
    }
  }

  function motionPreferenceChanged(event: MediaQueryListEvent) {
    if (!event.matches) return
    cancelMove(containerHeight)
    for (const row of rows.values()) {
      cancelMove(row)
      row.exit?.finish()
    }
  }
  reduced.addEventListener('change', motionPreferenceChanged)
  onCleanup(() => {
    reduced.removeEventListener('change', motionPreferenceChanged)
    clearEffects()
  })
  return [anchor, output]
}
