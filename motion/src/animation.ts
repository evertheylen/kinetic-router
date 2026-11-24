import { createEffect, createSignal, getOwner, isDisposed, untrack, type Accessor } from 'solid-js'
import { snapshotTarget, type AnimationTarget } from './keyframes.js'
import { createTargetDriver } from './target-driver.js'
import { timing, type AnimationOptions } from './timing.js'

export type { AnimationTarget } from './keyframes.js'

/**
 * Call in setup and bind the ref to one element. The first target applies before
 * insertion without interpolation. Later targets animate from the previous target;
 * interrupting an active effect samples its rendered pose, not its velocity or winding.
 * Retargeting a disconnected element snaps to the new target. No Lifecycle boundary,
 * inline styles, or per-frame JavaScript are required.
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
  const [bound, setBound] = createSignal(false, { ownedWrite: true })
  const driver = createTargetDriver(() => settings)
  let element: Element | undefined
  let initial: AnimationTarget | undefined

  createEffect(() => bound() ? snapshotTarget(target()) : undefined, value => {
    if (!value || !initial) return
    if ((value.opacity === undefined) !== (initial.opacity === undefined)
      || (value.transform === undefined) !== (initial.transform === undefined)) {
      throw new TypeError('Keep the same animated properties across target changes')
    }
    driver.retarget(value)
  })

  return targetElement => {
    if (element === targetElement) return
    if (element) throw new Error('Bind each createAnimation ref to only one element')
    if (isDisposed(owner)) throw new Error('Cannot bind an animation after disposal')
    initial = snapshotTarget(untrack(target))
    driver.prepare(targetElement, initial)
    element = targetElement
    setBound(true)
  }
}
