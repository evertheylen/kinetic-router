import { onCleanup } from 'solid-js'
import { onEnter, onExit, onInOut, type Direction } from '@kinetic-router/lifecycle'
import { timing, type AnimationOptions } from './timing.js'

/**
 * At least two frames, with the same compositor-friendly properties on every frame.
 * Offsets must be ordered in [0, 1]; explicit first/last offsets must be 0/1.
 * Explicit endpoints also avoid browser differences in underlying-style interpolation.
 */
export type MotionKeyframe = {
  opacity?: number
  transform?: string
  offset?: number
  easing?: string
}

export type Transition =
  | { inout: readonly MotionKeyframe[]; in?: never; out?: never }
  | { inout?: never; in: readonly MotionKeyframe[]; out?: readonly MotionKeyframe[] }
  | { inout?: never; in?: readonly MotionKeyframe[]; out: readonly MotionKeyframe[] }

/** One finite iteration. The helper owns fill and playback direction. */
export type TransitionOptions = Omit<AnimationOptions, 'duration'> & {
  /** Milliseconds; default 200. A pair sets full entry/exit durations independently. */
  duration?: number | { in: number; out: number }
  /** Milliseconds; default 0. Inout traverses this delay in reverse on exit. */
  delay?: number
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

/** @internal Shared keyframe validation; returns detached snapshots. */
export function frames(input: readonly MotionKeyframe[] | undefined): Keyframe[] | undefined {
  if (input === undefined) return
  if (!Array.isArray(input) || input.length < 2) throw new TypeError('Transitions need at least two keyframes')
  if ((input[0]!.offset !== undefined && input[0]!.offset !== 0)
    || (input.at(-1)!.offset !== undefined && input.at(-1)!.offset !== 1)) {
    throw new TypeError('The first and last keyframes must be at offsets 0 and 1')
  }
  const properties = ['opacity', 'transform'] as const
  let lastOffset = 0
  return input.map(frame => {
    if (!frame || Object.keys(frame).some(key => !['opacity', 'transform', 'offset', 'easing'].includes(key))) {
      throw new TypeError('Only opacity and transform may be animated')
    }
    if (!properties.some(key => frame[key] !== undefined)
      || properties.some(key => (frame[key] !== undefined) !== (input[0]![key] !== undefined))) {
      throw new TypeError('Specify the same animated properties on every keyframe')
    }
    if (frame.opacity !== undefined && (!Number.isFinite(frame.opacity) || frame.opacity < 0 || frame.opacity > 1)) {
      throw new TypeError('Opacity must be a number between 0 and 1')
    }
    if (frame.transform !== undefined && (typeof frame.transform !== 'string' || !frame.transform.trim())) {
      throw new TypeError('Transform must be a CSS transform string')
    }
    if (frame.offset !== undefined) {
      if (!Number.isFinite(frame.offset) || frame.offset < lastOffset || frame.offset > 1) {
        throw new TypeError('Keyframe offsets must increase from 0 to 1')
      }
      lastOffset = frame.offset
    }
    return { ...frame }
  })
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
  const bidirectional = frames(transition.inout), enter = frames(transition.in), exit = frames(transition.out)
  if (!bidirectional && !enter && !exit) throw new TypeError('Provide inout, in, or out keyframes')
  const { duration = 200 } = options
  if (typeof duration === 'object' && (!duration || Array.isArray(duration)
    || Object.keys(duration).some(key => !['in', 'out'].includes(key))
    || duration.in === undefined || duration.out === undefined)) {
    throw new TypeError('Directional duration requires both in and out milliseconds')
  }
  const inward = timing({ ...options, duration: typeof duration === 'object' ? duration.in : duration })
  const outward = timing({ ...options, duration: typeof duration === 'object' ? duration.out : duration })
  const { delay, easing } = inward
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let element: Element | undefined
  let animation: Animation | undefined
  let activeDuration = inward.duration
  const endTime = () => activeDuration + delay

  function finish(current: Animation) {
    current.finish()
    // A zero-length effect has both endpoints at time 0. Sample just before it
    // for an outward finish so backwards fill applies the hidden first frame.
    if (endTime() === 0 && current.playbackRate < 0) current.currentTime = -1
  }

  function prepare(keyframes: Keyframe[], direction: Direction = 'in', milliseconds = direction === 'in' ? inward.duration : outward.duration) {
    if (!element) throw new Error('Bind the ref returned by createTransition')
    // Solid refs can receive nodes still owned by an inert template document.
    // Its timeline never ticks, even after insertion into the live document.
    activeDuration = milliseconds
    const next = new Animation(new KeyframeEffect(element, keyframes, {
      duration: milliseconds, delay, easing, fill: 'both',
    }), document.timeline)
    // Lifecycle cleanup owns filled endpoints, not browser auto-removal (Firefox
    // can otherwise discard an instantly finished effect prepared before insertion).
    next.persist()
    // Preparation may be disposed before a run ever observes this promise.
    void next.finished.catch(() => {})
    next.pause()
    next.currentTime = direction === 'in' ? 0 : endTime()
    next.playbackRate = direction === 'in' ? 1 : -1
    if (reducedMotion.matches) finish(next)
    animation?.cancel()
    animation = next
  }

  function play(direction: Direction = 'in', milliseconds = direction === 'in' ? inward.duration : outward.duration) {
    const current = animation!
    if (activeDuration !== milliseconds) {
      const time = Number(current.currentTime)
      // Preserve time in the delay, or normalized progress in the active interval.
      const mapped = time < delay ? Math.max(0, time)
        : delay + (activeDuration === 0 ? 1 : Math.min(1, (time - delay) / activeDuration)) * milliseconds
      const effect = current.effect as KeyframeEffect
      effect.updateTiming({ duration: milliseconds })
      current.currentTime = mapped
      activeDuration = milliseconds
    }
    current.updatePlaybackRate(direction === 'in' ? 1 : -1)
    // play() auto-rewinds finished animations. At the requested endpoint, don't
    // replay the entire animation (notably when reversing an entrance at time 0).
    const atTarget = direction === 'in'
      ? Number(current.currentTime) >= endTime()
      : Number(current.currentTime) <= 0
    if (reducedMotion.matches || endTime() === 0 || atTarget) finish(current)
    else current.play()
    // Aborted lifecycle waiters are ignored by the core. Do not cancel the shared
    // effect on direction changes: the next run reverses it at its current time.
    return current.finished
  }

  let bind: ((element: Element) => void) | undefined
  let preparedEnter = false
  if (bidirectional) {
    bind = onInOut({
      prepare: (_, { direction }) => prepare(bidirectional, direction),
      run: ({ direction }) => play(direction),
    })
  } else {
    if (enter) bind = onEnter({
      prepare: () => { prepare(enter); preparedEnter = true },
      run: () => {
        // Reentry starts a new standalone enter, but the first uses preparation.
        if (!preparedEnter) prepare(enter)
        preparedEnter = false
        return play()
      },
    })
    if (exit) onExit(({ signal }) => {
      prepare(exit, 'in', outward.duration)
      const outgoing = animation!
      // Also restore the underlying styles on reentry for exit-only transitions.
      signal.addEventListener('abort', () => {
        outgoing.cancel()
        if (animation === outgoing) animation = undefined
      }, { once: true })
      return play('in', outward.duration)
    })
  }

  const preferenceChanged = () => { if (reducedMotion.matches && animation) finish(animation) }
  reducedMotion.addEventListener('change', preferenceChanged)
  onCleanup(() => {
    reducedMotion.removeEventListener('change', preferenceChanged)
    animation?.cancel()
  })
  return target => {
    if (element && element !== target) throw new Error('Bind each createTransition ref to only one element')
    if (element) return
    element = target
    bind?.(target)
  }
}
