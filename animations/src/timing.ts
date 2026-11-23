import { onCleanup } from 'solid-js'

/** One finite native animation; timings are milliseconds. Easing must be valid CSS. */
export interface AnimationOptions {
  duration?: number
  delay?: number
  easing?: string
}

/** @internal Shared validation for native helpers. */
export function timing(options: AnimationOptions = {}) {
  const { duration = 200, delay = 0, easing = 'ease-out' } = options
  if (Object.keys(options).some(key => !['duration', 'delay', 'easing'].includes(key))
    || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(delay) || delay < 0
    || !Number.isFinite(duration + delay) || typeof easing !== 'string' || !easing.trim()) {
    throw new TypeError('Animations require finite, non-negative duration and delay, and a CSS easing string')
  }
  return { duration, delay, easing }
}

/** Finish owned motion when the user changes their preference during playback. */
export function onReducedMotion(finish: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const changed = () => { if (media.matches) finish() }
  media.addEventListener('change', changed)
  onCleanup(() => media.removeEventListener('change', changed))
  return media
}
