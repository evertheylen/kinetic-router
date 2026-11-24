import { Lifecycle, onInOut, useLifecycle, type ForProps } from '@kinetic-router/lifecycle'
import { children, createMemo, onCleanup, untrack, type Accessor, type Element as SolidElement } from 'solid-js'

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
  return node instanceof HTMLElement
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

function capture(container: HTMLElement, rows: Iterable<Row>) {
  const style = getComputedStyle(container)
  if (style.position === 'static') {
    throw new TypeError('LayoutList requires a positioned parent; set position: relative on its parent')
  }
  const box = measureContainer(container, style)
  const poses = new Map<HTMLElement, Pose>()
  for (const { root, exit } of rows) {
    if (root.parentNode === container && exit?.hasPose !== false) poses.set(root, measureRow(root, box))
  }
  return { parent: container, height: box.height, poses }
}

/**
 * Client-only keyed FLIP list. The callback receives item/index accessors and
 * runs once per row owner and returns one stable, direct HTML element (including
 * a component with that output). Keys default to item identity and must be unique.
 * No wrappers or forwarded refs; Solid owns insertion, reorder and disposal.
 * Same-key undo during an exit restores the same row owner and DOM.
 *
 * Use one authored HTML parent with non-static positioning (e.g. `position: relative`),
 * natural height and untransformed geometry. Positioning is checked when measuring
 * a structural change for motion. Rows must lay out normally and not redistribute
 * spare height (e.g. use `align-content: start` on a grid). Put visual transforms on
 * a child of the row. While animating, LayoutList controls row translate/opacity,
 * the positioning and box geometry of exiting rows, and parent height; don't
 * animate those same CSS properties independently. Inline styles are not changed.
 * Initial rows do not enter; structural changes after mount do. Reduced motion
 * disables playback. A structural change while detached snaps to the new layout
 * and keeps any retained exits invisible and out of flow.
 */
export function LayoutList<T>(props: LayoutListProps<T>): SolidElement {
  const render = props.children
  // A layout-inert anchor lets the first insertion into an empty list measure
  // its authored parent before Solid has any row elements to insert.
  const anchor = document.createComment('LayoutList')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const rows = new Map<HTMLElement, Row>()
  const effects = new Map<HTMLElement, Animation>()

  function clearEffect(root: HTMLElement) {
    const effect = effects.get(root)
    if (!effect) return
    effects.delete(root)
    const row = rows.get(root)
    if (row?.exit?.animation === effect) row.exit = undefined
    effect.cancel()
  }

  function clear() {
    for (const root of effects.keys()) clearEffect(root)
  }

  function play(root: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions, holdFinished = false) {
    const animation = root.animate(frames, { ...timing, fill: 'both' })
    effects.set(root, animation)
    const clearCurrent = () => { if (effects.get(root) === animation) clearEffect(root) }
    // Finished exits remain pinned and invisible if independent lifecycle
    // handlers still hold the row. Its owner disposes the pin on removal.
    void animation.finished.then(holdFinished ? undefined : clearCurrent, clearCurrent)
    return animation
  }

  function pinExit(row: Row, pose: Pose | undefined, timing: KeyframeAnimationOptions) {
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
    // With no measurable pose, only apply the invisible, out-of-flow endpoint.
    const animation = play(row.root, [{ ...pin, opacity: pose?.opacity ?? 0 }, { ...pin, opacity: 0 }],
      pose ? timing : { duration: 0 }, true)
    row.exit = { animation, hasPose: !!pose }
    if (!pose || timing.duration === 0) animation.finish()
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
      if (!parent?.isConnected || typeof parent.animate !== 'function') return apply
      try {
        const timing = untrack(transitionTiming)
        const before = capture(parent, rows.values())
        return () => apply(before, timing)
      } catch (error) {
        clear()
        throw error
      }
    },
    children(item, index) {
      const { phase } = useLifecycle()
      let row: Row | undefined
      onInOut(({ direction }) => direction === 'out' ? row?.exit?.animation.finished.catch(() => undefined) : undefined)
      onCleanup(() => {
        if (!row) return
        clearEffect(row.root)
        rows.delete(row.root)
      })
      // Lifecycle.For invokes setup untracked in the row owner. Resolve only its
      // returned JSX reactively, never the row factory itself.
      const output = render(item, index)
      const content = children(() => output)
      return createMemo(() => {
        const roots = content.toArray().filter(node => node != null && typeof node !== 'boolean' && node !== '')
        const root = roots[0]
        if (roots.length !== 1 || !isHTMLRoot(root)) throw new TypeError('LayoutList requires one stable HTML root per row')
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

  function apply(before?: ReturnType<typeof capture>, sampled: KeyframeAnimationOptions = { duration: 0 }) {
    const parent = container()
    const old = parent?.isConnected && before?.parent === parent ? before : undefined
    try {
      const timing = old && !reduced.matches ? sampled : { duration: 0 }
      for (const [root, animation] of effects) {
        const row = rows.get(root)
        // Keep an exit's endpoint through unrelated edits, even when cached
        // output is detached. Do not restart its fade or its lifecycle wait.
        if (row?.exit?.animation === animation && untrack(row.exiting)) {
          if (timing.duration === 0 && animation.playState !== 'finished') animation.finish()
        } else clearEffect(root)
      }
      if (!parent) return
      const committed = [...rows.values()].filter(row => row.root.parentNode === parent)
        .map(row => ({ row, exiting: untrack(row.exiting) }))
      for (const { row, exiting } of committed) {
        if (exiting && !row.exit && typeof row.root.animate === 'function') {
          pinExit(row, old?.poses.get(row.root), timing)
        }
      }
      if (!old || timing.duration === 0) return
      const lastBox = measureContainer(parent)
      const moves = committed.filter(({ exiting }) => !exiting).map(({ row: { root } }) => {
        const last = measureRow(root, lastBox)
        const first = old.poses.get(root)
        const from: Keyframe = {}, to: Keyframe = {}
        if (first && (first.left !== last.left || first.top !== last.top)) {
          from.translate = `${pixels(first.left - last.left)} ${pixels(first.top - last.top)}`
          to.translate = '0px 0px'
        }
        if (!first || first.opacity !== last.opacity) {
          from.opacity = first?.opacity ?? 0
          to.opacity = last.opacity
        }
        return { root, from, to }
      })
      if (old.height !== lastBox.height) {
        play(parent, [old.height, lastBox.height].map(value => ({ height: pixels(Math.max(0, value - lastBox.heightOffset)) })), timing)
      }
      for (const { root, from, to } of moves) if (Object.keys(from).length) play(root, [from, to], timing)
    } catch (error) {
      clear()
      throw error
    }
  }

  function motionPreferenceChanged(event: MediaQueryListEvent) {
    if (!event.matches) return
    for (const [root, animation] of effects) {
      if (rows.get(root)?.exit?.animation === animation) animation.finish()
      else clearEffect(root)
    }
  }
  reduced.addEventListener('change', motionPreferenceChanged)
  onCleanup(() => {
    reduced.removeEventListener('change', motionPreferenceChanged)
    clear()
  })
  return [anchor, output]
}
