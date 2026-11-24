import { runWithOwner } from 'solid-js'
import { requirePresenceScope, type AnimationAdapter, type EnterHandler, type ExitHandler, type InOutHandler, type LifecycleState } from '@kinetic-router/presence'

export type { AnimationAdapter, Direction, EnterHandler, ExitHandler, InOutHandler, LifecycleState, Phase } from '@kinetic-router/presence'

/** Reactive presence only. The library never writes a phase attribute, class, or
 * accessibility state to the DOM; the component decides how to use this signal. */
export function useLifecycle(): LifecycleState {
  return requirePresenceScope().state
}

/**
 * Register synchronously in setup. Reentry aborts the exit; subsequent exits get
 * fresh signals. All committed handlers on this boundary must finish before removal.
 * An ordinary conditional or final unmount bypasses retention and only cleans up.
 */
export function onExit(handler: ExitHandler): void {
  requirePresenceScope().register('exit', handler)
}

function animationHook<T extends Element>(kind: 'enter' | 'inout', handler: InOutHandler | AnimationAdapter<T>) {
  const scope = requirePresenceScope()
  if (typeof handler === 'function') {
    scope.register(kind, handler)
    return
  }
  let element: T | undefined
  scope.register(kind, context => {
    if (!element) throw new Error('Bind the ref returned by the lifecycle animation hook')
    return handler.run({ ...context, element })
  }, {
    snap: handler.snap && (() => { if (element) handler.snap!(element) }),
    park: handler.park && (() => { if (element) handler.park!(element) }),
  })
  return (target: T) => {
    if (element === target) return
    if (element) throw new Error('Bind each lifecycle animation ref to only one element')
    element = target
    // Skip standalone enters registered late in this already-exiting boundary.
    if (kind === 'inout' || scope.direction === 'in') {
      runWithOwner(null, () => handler.prepare(target, { direction: scope.direction, dormant: scope.isDormant }))
    }
  }
}

/**
 * Runs on initial committed entry and reentry after a completed enter. Skips entry
 * if its first render commits in an already-exiting boundary. Removal does not abort
 * a running enter; ordinary exits wait for it. Restoring before it finishes cancels
 * the queued exit without restarting entry. Final owner disposal aborts all work.
 */
export function onEnter(handler: EnterHandler): void
export function onEnter<T extends Element>(adapter: AnimationAdapter<T>): (element: T) => void
export function onEnter<T extends Element>(handler: EnterHandler | AnimationAdapter<T>) {
  return animationHook('enter', handler)
}

/**
 * Starts toward in (out for late registration in an exiting boundary). Each change
 * aborts the previous run without waiting for it; only the latest presence matters.
 * Unlike ordinary exits, it does not wait for standalone enters. Adapters supply
 * visual continuity; stale promise completions cannot remove a reentered instance.
 */
export function onInOut(handler: InOutHandler): void
export function onInOut<T extends Element>(adapter: AnimationAdapter<T>): (element: T) => void
export function onInOut<T extends Element>(handler: InOutHandler | AnimationAdapter<T>) {
  return animationHook('inout', handler)
}
