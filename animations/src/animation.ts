import { createEffect, createSignal, getOwner, isDisposed, onCleanup, untrack, type Accessor } from 'solid-js'
import { filledAnimation, snapshotTarget, type AnimationTarget } from './keyframes.js'
import { onReducedMotion, timing, type AnimationOptions } from './timing.js'

export type { AnimationTarget } from './keyframes.js'

/**
 * Call in setup and bind the ref to one element. The first target applies before
 * insertion without interpolation. Later targets animate from the previous target;
 * interrupting an active effect samples its rendered pose, not its velocity or winding.
 * No Lifecycle boundary, inline styles, or per-frame JavaScript are required.
 *
 * Keep the same property set across updates. Options are snapshotted at setup;
 * targets are snapshotted at binding and on change. This helper owns those properties
 * until disposal. Use a wrapper to combine it with a presence animation. Reduced
 * motion skips delays as well as movement; cleanup restores the underlying styles.
 */
export function createAnimation(target: Accessor<AnimationTarget>, options: AnimationOptions = {}): (element: Element) => void {
  const settings = timing(options)
  const owner = getOwner()
  if (!owner) throw new Error('createAnimation requires a reactive owner')
  const [bound, setBound] = createSignal<Element | undefined>(undefined, { ownedWrite: true })
  let animation: Animation | undefined
  let previous: AnimationTarget
  const reducedMotion = onReducedMotion(() => animation?.finish())
  onCleanup(() => animation?.cancel())

  createEffect(() => {
    const element = bound()
    return element && { element, value: snapshotTarget(target()) }
  }, update => {
    if (!update || !animation) return
    const { element, value } = update
    if ((value.opacity === undefined) !== (previous.opacity === undefined)
      || (value.transform === undefined) !== (previous.transform === undefined)) {
      throw new TypeError('Keep the same animated properties across target changes')
    }
    if (value.opacity === previous.opacity && value.transform === previous.transform) return

    const snap = reducedMotion.matches || !element.isConnected || settings.duration + settings.delay === 0
    const from = { ...previous }
    // Computed transforms are matrices: sampling a *settled* rotate(0deg)
    // would lose the authored interpolation path to e.g. rotate(360deg).
    if (!snap && animation.playState !== 'finished') {
      const style = getComputedStyle(element)
      if (value.opacity !== undefined) from.opacity = Number(style.opacity)
      if (value.transform !== undefined) from.transform = style.transform
    }
    const next = filledAnimation(element, [from, { ...value }], settings)
    if (snap) next.finish()
    else next.play()
    animation.cancel()
    animation = next
    previous = value
  })

  return element => {
    if (animation) {
      if ((animation.effect as KeyframeEffect).target === element) return
      throw new Error('Bind each createAnimation ref to only one element')
    }
    if (isDisposed(owner)) throw new Error('Cannot bind an animation after disposal')
    previous = snapshotTarget(untrack(target))
    animation = filledAnimation(element, [{ ...previous }, { ...previous }], { duration: 0 })
    animation.finish()
    setBound(element)
  }
}
