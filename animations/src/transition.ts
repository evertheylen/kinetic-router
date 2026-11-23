import { onCleanup } from 'solid-js'
import { onEnter, onExit, onInOut } from '@kinetic-router/lifecycle'
import { filledAnimation, snapshotFrames, type MotionKeyframe } from './keyframes.js'
import { onReducedMotion, timing, type AnimationOptions } from './timing.js'

export type { MotionKeyframe } from './keyframes.js'

/** At least two frames per timeline, specifying the same properties throughout.
 * Explicit first/last offsets must be 0/1; intermediate offsets must be ordered. */
export type Transition =
  | { inout: readonly MotionKeyframe[]; in?: never; out?: never }
  | { inout?: never; in: readonly MotionKeyframe[]; out?: readonly MotionKeyframe[] }
  | { inout?: never; in?: readonly MotionKeyframe[]; out: readonly MotionKeyframe[] }

/** One finite iteration. The helper owns fill and playback direction. */
export type TransitionOptions = Omit<AnimationOptions, 'duration'> & {
  /** Milliseconds; default 200. A pair sets full entry/exit durations independently. */
  duration?: number | { in: number; out: number }
}

export const fade = { inout: [{ opacity: 0 }, { opacity: 1 }] } satisfies Transition
export const fadeScale = {
  inout: [{ opacity: 0, transform: 'scale(0.95)' }, { opacity: 1, transform: 'scale(1)' }],
} satisfies Transition

/** Fade and translate from an offset in pixels; reverse back to it on exit. */
export function slide({ x = 0, y = 12 }: { x?: number; y?: number } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Slide offsets must be finite')
  return { inout: [
    { opacity: 0, transform: `translate(${x}px, ${y}px)` },
    { opacity: 1, transform: 'translate(0px, 0px)' },
  ] } satisfies Transition
}

function directionalTiming(options: TransitionOptions) {
  const { duration = 200 } = options
  if (typeof duration === 'object' && (!duration || Array.isArray(duration)
    || Object.keys(duration).some(key => key !== 'in' && key !== 'out')
    || duration.in === undefined || duration.out === undefined)) {
    throw new TypeError('Directional duration requires both in and out milliseconds')
  }
  return {
    in: timing({ ...options, duration: typeof duration === 'object' ? duration.in : duration }),
    out: timing({ ...options, duration: typeof duration === 'object' ? duration.out : duration }),
  }
}

/** Changing duration must preserve progress in the active interval without scaling the delay. */
function retime(animation: Animation, { duration, delay }: ReturnType<typeof timing>) {
  const effect = animation.effect!
  const old = effect.getTiming()
  const previous = Number(old.duration)
  if (duration === previous) return
  const time = Number(animation.currentTime)
  // A collapsed interval holds an endpoint, not a fraction of elapsed time.
  const firstFrame = old.direction === 'reverse' || (time === delay && animation.playbackRate < 0)
  const progress = previous === 0 ? Number(!firstFrame) : Math.min(1, (time - delay) / previous)
  effect.updateTiming({ duration, direction: 'normal' })
  animation.currentTime = time < delay ? time : delay + progress * duration
}

/**
 * Call during setup inside a Lifecycle boundary; bind the returned ref to one element.
 * `inout` reverses one native timeline without snapping. Separate `in` / `out` use
 * the lifecycle's enter-before-exit sequencing (reentry restarts a completed enter).
 *
 * Options/keyframes are snapshotted at setup. Initial styles apply before insertion.
 * The helper owns its animated properties until disposal, including while another
 * exit handler is pending. Use a wrapper element if other code animates them too.
 * Reduced motion skips both motion and delays, including changes during playback.
 * An inout delay belongs to its hidden endpoint and is also traversed in reverse.
 * Directional durations retime the same effect at its current progress on reversal;
 * delay remains unchanged. Separate in/out effects use their respective durations.
 * Zero duration snaps the active portion; a nonzero delay is still traversed.
 * No per-frame JS, layout animation, or automatic router page transitions.
 */
export function createTransition(transition: Transition, options: TransitionOptions = {}): (element: Element) => void {
  if (Object.keys(transition).some(key => !['inout', 'in', 'out'].includes(key))
    || (transition.inout !== undefined && (transition.in !== undefined || transition.out !== undefined))) {
    throw new TypeError('Use either inout or separate in / out keyframes')
  }
  const inout = snapshotFrames(transition.inout), enter = snapshotFrames(transition.in), exit = snapshotFrames(transition.out)
  if (!inout && !enter && !exit) throw new TypeError('Provide inout, in, or out keyframes')
  const settings = directionalTiming(options)
  let animation: Animation | undefined

  function install(element: Element, frames: Keyframe[], options: AnimationOptions) {
    const next = filledAnimation(element, frames, options)
    animation?.cancel()
    return animation = next
  }

  function play(current: Animation, options: ReturnType<typeof timing>, backwards = false) {
    const end = options.delay + options.duration
    if (end === 0) {
      // Both endpoints have time 0. Select the endpoint with the effect's native
      // direction instead of seeking to a fictitious instant before the timeline.
      current.playbackRate = 1
      current.effect!.updateTiming({ duration: 0, direction: backwards ? 'reverse' : 'normal' })
      current.finish()
    } else {
      retime(current, options)
      current.updatePlaybackRate(backwards ? -1 : 1)
      // play() auto-rewinds at the target; don't replay an already reached endpoint.
      const time = Number(current.currentTime)
      if (reducedMotion.matches || (backwards ? time <= 0 : time >= end)) current.finish()
      else current.play()
    }
    return current.finished
  }

  let bind: (element: Element) => void
  if (inout) {
    bind = onInOut({
      prepare(element, { direction }) {
        const current = install(element, inout, settings[direction])
        if (direction === 'out') {
          current.currentTime = Number(current.effect!.getComputedTiming().endTime)
          current.playbackRate = -1
        }
        if (reducedMotion.matches) play(current, settings[direction], direction === 'out')
      },
      run: ({ direction }) => play(animation!, settings[direction], direction === 'out'),
    })
  } else {
    let element: Element | undefined
    const bindEnter = enter && onEnter({
      prepare(target) {
        const current = install(target, enter, settings.in)
        if (reducedMotion.matches) current.finish()
      },
      run({ element }) {
        const current = animation ?? install(element, enter, settings.in)
        current.currentTime = 0
        return play(current, settings.in)
      },
    })
    if (exit) onExit(({ signal }) => {
      if (!element) throw new Error('Bind the ref returned by createTransition')
      const outgoing = install(element, exit, settings.out)
      // Even a finished exit still owns its filled styles until reentry or disposal.
      signal.addEventListener('abort', () => {
        outgoing.cancel()
        animation = undefined
      }, { once: true })
      return play(outgoing, settings.out)
    })
    bind = target => {
      if (element === target) return
      if (element) throw new Error('Bind each createTransition ref to only one element')
      element = target
      bindEnter?.(target)
    }
  }

  const reducedMotion = onReducedMotion(() => animation?.finish())
  onCleanup(() => animation?.cancel())
  return bind
}
