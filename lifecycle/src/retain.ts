import {
  For, createEffect, createRenderEffect, createSignal, onCleanup, useContext,
  type Accessor, type Element as SolidElement,
} from 'solid-js'
import { PresenceContext, Scope } from '@kinetic-router/presence'

export interface Selection<T> { key: unknown; value: T }
export type RetentionMode = 'parallel' | 'out-in'

/** Retain the input to Solid's For, not the DOM produced by an already-disposed owner. */
export function retain<T>(
  source: Accessor<readonly Selection<T>[]>,
  render: (value: Accessor<T>, index: Accessor<number>) => SolidElement,
  mode: Accessor<RetentionMode> = () => 'parallel',
  beforeChange?: () => void | (() => void),
): SolidElement {
  const page = useContext(PresenceContext)?.page ?? null
  function entry(initial: Selection<T>, index: number) {
    // A selection already boxes the item: even a function is data, not a signal updater.
    const [selection, setSelection] = createSignal(initial, {
      ownedWrite: true, equals: (a, b) => Object.is(a.value, b.value),
    })
    const [position, setIndex] = createSignal(index, { ownedWrite: true })
    return {
      key: initial.key, scope: new Scope(invalidate, page?.isDormant),
      value: () => selection().value, index: position, setSelection, setIndex,
    }
  }
  type Entry = ReturnType<typeof entry>
  // A row has an owner only once Solid's For consumes it, and until its cleanup.
  const mounted = new Set<Entry>()
  let waitingForDisposal = false
  let initialized = false
  let pendingAfterChange: void | (() => void)
  const [disposal, retrySelection] = createSignal(undefined, { equals: false, ownedWrite: true })
  let staged: Entry[] = []
  const [visible, setVisible] = createSignal(staged, { ownedWrite: true })
  const [workChanged, invalidate] = createSignal(undefined, { equals: false, ownedWrite: true })

  function stage(rows: Entry[]) {
    staged = rows // Same array; visible publishes it on Solid's next commit.
    setVisible(rows)
  }

  createEffect(() => { workChanged(); return visible() }, rendered => {
    // If reconciliation staged newer rows in this flush, wait for their DOM commit.
    if (rendered !== staged) return
    const committed = pendingAfterChange
    pendingAfterChange = undefined
    if (!page?.isDormant) committed?.()
    const next = rendered.filter(row => !row.scope.advance())
    if (next.length !== rendered.length) stage(next)
  })

  createRenderEffect(() => { disposal(); return { selections: source(), mode: mode() } }, ({ selections, mode }) => {
    if (mode !== 'parallel' && mode !== 'out-in') throw new TypeError('Lifecycle mode must be parallel or out-in')
    const keys = new Set<unknown>()
    for (const { key } of selections) {
      if (keys.has(key)) throw new Error('Lifecycle.For requires unique keys')
      keys.add(key)
    }
    // Keep only already-mounted selections while outgoing scopes still exist.
    // Reselecting an exiting branch restores it immediately, preserving its owner.
    const reusable = new Map(staged.map(row => [row.key, row]))
    waitingForDisposal = mode === 'out-in' && [...mounted].some(row => !keys.has(row.key) || reusable.get(row.key) !== row)
    const allowed = waitingForDisposal ? selections.filter(selection => reusable.has(selection.key)) : selections
    if (beforeChange && initialized && !pendingAfterChange && !page?.isDormant) {
      const previous = staged.filter(row => row.scope.direction === 'in')
      const changed = previous.length !== allowed.length || allowed.some(({ key }, index) => reusable.get(key) !== previous[index])
      if (changed) pendingAfterChange = beforeChange()
    }
    initialized = true
    const selected = allowed.map((selection, index) => {
      const retained = reusable.get(selection.key)
      if (!retained) return entry(selection, index)
      retained.setSelection(selection)
      retained.setIndex(index)
      retained.scope.setPresent(true)
      return retained
    })
    // Keep exiting rows in place. Fill the other slots in selection order, then
    // append any extra rows. No repeated splicing when many rows leave together.
    let index = 0
    const next: Entry[] = []
    for (const retained of staged) {
      if (keys.has(retained.key)) next.push(selected[index++]!)
      else if (mounted.has(retained)) {
        retained.scope.setPresent(false)
        next.push(retained)
      }
    }
    while (index < selected.length) next.push(selected[index++]!)
    stage(next)
  })

  return For({
    get each() { return visible() },
    children: retained => {
      mounted.add(retained)
      page?.attach(retained.scope)
      onCleanup(() => {
        retained.scope.dispose()
        mounted.delete(retained)
        if (waitingForDisposal) retrySelection()
      })
      return PresenceContext({
        value: { boundary: retained.scope, page },
        get children() { return render(retained.value, retained.index) },
      })
    },
  })
}
