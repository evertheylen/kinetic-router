import { onEnter, onExit, onInOut, type AnimationAdapter, type Direction } from '@kinetic-router/lifecycle'

/** Exact CSS longhand/custom property names or @keyframes names; no wildcard waits. */
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
 * Each run snapshots the effects after applying its target. They must be able to
 * finish: pausing or retiming one to infinity can retain an exit. Reentry retargets
 * CSS; aborting the old run does not cancel its effects. CSS cancellation settles
 * the wait. Reduced motion finishes selected effects (cancels any that can no
 * longer finish); author CSS media rules for unselected decorations.
 * Use a separate wrapper when combining layout CSS with createTransition's transforms.
 * A dormant route defers `apply('in')` until live presentation. Author a resting
 * pose before that target is applied (for example, a selector without the active
 * class). Parking applies the `out` pose while detached so cached output can replay.
 * CSS that starts on insertion without `apply` is not suspended by this helper,
 * and `@starting-style` alone may already match in Backstage.
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
    || properties.includes('all') || [...properties, ...animations].some(name => typeof name !== 'string' || !name.trim())) {
    throw new TypeError('Provide apply, explicit CSS property/animation names, and an inout or separate mode')
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let commitRestingStyle = false

  function selectedEffects(element: T) {
    // getAnimations reflects pending style changes, including the transition just created.
    return element.getAnimations().filter(animation =>
      ((animation instanceof CSSTransition && properties.includes(animation.transitionProperty))
        || (animation instanceof CSSAnimation && animations.includes(animation.animationName)))
      && Number.isFinite(animation.effect?.getComputedTiming().endTime),
    )
  }

  function finishEffects(selected: Animation[]) {
    for (const animation of selected) {
      if (animation.playState === 'idle') continue // already cancelled by a CSS media rule
      try { animation.finish() }
      catch (error) {
        // CSS or another script can change a selected effect to infinite or zero-rate.
        if ((error as DOMException).name !== 'InvalidStateError') throw error
        animation.cancel()
      }
    }
  }

  function run({ element, direction, signal }: { element: T; direction: Direction; signal: AbortSignal }) {
    if (commitRestingStyle) {
      // A staged/cached node may have been reparented before this commit. Establish
      // the resting style in the live outlet before changing the transition target.
      element.getAnimations()
      commitRestingStyle = false
    }
    apply(element, direction)
    const selected = selectedEffects(element)
    if (!selected.length) return
    const finished = Promise.allSettled(selected.map(animation => animation.finished))
    function finishSelected() {
      if (reducedMotion.matches) finishEffects(selected)
    }
    reducedMotion.addEventListener('change', finishSelected, { signal })
    finishSelected()
    return finished.finally(() => reducedMotion.removeEventListener('change', finishSelected))
  }

  const adapter: AnimationAdapter<T> = {
    prepare(target, { direction, dormant }) {
      if (dormant) commitRestingStyle = true
      else apply(target, direction)
    },
    run,
    park(target) {
      apply(target, 'out')
      commitRestingStyle = true
    },
    snap(target) {
      commitRestingStyle = false
      apply(target, 'in')
      finishEffects(selectedEffects(target))
    },
  }
  if (mode === 'inout') return onInOut(adapter)

  let element: T | undefined
  const bind = onEnter(adapter)
  onExit(({ signal }) => {
    if (!element) throw new Error('Bind the ref returned by createCssTransition')
    return run({ element, direction: 'out', signal })
  })
  return target => { bind(target); element = target }
}
