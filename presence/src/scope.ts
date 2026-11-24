import {
  createRenderEffect, createSignal, getOwner, isDisposed, onCleanup, runWithOwner,
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
 * In a dormant route, prepare without playing. Page-level adapters that prepare
 * a different entry pose should provide snap for plain outlets. On local scopes,
 * snap opts out of staged entry playback in a plain outlet; other hooks still run.
 * Provide park if cached output should replay from its original pose. An enter
 * adapter skips preparation if registered in an already-exiting boundary.
 * CSS adapters should await only designated finite animations. Retarget transitions
 * on reversal; aborting an old waiter must not cancel/reset the visual transition.
 */
export interface AnimationAdapter<T extends Element> {
  prepare: (element: T, context: { direction: Direction; dormant: boolean }) => void
  run: (context: { element: T; direction: Direction; signal: AbortSignal }) => Completion
  /** Apply the final entry pose when an outlet skips entry playback. */
  snap?: (element: T) => void
  /** Reprepare the entry pose of cached, detached output. */
  park?: (element: T) => void
}

export interface PresenceAdapter {
  snap?: () => void
  park?: () => void
}

type Kind = 'enter' | 'exit' | 'inout'
type Run = { controller: AbortController; state: 'queued' | 'running' | 'done' }
type Registration = {
  kind: Kind; handler: InOutHandler; owner: Owner; adapter?: PresenceAdapter;
  committed: boolean; animate: boolean; run?: Run;
}

/**
 * One retained row, branch, or page; only its boundary owner changes presence.
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
  private dormant: boolean
  private skipParkedExit = false
  private animateNew = true

  constructor(changed: () => void, dormant = false) {
    this.changed = changed
    this.dormant = dormant
    const [phase, setPhase] = createSignal<Phase>('present', { ownedWrite: true })
    this.state = { phase }
    this.setPhase = setPhase
  }

  get direction(): Direction { return this.requestedPhase === 'present' ? 'in' : 'out' }
  get isDormant(): boolean { return this.dormant }

  /** Uncommitted exit hooks cannot keep a page in the outlet. */
  get hasExitWork(): boolean {
    for (const registration of this.handlers) {
      if (registration.committed && registration.kind !== 'enter') return true
    }
    return false
  }

  resume(animate: boolean, boundary: 'page' | 'local') {
    if (this.requestedPhase === 'disposed') return
    this.animateNew = animate || boundary === 'local'
    this.dormant = false
    for (const registration of this.handlers) {
      registration.animate = animate || (boundary === 'local' && !registration.adapter?.snap)
      if (!registration.animate) this.cancel(registration)
      this.queue(registration)
    }
    this.changed()
  }

  park() {
    if (this.requestedPhase === 'disposed') return
    this.dormant = true
    // A locally removed row is still unselected on restore, even if the page
    // is presented again before Solid has pruned it.
    this.skipParkedExit = this.requestedPhase === 'exiting'
    for (const registration of this.handlers) this.cancel(registration)
    if (this.requestedPhase === 'present') {
      for (const registration of this.handlers) this.apply(registration, 'park')
    }
    this.changed()
  }

  setPresent(present: boolean) {
    const phase = present ? 'present' : 'exiting'
    if (this.requestedPhase === 'disposed' || this.requestedPhase === phase) return
    this.requestedPhase = phase
    this.skipParkedExit = false
    this.setPhase(phase)
    for (const registration of this.handlers) {
      // Standalone enters survive removal; completed ones restart on reentry.
      if (registration.kind !== 'enter' || (present && registration.run?.state === 'done')) {
        this.cancel(registration)
        registration.animate = this.animateNew
      }
      this.queue(registration)
    }
    this.changed()
  }

  register(kind: Kind, handler: InOutHandler, adapter?: PresenceAdapter) {
    const owner = getOwner()
    if (!owner) throw new Error('Lifecycle hooks require a reactive owner')
    const registration: Registration = { kind, handler, owner, adapter, committed: false, animate: this.animateNew }
    this.handlers.add(registration)
    // Remember uncommitted registrations so a snap can include them at their
    // first commit. They cannot run or retain before their owner's Loading commits.
    createRenderEffect(() => undefined, () => {
      registration.committed = true
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
    if (registration.run || !registration.committed || this.dormant || this.skipParkedExit) return
    if (registration.kind === 'enter' && this.direction === 'out') return
    if (registration.kind === 'exit' && this.direction === 'in') return
    // Reserve work during rendering; invocation waits for committed DOM and refs.
    registration.run = { controller: new AbortController(), state: 'queued' }
  }

  /** Run committed work; return true if the exit is complete. A hook can request
   * reentry, so never prune in the same pass in which a hook was invoked. */
  advance(): boolean {
    let removable = this.requestedPhase === 'exiting'
    if (this.dormant) return removable
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

  private apply(registration: Registration, action: keyof PresenceAdapter) {
    const perform = registration.adapter?.[action]
    if (perform) {
      try { runWithOwner(null, perform) }
      catch (error) { console.error(`Lifecycle ${registration.kind} adapter failed to ${action}:`, error) }
    }
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
      if (!registration.animate) {
        if (direction === 'in') this.apply(registration, 'snap')
        finish()
        return
      }
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
