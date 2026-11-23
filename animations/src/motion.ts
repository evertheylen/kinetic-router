import { Lifecycle, onInOut, useLifecycle, type ShowProps } from '@kinetic-router/lifecycle'
import { dynamic, type JSX } from '@solidjs/web'
import { createEffect, createMemo, merge, omit, untrack } from 'solid-js'
import type { AnimationTarget } from './keyframes.js'
import { createTargetDriver } from './target-driver.js'
import { timing } from './timing.js'

/** Finite scalars: opacity in [0, 1], x/y in pixels, rotate in degrees. */
export interface MotionTarget {
  opacity?: number
  x?: number
  y?: number
  rotate?: number
  scale?: number
}

/** A single native timing, in seconds. Defaults: 0.2s, no delay, 'easeOut'. */
export interface MotionTransition {
  duration?: number
  delay?: number
  /** CSS easing, or 'easeIn', 'easeOut', 'easeInOut'. */
  ease?: string
}

type MotionTag = keyof HTMLElementTagNameMap & keyof JSX.IntrinsicElements
interface MotionOptions {
  animate: MotionTarget
  /** Overlay on the first animate target. Omit or use false to snap to animate at the first present commit. */
  initial?: MotionTarget | false
  /** Overlay on the last present target, sampled at removal. Enable with a target at mount inside a lifecycle boundary. */
  exit?: MotionTarget
  /** Sampled at the start of each move, not used to retime a running effect. */
  transition?: MotionTransition
}

export type MotionProps<Tag extends MotionTag> = Omit<JSX.IntrinsicElements[Tag], keyof MotionOptions> & MotionOptions

/** The lifecycle's retained conditional, not a detector for arbitrary child removal. */
export const AnimatePresence: <T>(props: ShowProps<T>) => JSX.Element = Lifecycle.Show

const targetKeys = ['opacity', 'x', 'y', 'rotate', 'scale'] as const

function snapshotMotionTarget(target: MotionTarget): MotionTarget {
  if (!target || typeof target !== 'object' || Array.isArray(target)
    || Object.keys(target).some(key => !targetKeys.some(channel => channel === key))) {
    throw new TypeError('Motion targets support only opacity, x, y, rotate, and scale')
  }
  const value: MotionTarget = {}
  for (const key of targetKeys) {
    const channel = target[key]
    if (channel === undefined) continue
    if (!Number.isFinite(channel) || (key === 'opacity' && (channel < 0 || channel > 1))) {
      throw new TypeError(`Motion ${key} must be ${key === 'opacity' ? 'a number between 0 and 1' : 'a finite number'}`)
    }
    value[key] = channel
  }
  return value
}

function hasTransform({ x, y, rotate, scale }: MotionTarget) {
  return x !== undefined || y !== undefined || rotate !== undefined || scale !== undefined
}

function motionTiming({ duration = 0.2, delay = 0, ease = 'easeOut', ...rest }: MotionTransition = {}) {
  if (!Number.isFinite(duration) || !Number.isFinite(delay) || Object.keys(rest).length) {
    throw new TypeError('Motion transition accepts finite duration and delay in seconds, and a CSS ease string')
  }
  const easing = ease === 'easeIn' ? 'ease-in' : ease === 'easeOut' ? 'ease-out' : ease === 'easeInOut' ? 'ease-in-out' : ease
  return timing({ duration: duration * 1000, delay: delay * 1000, easing })
}

function motionTag<Tag extends MotionTag>(tag: Tag) {
  const Native = dynamic<MotionTag>(() => tag, { static: true })
  return (props: MotionProps<Tag>) => {
    const readExit = () => {
      const value = props.exit
      return value === undefined ? undefined : snapshotMotionTarget(value)
    }
    let present = untrack(() => snapshotMotionTarget(props.animate))
    const initial = untrack(() => {
      const value = props.initial
      return value === false || value === undefined ? undefined : snapshotMotionTarget(value)
    })
    let skipInitialMotion = initial === undefined
    const exit = untrack(readExit)
    const lifecycle = exit && useLifecycle()
    const declared = { ...present, ...initial, ...exit }
    let ownsOpacity = declared.opacity !== undefined
    let ownsTransform = hasTransform(declared)
    if (!ownsOpacity && !ownsTransform) throw new TypeError('Specify at least one motion target property')

    function target(pose: MotionTarget): AnimationTarget {
      ownsOpacity ||= pose.opacity !== undefined
      ownsTransform ||= hasTransform(pose)
      const { opacity = 1, x = 0, y = 0, rotate = 0, scale = 1 } = pose
      return {
        ...(ownsOpacity && { opacity }),
        ...(ownsTransform && { transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale})` }),
      }
    }

    const driver = createTargetDriver(() => untrack(() => motionTiming(props.transition)))
    function bind(element: Element) {
      const visible = target(present)
      const exiting = untrack(() => lifecycle?.phase()) === 'exiting'
      if (exiting) skipInitialMotion = false
      const first = target({ ...present, ...(exiting ? exit : initial) })
      driver.prepare(element, first, exiting ? first : visible)
    }

    if (lifecycle) onInOut(({ direction }) => {
      // onInOut does not wait for an unrelated enter. Keep the old fill until
      // a committed restore can retarget it; final owner cleanup cancels it.
      if (direction !== 'out') return
      const overlay = untrack(readExit)
      if (overlay === undefined) return
      skipInitialMotion = false
      return driver.retarget(target({ ...present, ...overlay }))?.finished
    })

    createEffect(() => lifecycle?.phase() !== 'exiting' ? snapshotMotionTarget(props.animate) : undefined, pose => {
      if (!pose) return
      present = pose
      const next = target(pose)
      // The ref can prepare before Loading holds the first present commit.
      if (skipInitialMotion) driver.snapTo(next)
      else driver.retarget(next)
      skipInitialMotion = false
    })

    const ref = createMemo(() => {
      const consumer = props.ref
      return typeof consumer === 'function' || Array.isArray(consumer) ? [bind, consumer] : bind
    })
    const nativeProps = omit(props, 'animate', 'initial', 'exit', 'transition')
    return Native(merge(nativeProps, { get ref() { return ref() } }) as JSX.IntrinsicElements[MotionTag])
  }
}

/**
 * Client-only HTML motion components. Declare at least one motion property at
 * mount across animate/initial/exit. Motion only owns the CSS families requested
 * by its targets: opacity and the combined transform (translate, rotate, scale).
 * Later targets can claim a family, starting from its underlying style. Once
 * claimed, omitted components return to neutral (opacity/scale 1, x/y/rotate 0).
 * Retargeting while disconnected snaps. While exiting, only the exit target is
 * applied; restore uses the latest animate.
 */
export const motion = {
  div: motionTag('div'),
  span: motionTag('span'),
  section: motionTag('section'),
  button: motionTag('button'),
  li: motionTag('li'),
  /** Create a component for another native HTML tag. Hoist it as a stable component. */
  create: motionTag,
}
