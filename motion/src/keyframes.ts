import type { AnimationOptions } from './timing.js'

/** Scalar native targets; no transform shorthands or per-property timelines. */
export interface AnimationTarget {
  opacity?: number
  transform?: string
}

/** An explicit opacity/transform frame. CSS transform and easing syntax belong to the browser. */
export interface MotionKeyframe extends AnimationTarget {
  offset?: number
  easing?: string
}

function validateProperties({ opacity, transform }: AnimationTarget) {
  if (opacity === undefined && transform === undefined) throw new TypeError('Specify opacity or transform')
  if (opacity !== undefined && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)) {
    throw new TypeError('Opacity must be a number between 0 and 1')
  }
  if (transform !== undefined && (typeof transform !== 'string' || !transform.trim())) {
    throw new TypeError('Transform must be a CSS transform string')
  }
}

export function snapshotTarget(value: AnimationTarget): AnimationTarget {
  if (!value || Object.keys(value).some(key => key !== 'opacity' && key !== 'transform')) {
    throw new TypeError('Animation targets support only opacity and transform')
  }
  const copy = { ...value }
  validateProperties(copy)
  return copy
}

/** At least two frames with the same properties, ordered from offset 0 to 1. */
export function snapshotFrames(input: readonly MotionKeyframe[] | undefined): Keyframe[] | undefined {
  if (input === undefined) return
  if (!Array.isArray(input) || input.length < 2) throw new TypeError('Transitions need at least two keyframes')
  const first = input[0]!, last = input.at(-1)!
  if ((first.offset ?? 0) !== 0 || (last.offset ?? 1) !== 1) {
    throw new TypeError('The first and last keyframes must be at offsets 0 and 1')
  }
  let lastOffset = 0
  return input.map(frame => {
    if (!frame || Object.keys(frame).some(key => !['opacity', 'transform', 'offset', 'easing'].includes(key))) {
      throw new TypeError('Only opacity and transform may be animated')
    }
    validateProperties(frame)
    if ((frame.opacity === undefined) !== (first.opacity === undefined)
      || (frame.transform === undefined) !== (first.transform === undefined)) {
      throw new TypeError('Specify the same animated properties on every keyframe')
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

/** Solid refs may still belong to an inert template document. Prepare on the live
 * timeline, held at time zero until play(), and keep filled endpoints until cancel(). */
export function filledAnimation(element: Element, frames: Keyframe[], options: AnimationOptions) {
  const effect = new KeyframeEffect(element, frames, { ...options, fill: 'both' })
  const animation = new Animation(effect, document.timeline)
  animation.persist()
  animation.currentTime = 0
  return animation
}
