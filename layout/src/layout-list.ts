import { Lifecycle, onInOut, useLifecycle, type ForProps } from '@kinetic-router/lifecycle'
import { children, createMemo, onCleanup, type Accessor, type Element as SolidElement } from 'solid-js'

/** Native timing sampled at each structural change. Duration is seconds (default
 * 0.25); zero skips animation. Ease is a CSS easing string (default 'ease-out'). */
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
  exit?: Animation
}

function isHTMLRoot(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement
}

function pixels(value: number) { return `${value}px` }
function length(value: string) { return Number.parseFloat(value) || 0 }

function measureContainer(container: HTMLElement) {
  const rect = container.getBoundingClientRect()
  const style = getComputedStyle(container)
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

function capture(container: HTMLElement, rows: Iterable<Row>) {
  const box = measureContainer(container)
  const poses = new Map<HTMLElement, ReturnType<typeof measureRow>>()
  for (const { root } of rows) if (root.parentNode === container) poses.set(root, measureRow(root, box))
  return { height: box.height, poses }
}

/**
 * Client-only keyed FLIP list. The callback receives item/index accessors and
 * renders one stable, direct HTML element (including a component with that
 * output). Keys default to item identity and must be unique. No wrappers or
 * forwarded refs; Solid owns all insertion, reorder and disposal. Same-key undo
 * during an exit restores the same row owner and DOM.
 *
 * Use one authored, positioned HTML parent with natural height and untransformed
 * geometry. Rows must lay out normally and not redistribute spare height (e.g.
 * use `align-content: start` on a grid). Put visual transforms on a child of the
 * row. While animating, LayoutList controls row translate/opacity and the box
 * geometry of exiting rows, plus parent height; don't animate those same CSS
 * properties independently. Inline styles are not changed. Initial rows do not
 * enter; structural changes after mount do. Reduced motion disables playback.
 */
export function LayoutList<T>(props: LayoutListProps<T>): SolidElement {
  const render = props.children
  // A layout-inert anchor lets the first insertion into an empty list measure
  // its authored parent before Solid has any row elements to insert.
  const anchor = document.createComment('LayoutList')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const rows = new Map<HTMLElement, Row>()
  const effects = new Map<HTMLElement, Animation>()
  let before: ReturnType<typeof capture> | undefined

  function clearEffect(root: HTMLElement) {
    const effect = effects.get(root)
    if (!effect) return
    effects.delete(root)
    const row = rows.get(root)
    if (row?.exit === effect) row.exit = undefined
    effect.cancel()
  }

  function clear() {
    before = undefined
    for (const root of effects.keys()) clearEffect(root)
  }

  function play(root: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions, exit?: Row) {
    const animation = root.animate(frames, { ...timing, fill: 'both' })
    effects.set(root, animation)
    if (exit) exit.exit = animation
    const clearCurrent = () => { if (effects.get(root) === animation) clearEffect(root) }
    // Finished exits remain pinned and invisible if independent lifecycle
    // handlers still hold the row. Its owner disposes the pin on removal.
    void animation.finished.then(exit ? undefined : clearCurrent, clearCurrent)
    return animation
  }

  function container() {
    const parent = anchor.parentElement
    return isHTMLRoot(parent) && parent.isConnected ? parent : undefined
  }

  const output = Lifecycle.For({
    get each() { return props.each },
    get by() { return props.by },
    onBeforeChange() {
      const parent = container()
      try {
        if (parent && !before && typeof parent.animate === 'function') before = capture(parent, rows.values())
      } catch (error) {
        clear()
        throw error
      }
      return apply
    },
    children(item, index) {
      const { phase } = useLifecycle()
      const content = children(() => render(item, index))
      let row: Row | undefined
      onInOut(({ direction }) => direction === 'out' ? row?.exit?.finished.catch(() => undefined) : undefined)
      onCleanup(() => {
        if (!row) return
        clearEffect(row.root)
        rows.delete(row.root)
      })
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

  function apply() {
    const old = before
    before = undefined
    const parent = container()
    try {
      if (!old || !parent) { clear(); return }
      const committed = [...rows.values()].filter(row => row.root.parentNode === parent)
        .map(row => ({ row, exiting: row.exiting() }))
      for (const [root, animation] of effects) {
        const row = rows.get(root)
        // An unrelated edit must not restart an already-exiting row's fade or
        // postpone the completion that its lifecycle handler is waiting for.
        if (row?.exit === animation && row.exiting()) continue
        clearEffect(root)
      }
      const { duration = 0.25, ease: easing = 'ease-out' } = props.transition ?? {}
      if (!Number.isFinite(duration * 1000) || duration < 0) throw new TypeError('LayoutList duration must be finite non-negative seconds')
      const instant = reduced.matches || duration === 0
      const timing = instant ? { duration: 0 } : { duration: duration * 1000, easing }
      for (const { row, exiting } of committed) if (exiting) {
        if (row.exit) {
          if (instant) row.exit.finish()
          continue
        }
        const pose = old.poses.get(row.root)
        if (!pose) continue
        const { left, top, width, height, opacity } = pose
        const pin: Keyframe = {
          position: 'absolute', boxSizing: 'border-box',
          left: pixels(left), top: pixels(top), right: 'auto', bottom: 'auto',
          width: pixels(width), height: pixels(height),
          minWidth: '0px', minHeight: '0px', maxWidth: 'none', maxHeight: 'none',
          marginLeft: '0px', marginRight: '0px', marginTop: '0px', marginBottom: '0px',
        }
        const animation = play(row.root, [{ ...pin, opacity }, { ...pin, opacity: 0 }], timing, row)
        if (instant) animation.finish()
      }
      if (instant) return
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
      if (rows.get(root)?.exit === animation) animation.finish()
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
