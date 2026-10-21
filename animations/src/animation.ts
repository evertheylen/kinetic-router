import { createEffect, createSignal, getOwner, onCleanup, untrack, type Accessor } from 'solid-js'
import { frames } from './transition.js'
import { timing, type AnimationOptions } from './timing.js'

/** Scalar native targets; no transform shorthands or per-property timelines. */
export interface AnimationTarget {
  opacity?: number
  transform?: string
}

function snapshot(value: AnimationTarget): AnimationTarget {
  if (!value || Object.keys(value).some(key => !['opacity', 'transform'].includes(key))) {
    throw new TypeError('Animation targets support only opacity and transform')
  }
  return frames([value, value])![0] as AnimationTarget
}

/**
 * Animate reactive targets on one mounted element, without requiring a Lifecycle
 * boundary. Call in setup and bind the ref once. The first target is applied before
 * insertion, without interpolation; createTransition handles appearance effects.
 * Subsequent committed target changes sample the current native presentation and
 * start a finite WAAPI effect. No reads/writes occur on individual animation frames.
 *
 * Keep the same property set across updates. Options are snapshotted at setup;
 * targets are snapshotted on change. This helper exclusively owns these properties
 * until disposal; use a wrapper to combine it with a presence animation. Endpoints
 * stay filled without mutating inline styles. Reduced motion skips motion/delays,
 * including preference changes during playback. Cleanup cancels the filled effect.
 */
export function createAnimation(target: Accessor<AnimationTarget>, options: AnimationOptions = {}): (element: Element) => void {
  const settings = timing(options)
  snapshot(untrack(target))
  if (!getOwner()) throw new Error('createAnimation requires a reactive owner')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const [bound, setBound] = createSignal<Element | undefined>(undefined, { ownedWrite: true })
  let animation: Animation | undefined
  let previous: AnimationTarget | undefined

  function replace(element: Element, from: AnimationTarget, to: AnimationTarget, initial = false) {
    const next = new Animation(new KeyframeEffect(element, [{ ...from }, { ...to }], {
      ...settings, ...(initial ? { duration: 0, delay: 0 } : {}), fill: 'both',
    }), document.timeline)
    next.persist()
    void next.finished.catch(() => {})
    next.pause()
    next.currentTime = 0
    if (initial || reducedMotion.matches || settings.duration + settings.delay === 0) next.finish()
    else next.play()
    animation?.cancel()
    animation = next
    previous = to
  }

  createEffect(() => {
    const element = bound()
    return element ? { element, value: snapshot(target()) } : undefined
  }, current => {
    if (!current) return
    const { element, value } = current
    if ((value.opacity !== undefined) !== (previous?.opacity !== undefined)
      || (value.transform !== undefined) !== (previous?.transform !== undefined)) {
      throw new TypeError('Keep the same animated properties across target changes')
    }
    if (value.opacity === previous?.opacity && value.transform === previous?.transform) return
    // Read before replacing the old effect so rapid retargets remain continuous.
    const style = getComputedStyle(element)
    const from: AnimationTarget = {}
    if (value.opacity !== undefined) from.opacity = Number(style.opacity)
    if (value.transform !== undefined) from.transform = style.transform
    replace(element, from, value)
  })

  const preferenceChanged = () => { if (reducedMotion.matches) animation?.finish() }
  reducedMotion.addEventListener('change', preferenceChanged)
  onCleanup(() => {
    reducedMotion.removeEventListener('change', preferenceChanged)
    animation?.cancel()
    animation = undefined
  })
  return element => {
    if (untrack(bound) && untrack(bound) !== element) throw new Error('Bind each createAnimation ref to only one element')
    if (untrack(bound)) return
    const value = snapshot(untrack(target))
    replace(element, value, value, true)
    setBound(element)
  }
}
