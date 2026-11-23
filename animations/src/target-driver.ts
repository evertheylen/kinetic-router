import { onCleanup } from 'solid-js'
import { filledAnimation, type AnimationTarget } from './keyframes.js'
import { onReducedMotion, type AnimationOptions, type timing } from './timing.js'

function sameTarget(a: AnimationTarget, b: AnimationTarget) {
  return a.opacity === b.opacity && a.transform === b.transform
}

/** Own a single filled target effect, including while presence work is retained. */
export function createTargetDriver(readTiming: () => ReturnType<typeof timing>) {
  let current: { element: Element; target: AnimationTarget; animation: Animation } | undefined
  const reducedMotion = onReducedMotion(() => current?.animation.finish())
  onCleanup(() => current?.animation.cancel())

  function install(element: Element, from: AnimationTarget, target: AnimationTarget, settings: AnimationOptions, snap: boolean) {
    const animation = filledAnimation(element, [{ ...from }, { ...target }], settings)
    current?.animation.cancel()
    current = { element, target, animation }
    if (snap) animation.finish()
    else animation.play()
    return animation
  }

  return {
    prepare(element: Element, initial: AnimationTarget, reduced = initial) {
      if (current) return
      const target = reducedMotion.matches ? reduced : initial
      install(element, target, target, { duration: 0 }, true)
    },
    snapTo(target: AnimationTarget) {
      if (current && !sameTarget(target, current.target)) {
        install(current.element, target, target, { duration: 0 }, true)
      }
    },
    retarget(target: AnimationTarget) {
      if (!current) return
      const { element, target: previous, animation } = current
      if (sameTarget(target, previous)) return animation

      const settings = readTiming()
      const snap = reducedMotion.matches || !element.isConnected || settings.duration + settings.delay === 0
      const from = { ...previous }
      // Leave newly claimed properties absent here so WAAPI starts from the
      // underlying style. For existing properties preserve the authored path
      // (e.g. 0deg to 360deg) unless interrupting a displayed animation.
      if (!snap && animation.playState !== 'finished') {
        const style = getComputedStyle(element)
        if (previous.opacity !== undefined) from.opacity = Number(style.opacity)
        if (previous.transform !== undefined) from.transform = style.transform
      }
      return install(element, from, target, settings, snap)
    },
  }
}
