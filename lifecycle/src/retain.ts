import {
  For, createEffect, createRenderEffect, createSignal, onCleanup, untrack,
  type Accessor, type Element as SolidElement,
} from 'solid-js'
import { Scope, ScopeContext } from './scope.js'

export interface Selection<T> { key: unknown; value: T }
export type RetentionMode = 'parallel' | 'out-in'

/** Retain the input to Solid's For, not the DOM produced by an already-disposed owner. */
export function retain<T>(
  source: Accessor<readonly Selection<T>[]>,
  render: (value: Accessor<T>, index: Accessor<number>) => SolidElement,
  mode: Accessor<RetentionMode> = () => 'parallel',
): SolidElement {
  function entry(selection: Selection<T>, index: number) {
    // Box values so function-valued items aren't interpreted as signal computations.
    const [box, setBox] = createSignal({ value: selection.value }, { ownedWrite: true })
    const [position, setPosition] = createSignal(index, { ownedWrite: true })
    return {
      key: selection.key,
      scope: new Scope(invalidate),
      value: () => box().value,
      index: position,
      update(value: T, index: number) {
        if (!Object.is(untrack(box).value, value)) setBox({ value })
        setPosition(index)
      },
    }
  }
  type Entry = ReturnType<typeof entry>
  const entries = new Map<unknown, Entry>()
  // Pruning input is not disposal yet. Out-in waits for Solid to remove the owners.
  const retiring = new Set<Entry>()
  const [retired, setRetired] = createSignal(0, { ownedWrite: true })
  const [visible, setVisible] = createSignal<Entry[]>([], { ownedWrite: true })
  let order: Entry[] = []
  let disposed = false
  const [revision, setRevision] = createSignal(0, { ownedWrite: true })

  function invalidate() {
    if (!disposed) setRevision(value => value + 1)
  }

  // Reconcile committed selections in the render phase, then invoke/prune here.
  // Refs, descendant registrations, and all superseded abort cleanup are ready.
  // Async completions only invalidate: direct pruning or a second microtask/flush
  // scheduler could race a same-turn reentry or a render held behind an action.
  createEffect(revision, () => {
    for (const entry of order) entry.scope.runPending()
    const next = order.filter(entry => {
      if (!entry.scope.canRemove()) return true
      entries.delete(entry.key)
      retiring.add(entry)
      return false
    })
    if (next.length !== order.length) setVisible(order = next)
  })

  createRenderEffect(() => ({ selections: source(), mode: mode(), retired: retired() }), ({ selections, mode }) => {
    if (mode !== 'parallel' && mode !== 'out-in') throw new TypeError('Lifecycle mode must be parallel or out-in')
    const keys = new Set<unknown>()
    for (const { key } of selections) {
      if (keys.has(key)) throw new Error('Lifecycle.For requires unique keys')
      keys.add(key)
    }
    // Keep only already-mounted selections while outgoing scopes still exist.
    // Reselecting an exiting branch restores it immediately, preserving its owner.
    const blocked = mode === 'out-in' && (retiring.size > 0 || order.some(entry => !keys.has(entry.key)))
    const allowed = blocked ? selections.filter(selection => entries.has(selection.key)) : selections
    const next = allowed.map((selection, index) => {
      let retained = entries.get(selection.key)
      if (!retained) {
        retained = entry(selection, index)
        entries.set(selection.key, retained)
      }
      retained.update(selection.value, index)
      retained.scope.setPresent(true)
      return retained
    })
    // Keep exits in their previous rendered slots; active rows fill the other slots
    // in source order. Earlier exits disappearing can naturally shift later slots.
    for (const [index, retained] of order.entries()) {
      if (!keys.has(retained.key)) {
        retained.scope.setPresent(false)
        next.splice(index, 0, retained)
      }
    }
    setVisible(order = next)
  })

  onCleanup(() => {
    disposed = true
    entries.clear()
    retiring.clear()
  })

  return For({
    get each() { return visible() },
    children: retained => {
      // One disposal path: Solid removes this owner, locally or with an ancestor.
      onCleanup(() => {
        retained.scope.dispose()
        retiring.delete(retained)
        if (!disposed) setRetired(value => value + 1)
      })
      return ScopeContext({
        value: retained.scope,
        get children() { return untrack(() => render(retained.value, retained.index)) },
      })
    },
  })
}
