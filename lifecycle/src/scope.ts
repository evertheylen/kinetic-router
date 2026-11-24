import {
  createContext, createRenderEffect, createSignal, getOwner, isDisposed, onCleanup,
  runWithOwner, useContext,
  type Accessor, type Owner,
} from 'solid-js'

/** Requested presence, not animation progress: exiting may still be finishing entry. */
export type Phase = 'present' | 'exiting' | 'disposed'
export type Direction = 'in' | 'out'
type Completion = void | PromiseLike<unknown>
/**
 * Register synchronously during descendant setup. Joins the boundary's work when
 * its owner's first render commits; an inner Loading can postpone this. Uncommitted
 * hooks neither run nor retain the boundary. Runs after rendering, untracked and
 * ownerless; capture context/hooks in setup, not in the callback.
 * Return a promise to retain the boundary. Undo side effects on abort yourself.
 * Throws/rejections are logged and count as completion unless the run was aborted.
 * There is no timeout: uncancelled, never-settling work retains the owner forever.
 */
export type ExitHandler = (context: { signal: AbortSignal }) => Completion
export type EnterHandler = ExitHandler
export type InOutHandler = (context: { direction: Direction; signal: AbortSignal }) => Completion
export interface LifecycleState { phase: Accessor<Phase> }

/**
 * Bind the returned ref to one element. prepare runs synchronously and ownerless
 * before insertion, only once; run applies subsequent targets after refs are ready.
 * Use preparation for first-frame styles (including delays), not deferred callbacks.
 * An enter adapter skips preparation if registered in an already-exiting boundary.
 * CSS adapters should await only designated finite animations. Retarget transitions
 * on reversal; aborting an old waiter must not cancel/reset the visual transition.
 */
export interface AnimationAdapter<T extends Element> {
  prepare: (element: T, context: { direction: Direction }) => void
  run: (context: { element: T; direction: Direction; signal: AbortSignal }) => Completion
}

type Kind = 'enter' | 'exit' | 'inout'
type Run = { controller: AbortController; state: 'queued' | 'running' | 'done' }
type Registration = { kind: Kind; handler: InOutHandler; owner: Owner; run?: Run }

/**
 * One retained row or branch; only its owning flow changes its presence.
 * Hooks share the nearest boundary, including through portals. Nested flows have
 * independent scopes: no ancestor-exit propagation or cross-boundary waiting.
 * Late registrations join current work; final owner disposal aborts immediately.
 */
export class Scope {
  readonly state: LifecycleState
  // Final disposal can run outside a flush. Invalidate hooks immediately, even
  // though Solid won't publish that write to state.phase until commit.
  private requestedPhase: Phase = 'present'
  private handlers = new Set<Registration>()
  private setPhase
  private changed: () => void

  constructor(changed: () => void) {
    this.changed = changed
    const [phase, setPhase] = createSignal<Phase>('present', { ownedWrite: true })
    this.state = { phase }
    this.setPhase = setPhase
  }

  get direction(): Direction { return this.requestedPhase === 'present' ? 'in' : 'out' }

  setPresent(present: boolean) {
    const phase = present ? 'present' : 'exiting'
    if (this.requestedPhase === 'disposed' || this.requestedPhase === phase) return
    this.requestedPhase = phase
    this.setPhase(phase)
    for (const registration of this.handlers) {
      // Standalone enters survive removal; completed ones restart on reentry.
      if (registration.kind !== 'enter' || (present && registration.run?.state === 'done')) {
        this.cancel(registration)
      }
      this.queue(registration)
    }
  }

  register(kind: Kind, handler: InOutHandler) {
    const owner = getOwner()
    if (!owner) throw new Error('Lifecycle hooks require a reactive owner')
    const registration: Registration = { kind, handler, owner }
    // Schedule even the first render effect: the synchronous initial form runs
    // before Loading knows whether descendants suspend. Admission must precede
    // the retain effect's invocation/pruning, but stay behind this owner's Loading.
    createRenderEffect(() => undefined, () => {
      this.handlers.add(registration)
      this.queue(registration)
      if (registration.run) this.changed()
    }, { schedule: true })
    onCleanup(() => {
      this.handlers.delete(registration)
      this.cancel(registration)
      this.changed()
    })
  }

  private queue(registration: Registration) {
    if (registration.run) return
    if (registration.kind === 'enter' && this.direction === 'out') return
    if (registration.kind === 'exit' && this.direction === 'in') return
    // Reserve work during rendering; invocation waits for committed DOM and refs.
    registration.run = { controller: new AbortController(), state: 'queued' }
  }

  /** Run committed work; return true if the exit is complete. A hook can request
   * reentry, so never prune in the same pass in which a hook was invoked. */
  advance(): boolean {
    let removable = this.requestedPhase === 'exiting'
    const entering = removable && [...this.handlers].some(({ kind, run }) =>
      kind === 'enter' && run && run.state !== 'done',
    )
    for (const registration of this.handlers) {
      const run = registration.run
      if (!run || run.state === 'done') continue
      removable = false
      if (run.state === 'queued' && !(registration.kind === 'exit' && entering)) this.invoke(registration, run)
    }
    return removable
  }

  private cancel(registration: Registration) {
    const run = registration.run
    registration.run = undefined // invalidate continuations before abort listeners run
    if (run) runWithOwner(null, () => run.controller.abort())
  }

  private invoke(registration: Registration, run: Run) {
    if (this.requestedPhase === 'disposed' || registration.run !== run) return
    run.state = 'running'
    const finish = () => {
      if (this.requestedPhase === 'disposed' || registration.run !== run) return
      run.state = 'done'
      this.changed()
    }
    const failed = (error: unknown) => {
      if (!run.controller.signal.aborted) console.error(`Lifecycle ${registration.kind} handler failed:`, error)
      finish()
    }
    if (isDisposed(registration.owner)) {
      finish()
      return
    }
    try {
      // A standalone enter still runs inward when removal is queued behind it.
      const direction = registration.kind === 'enter' ? 'in' : this.direction
      const result = runWithOwner(null, () => registration.handler({ direction, signal: run.controller.signal }))
      if (result) void Promise.resolve(result).then(finish, failed)
      else finish()
    } catch (error) {
      failed(error)
    }
  }

  dispose() {
    if (this.requestedPhase === 'disposed') return
    this.requestedPhase = 'disposed'
    this.setPhase('disposed')
    for (const registration of this.handlers) this.cancel(registration)
    this.handlers.clear()
  }
}

export const ScopeContext = createContext<Scope | null>(null)

function currentScope() {
  const scope = useContext(ScopeContext)
  if (!scope) throw new Error('Lifecycle hooks require a Lifecycle.For, Show, or Match boundary')
  return scope
}

/** Reactive presence only. The library never writes a phase attribute, class, or
 * accessibility state to the DOM; the component decides how to use this signal. */
export function useLifecycle(): LifecycleState {
  return currentScope().state
}

/**
 * Register synchronously in setup. Reentry aborts the exit; subsequent exits get
 * fresh signals. All committed handlers on this boundary must finish before removal.
 * An ordinary conditional or final unmount bypasses retention and only cleans up.
 */
export function onExit(handler: ExitHandler): void {
  currentScope().register('exit', handler)
}

function animationHook<T extends Element>(kind: 'enter' | 'inout', handler: InOutHandler | AnimationAdapter<T>) {
  const scope = currentScope()
  if (typeof handler === 'function') {
    scope.register(kind, handler)
    return
  }
  let element: T | undefined
  scope.register(kind, context => {
    if (!element) throw new Error('Bind the ref returned by the lifecycle animation hook')
    return handler.run({ ...context, element })
  })
  return (target: T) => {
    if (element === target) return
    if (element) throw new Error('Bind each lifecycle animation ref to only one element')
    element = target
    // Skip standalone enters registered late in this already-exiting boundary.
    if (kind === 'inout' || scope.direction === 'in') {
      runWithOwner(null, () => handler.prepare(target, { direction: scope.direction }))
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
