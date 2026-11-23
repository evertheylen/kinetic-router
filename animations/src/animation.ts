import { createEffect, createSignal, getOwner, isDisposed, untrack, type Accessor } from 'solid-js'
import { snapshotTarget, type AnimationTarget } from './keyframes.js'
import { createTargetDriver } from './target-driver.js'
import { timing, type AnimationOptions } from './timing.js'

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
  const [bound, setBound] = createSignal(false, { ownedWrite: true })
  const bind = createTargetDriver()
  let element: Element | undefined
  let move: ReturnType<typeof bind>

  createEffect(() => bound() ? snapshotTarget(target()) : undefined, value => {
    if (value) move(value, () => settings)
  })

  return targetElement => {
    if (element === targetElement) return
    if (element) throw new Error('Bind each createAnimation ref to only one element')
    if (isDisposed(owner)) throw new Error('Cannot bind an animation after disposal')
    move = bind(targetElement, snapshotTarget(untrack(target)))
    element = targetElement
    setBound(true)
  }
}
