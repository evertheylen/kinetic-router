import {
  createContext, createSignal, getOwner, isDisposed, onCleanup,
  runWithOwner, useContext,
  type Accessor, type Owner,
} from 'solid-js'

export type Phase = 'present' | 'exiting' | 'disposed'
export type Direction = 'in' | 'out'
type Completion = void | PromiseLike<unknown>
export type ExitHandler = (context: { signal: AbortSignal }) => Completion
export type EnterHandler = ExitHandler
export type InOutHandler = (context: { direction: Direction; signal: AbortSignal }) => Completion
export interface LifecycleState { phase: Accessor<Phase> }

/** Bind the returned ref to one element. Preparation must be synchronous. */
export interface AnimationAdapter<T extends Element> {
  prepare: (element: T, context: { direction: Direction }) => void
  run: (context: { element: T; direction: Direction; signal: AbortSignal }) => Completion
}

type Kind = 'enter' | 'exit' | 'inout'
type Run = { controller: AbortController; state: 'queued' | 'running' | 'done' }
type Registration = { kind: Kind; handler: InOutHandler; owner: Owner; run?: Run }

/** One retained row or branch. Only its owning flow changes its presence. */
export class Scope {
  readonly state: LifecycleState
  private disposed = false
  private exiting = false
  private handlers = new Set<Registration>()
  private setPhase
  private changed: () => void

  constructor(changed: () => void) {
    this.changed = changed
    const [phase, setPhase] = createSignal<Phase>('present', { ownedWrite: true })
    this.state = { phase }
    this.setPhase = setPhase
  }

  get direction(): Direction { return this.exiting ? 'out' : 'in' }

  setPresent(present: boolean) {
    const exiting = !present
    if (this.disposed || exiting === this.exiting) return
    this.exiting = exiting
    this.setPhase(exiting ? 'exiting' : 'present')
    for (const registration of this.handlers) {
      // Standalone enters survive removal; completed ones restart on reentry.
      if (registration.kind !== 'enter' || (!exiting && registration.run?.state === 'done')) {
        this.cancel(registration)
      }
      this.queue(registration)
    }
    this.changed()
  }

  register(kind: Kind, handler: InOutHandler) {
    const owner = getOwner()
    if (!owner) throw new Error('Lifecycle hooks require a reactive owner')
    const registration: Registration = { kind, handler, owner }
    this.handlers.add(registration)
    this.queue(registration)
    this.changed()
    onCleanup(() => {
      this.handlers.delete(registration)
      this.cancel(registration)
      this.changed()
    })
  }

  private queue(registration: Registration) {
    if (registration.run) return
    if (registration.kind === 'enter' && this.exiting) return
    if (registration.kind === 'exit' && !this.exiting) return
    // Reserve work during rendering; invocation waits for committed DOM and refs.
    registration.run = { controller: new AbortController(), state: 'queued' }
  }

  /** The retain effect calls this after rendering, before checking disposal. */
  runPending() {
    if (this.disposed) return
    const entering = [...this.handlers].some(registration =>
      registration.kind === 'enter' && registration.run && registration.run.state !== 'done',
    )
    for (const registration of this.handlers) {
      const run = registration.run
      if (!run || run.state !== 'queued' || (registration.kind === 'exit' && entering)) continue
      this.invoke(registration, run)
    }
  }

  private cancel(registration: Registration) {
    const run = registration.run
    registration.run = undefined // invalidate continuations before abort listeners run
    if (run) runWithOwner(null, () => run.controller.abort())
  }

  private invoke(registration: Registration, run: Run) {
    if (this.disposed || registration.run !== run) return
    run.state = 'running'
    const finish = () => {
      if (this.disposed || registration.run !== run) return
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
    let result: Completion
    try {
      // A standalone enter still runs inward when removal is queued behind it.
      const direction = registration.kind === 'enter' ? 'in' : this.direction
      result = runWithOwner(null, () => registration.handler({ direction, signal: run.controller.signal }))
    } catch (error) {
      result = Promise.reject(error)
    }
    // All completions, including throws, wait for the same promise turn. A handler
    // may request reentry before failing; let Solid render it before pruning.
    void Promise.resolve(result).then(finish, failed)
  }

  canRemove(): boolean {
    return this.exiting
      && [...this.handlers].every(registration => !registration.run || registration.run.state === 'done')
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
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

export function useLifecycle(): LifecycleState {
  return currentScope().state
}

/** Register synchronously in setup; reentry aborts the current exit. */
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
    element = target
    // Skip standalone enters registered late in this already-exiting boundary.
    if (kind === 'inout' || scope.direction === 'in') {
      runWithOwner(null, () => handler.prepare(target, { direction: scope.direction }))
    }
  }
}

/** Standalone enter work finishes before ordinary exits on this boundary start. */
export function onEnter(handler: EnterHandler): void
export function onEnter<T extends Element>(adapter: AnimationAdapter<T>): (element: T) => void
export function onEnter<T extends Element>(handler: EnterHandler | AnimationAdapter<T>) {
  return animationHook('enter', handler)
}

/** Direction changes abort the previous run without waiting for its promise. */
export function onInOut(handler: InOutHandler): void
export function onInOut<T extends Element>(adapter: AnimationAdapter<T>): (element: T) => void
export function onInOut<T extends Element>(handler: InOutHandler | AnimationAdapter<T>) {
  return animationHook('inout', handler)
}
