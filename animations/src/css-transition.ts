import { onCleanup } from 'solid-js'
import { onEnter, onExit, onInOut, type Direction } from '@kinetic-router/lifecycle'

/** Explicit CSS property names (kebab-case) / @keyframes names; no wildcard waits. */
export type CssTransitionOptions<T extends Element = HTMLElement> = {
  /** Set classes, attributes, or styles synchronously; called before insertion too. Must be idempotent. */
  apply: (element: T, direction: Direction) => void
  /** Default inout retargets immediately; separate finishes entry before starting exit. */
  mode?: 'inout' | 'separate'
} & (
  | { properties: readonly string[]; animations?: readonly string[] }
  | { properties?: readonly string[]; animations: readonly string[] }
)

/**
 * Bridge authored CSS to a Lifecycle boundary. Bind the returned ref to one element.
 * Only that element's selected finite CSS transitions/animations retain the boundary;
 * descendants, WAAPI effects, unrelated decorations, and infinite loops are ignored.
 * Names/mode are snapshotted at setup. CSS owns timing, interpolation and endpoints.
 * Use @starting-style for an initial transition, or animation-fill-mode: both for
 * keyframes with a delay. No layout measurements or JS animation loop are added.
 * CSS layout-property transitions may cause browser reflow each frame; they do not
 * run per-frame JavaScript. Use opacity/transform when compositor-only motion matters.
 *
 * Reentry retargets CSS, never cancels the visual effect on an old waiter's abort.
 * CSS cancellations count as completion. Reduced motion finishes selected effects
 * (also on preference changes); author CSS media rules for unselected decorations.
 * Use a separate wrapper when combining layout CSS with createTransition's transforms.
 * A final unmount removes listeners; CSS effects remain owned by the stylesheet.
 */
export function createCssTransition<T extends Element = HTMLElement>(options: CssTransitionOptions<T>): (element: T) => void {
  const { apply, mode = 'inout' } = options
  if ((options.properties !== undefined && !Array.isArray(options.properties))
    || (options.animations !== undefined && !Array.isArray(options.animations))) {
    throw new TypeError('CSS property and animation names must be arrays')
  }
  const properties = [...(options.properties ?? [])], animations = [...(options.animations ?? [])]
  if (typeof apply !== 'function' || !['inout', 'separate'].includes(mode)
    || (!properties.length && !animations.length)
    || [...properties, ...animations].some(name => typeof name !== 'string' || !name.trim() || name === 'all')) {
    throw new TypeError('Provide apply, explicit CSS property/animation names, and an inout or separate mode')
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let element: T | undefined
  let active: Animation[] = []

  function finishSelected() {
    if (!reducedMotion.matches) return
    for (const animation of active) {
      // A CSS media rule may already have cancelled the effect.
      if (animation.playState !== 'idle') animation.finish()
    }
  }

  function run(direction: Direction, signal: AbortSignal) {
    if (!element) throw new Error('Bind the ref returned by createCssTransition')
    apply(element, direction)
    // getAnimations flushes style, including newly created CSS transitions.
    const selected = element.getAnimations().filter(animation =>
      ((animation instanceof CSSTransition && properties.includes(animation.transitionProperty))
        || (animation instanceof CSSAnimation && animations.includes(animation.animationName)))
      && Number.isFinite(animation.effect?.getComputedTiming().endTime),
    )
    active = selected
    const finished = Promise.allSettled(selected.map(animation => animation.finished))
    finishSelected()
    return new Promise<void>(resolve => {
      const done = () => {
        signal.removeEventListener('abort', done)
        if (active === selected) active = []
        resolve()
      }
      signal.addEventListener('abort', done, { once: true })
      if (signal.aborted) done()
      void finished.then(done)
    })
  }

  const bind = mode === 'inout' ? onInOut<T>({
    prepare: (target, { direction }) => apply(target, direction),
    run: ({ direction, signal }) => run(direction, signal),
  }) : onEnter<T>({
    prepare: target => apply(target, 'in'),
    run: ({ signal }) => run('in', signal),
  })
  if (mode === 'separate') onExit(({ signal }) => run('out', signal))

  reducedMotion.addEventListener('change', finishSelected)
  onCleanup(() => {
    reducedMotion.removeEventListener('change', finishSelected)
    active = []
  })
  return target => {
    if (element && element !== target) throw new Error('Bind each createCssTransition ref to only one element')
    if (element) return
    element = target
    bind(target)
  }
}
