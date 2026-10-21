import {
  For, createEffect, createRenderEffect, createSignal, onCleanup, untrack,
  type Accessor, type Element as SolidElement,
} from 'solid-js'
import { Scope, ScopeContext } from './scope.js'

export interface Selection<T> { key: unknown; value: T }

/** Retain the input to Solid's For, not the DOM produced by an already-disposed owner. */
export function retain<T>(
  source: Accessor<readonly Selection<T>[]>,
  render: (value: Accessor<T>, index: Accessor<number>) => SolidElement,
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
  const [visible, setVisible] = createSignal<Entry[]>([], { ownedWrite: true })
  let order: Entry[] = []
  let disposed = false
  const [revision, setRevision] = createSignal(0, { ownedWrite: true })

  function invalidate() {
    if (!disposed) setRevision(value => value + 1)
  }

  // User effects run after rendering: refs and descendant registrations are ready
  // before handlers run or disposal is checked. Async completions only invalidate.
  createEffect(revision, () => {
    for (const entry of order) entry.scope.runPending()
    const next = order.filter(entry => {
      if (!entry.scope.canRemove()) return true
      entries.delete(entry.key)
      return false
    })
    if (next.length !== order.length) setVisible(order = next)
  })

  createRenderEffect(source, selections => {
    const keys = new Set<unknown>()
    for (const { key } of selections) {
      if (keys.has(key)) throw new Error('Lifecycle.For requires unique keys')
      keys.add(key)
    }
    const next = selections.map((selection, index) => {
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
  })

  return For({
    get each() { return visible() },
    children: retained => {
      // One disposal path: Solid removes this owner, locally or with an ancestor.
      onCleanup(() => retained.scope.dispose())
      return ScopeContext({
        value: retained.scope,
        get children() { return untrack(() => render(retained.value, retained.index)) },
      })
    },
  })
}
