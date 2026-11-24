import { PresenceContext, requirePresenceScope } from '@kinetic-router/presence'
import { dynamic, type JSX } from '@solidjs/web'
import { createEffect, createMemo, flatten, merge, omit, untrack, useContext } from 'solid-js'
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

/** Component timing in seconds. Defaults: 0.2s, no delay, 'easeOut'. */
export interface MotionTransition {
  duration?: number
  delay?: number
  /** CSS easing, or 'easeIn', 'easeOut', 'easeInOut'. */
  ease?: string
  /** Native options with `easing` use milliseconds, not component timing. */
  easing?: never
}

type MotionTag = keyof HTMLElementTagNameMap & keyof JSX.IntrinsicElements
interface MotionOptions {
  animate: MotionTarget
  /** Overlay on the first animate target. Omit or use false to snap to animate at the first present commit. */
  initial?: MotionTarget | false
  /** Overlay on the last present target, sampled at removal. Enable with a target at mount inside a lifecycle or routed page boundary. */
  exit?: MotionTarget
  /** Sampled at the start of each move, not used to retime a running effect. */
  transition?: MotionTransition
}

export interface MotionProps extends MotionOptions {
  children: JSX.Element
}

export type MotionTagProps<Tag extends MotionTag> = Omit<JSX.IntrinsicElements[Tag], keyof MotionOptions> & MotionOptions

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

function createMotionBinding(props: MotionOptions) {
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
  const presence = useContext(PresenceContext)
  const routed = presence?.page != null
  const scope = exit || routed ? presence?.boundary ?? requirePresenceScope() : null
  let routeEntryCommitted = false
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
    const exiting = scope?.direction === 'out'
    if (exiting) skipInitialMotion = false
    const first = target({ ...present, ...(exiting ? exit : initial) })
    driver.prepare(element, first, exiting ? first : visible)
  }

  function applyPresent(pose: MotionTarget, snap = false) {
    present = pose
    const next = target(pose)
    if (snap || skipInitialMotion) driver.snapTo(next)
    else driver.retarget(next)
    skipInitialMotion = false
  }

  function commitRouteEntry(snap = false) {
    applyPresent(snapshotMotionTarget(props.animate), snap)
    routeEntryCommitted = true
  }

  scope?.register(exit ? 'inout' : 'enter', ({ direction }) => {
    if (direction === 'in') {
      if (routed) commitRouteEntry()
      return
    }
    routeEntryCommitted = false
    // Keep the current fill until a committed restore retargets it.
    const overlay = readExit()
    if (overlay === undefined) return
    skipInitialMotion = false
    return driver.retarget(target({ ...present, ...overlay }))?.finished
  }, routed ? {
    snap: () => commitRouteEntry(true),
    park() {
      routeEntryCommitted = false
      skipInitialMotion = initial === undefined
      present = snapshotMotionTarget(props.animate)
      driver.snapTo(target({ ...present, ...initial }), target(present))
    },
  } : undefined)

  createEffect(() => driver.bound() && scope?.state.phase() !== 'exiting' ? snapshotMotionTarget(props.animate) : undefined, pose => {
    // The ref can be ready while Loading or a dormant route holds its first commit.
    if (pose && (!routed || routeEntryCommitted)) applyPresent(pose)
  })

  return bind
}

function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && 'nodeType' in value && value.nodeType === Node.ELEMENT_NODE
}

/**
 * Client-only: animate the single stable DOM element rendered by the child,
 * with no wrapper. Put DOM props and refs on the child; remount Motion to
 * animate a different root. Put Loading around Motion or inside the stable
 * root, not in place of the root.
 * An exit target needs a Lifecycle.For, Show, Match, or routed page boundary.
 * Entry motion waits for live presentation in a route (including without `exit`).
 */
export function Motion(props: MotionProps): JSX.Element {
  const bind = createMotionBinding(props)
  // Construct the child separately: resolving a nested accessor again must not
  // recreate the component, its owner, or its refs.
  const child = createMemo(() => props.children, { lazy: true })
  let root: Element | undefined

  // Keep the resolved child owned even if the caller temporarily stops rendering
  // this output. Prepare before Solid inserts it; JSX.Element omits accessor output.
  return createMemo(() => {
    const rendered: unknown = flatten(child(), { skipNonRendered: true })
    const element = Array.isArray(rendered) && rendered.length === 1 ? rendered[0] : rendered
    if (!isElement(element)) {
      throw new TypeError('Motion requires one DOM Element child. Render a single stable root element.')
    }
    if (root && root !== element) {
      throw new TypeError('Motion child replaced its root element. Keep the root stable or remount Motion.')
    }
    if (!root) {
      untrack(() => bind(element))
      root = element
    }
    return element
  }, { sync: true }) as unknown as JSX.Element
}

function motionTag<Tag extends MotionTag>(tag: Tag) {
  const Native = dynamic<MotionTag>(() => tag, { static: true })
  return (props: MotionTagProps<Tag>) => {
    const bind = createMotionBinding(props)
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
 * applied; restore uses the latest animate. Routed entry waits for live
 * presentation, just like Motion.
 */
export const motion = {
  div: motionTag('div'),
  span: motionTag('span'),
  section: motionTag('section'),
  button: motionTag('button'),
  li: motionTag('li'),
}
