import { createContext, createEffect, createSignal, getOwner, onCleanup, runWithOwner, useContext, type Owner } from 'solid-js'
import { Scope } from './scope.js'

export { Scope } from './scope.js'
export type { AnimationAdapter, Direction, EnterHandler, ExitHandler, InOutHandler, LifecycleState, Phase } from './scope.js'

export const PresenceContext = createContext<{ readonly boundary: Scope; readonly page: PagePresence | null } | null>(null)

/** The nearest local boundary, reset to the page boundary at each route. */
export function usePresenceScope(): Scope | null {
  return useContext(PresenceContext)?.boundary ?? null
}

export function requirePresenceScope(): Scope {
  const scope = usePresenceScope()
  if (!scope) throw new Error('Lifecycle hooks require a Lifecycle.For, Show, Match, or routed page boundary')
  return scope
}

class PagePresence {
  readonly page = this
  private readonly owner: Owner
  private scope?: Scope
  private nested?: Set<Scope>
  private dormant = true
  private animate = false
  private onExitDone?: () => void

  constructor(owner: Owner) { this.owner = owner }

  get isDormant() { return this.dormant }
  get hasExitWork() { return this.scope?.hasExitWork ?? false }

  // Pages without page-level hooks need no scheduler, even if they host local scopes.
  get boundary(): Scope {
    return this.scope ??= runWithOwner(this.owner, () => {
      const [work, invalidate] = createSignal(undefined, { equals: false, ownedWrite: true })
      const boundary = new Scope(invalidate, this.dormant)
      if (!this.dormant) boundary.resume(this.animate, 'page')
      createEffect(work, () => {
        if (!boundary.advance()) return
        const done = this.onExitDone
        this.onExitDone = undefined
        if (done) runWithOwner(null, done)
      })
      onCleanup(() => {
        this.onExitDone = undefined
        boundary.dispose()
      })
      return boundary
    })
  }

  attach(boundary: Scope) {
    const nested = this.nested ??= new Set()
    nested.add(boundary)
    if (this.dormant && !boundary.isDormant) boundary.park()
    else if (!this.dormant && boundary.isDormant) boundary.resume(true, 'local')
    onCleanup(() => nested.delete(boundary))
  }

  present(animate: boolean) {
    const wasDormant = this.dormant
    this.dormant = false
    this.animate = animate
    this.onExitDone = undefined
    this.scope?.setPresent(true)
    this.scope?.resume(animate, 'page')
    if (wasDormant && this.nested) {
      for (const boundary of this.nested) boundary.resume(animate, 'local')
    }
  }

  exit(onDone: () => void) {
    if (!this.scope) return onDone()
    this.onExitDone = onDone
    this.scope.setPresent(false)
  }

  park() {
    this.dormant = true
    this.onExitDone = undefined
    this.scope?.setPresent(true)
    this.scope?.park()
    if (this.nested) for (const boundary of this.nested) boundary.park()
  }
}

/** Provide the returned value to page descendants. While dormant, refs can
 * prepare, but hooks do not run. Present after live attachment, or to cancel an
 * exit while still attached. Plain presentation suppresses page-level playback
 * and snaps only local adapters that opt in. Future local selections animate normally.
 * Exit waits for committed handlers on the page boundary, not its local scopes.
 * Park after detaching to cancel work and reprepare cached output. */
export function createPagePresence() {
  return new PagePresence(getOwner()!)
}
