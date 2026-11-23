import { onCleanup } from 'solid-js'
import { filledAnimation, type AnimationTarget } from './keyframes.js'
import { onReducedMotion, type AnimationOptions, type timing } from './timing.js'

/** Own a single filled target effect, including while presence work is retained. */
export function createTargetDriver({ snapDetached = true } = {}) {
  let animation: Animation | undefined
  const reducedMotion = onReducedMotion(() => animation?.finish())
  onCleanup(() => animation?.cancel())

  return (element: Element, initial: AnimationTarget, reduced = initial) => {
    let previous = reducedMotion.matches ? reduced : initial

    function install(from: AnimationTarget, to: AnimationTarget, options: AnimationOptions, snap: boolean) {
      const next = filledAnimation(element, [{ ...from }, { ...to }], options)
      animation?.cancel()
      animation = next
      previous = to
      if (snap) next.finish()
      else next.play()
      return next
    }

    install(previous, previous, { duration: 0 }, true)
    return (value: AnimationTarget, options: () => ReturnType<typeof timing>) => {
      if ((value.opacity === undefined) !== (previous.opacity === undefined)
        || (value.transform === undefined) !== (previous.transform === undefined)) {
        throw new TypeError('Keep the same animated properties across target changes')
      }
      if (value.opacity === previous.opacity && value.transform === previous.transform) return animation!

      const settings = options()
      const snap = reducedMotion.matches || (snapDetached && !element.isConnected)
        || settings.duration + settings.delay === 0
      const from = { ...previous }
      // A settled target retains its authored interpolation path (e.g. 0deg to
      // 360deg). Only interruptions need the displayed pose, which may be a matrix.
      if (!snap && animation!.playState !== 'finished') {
        const style = getComputedStyle(element)
        if (value.opacity !== undefined) from.opacity = Number(style.opacity)
        if (value.transform !== undefined) from.transform = style.transform
      }
      return install(from, value, settings, snap)
    }
  }
}
