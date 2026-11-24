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
  beforeChange?: () => void | (() => void),
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
    staged = rows
    setVisible(rows)
  }

  createEffect(() => { workChanged(); return visible() }, rendered => {
    // A completion may have woken this effect just as reconciliation staged new
    // rows/phases. Dispatch only for the snapshot Solid has committed to the DOM.
    if (rendered !== staged) return
    const committed = pendingAfterChange
    pendingAfterChange = undefined
    committed?.()
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
    if (beforeChange && !pendingAfterChange) {
      const previous = staged.filter(row => row.scope.direction === 'in')
      if (initialized && (previous.length !== allowed.length
        || allowed.some((selection, index) => reusable.get(selection.key) !== previous[index]))) pendingAfterChange = beforeChange()
      initialized = true
    }
    const selected = allowed.map((selection, index) => {
      const retained = reusable.get(selection.key)
      if (!retained) return entry(selection, index)
      retained.update(selection.value, index)
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
      onCleanup(() => {
        retained.scope.dispose()
        mounted.delete(retained)
        if (waitingForDisposal) retrySelection()
      })
      return ScopeContext({
        value: retained.scope,
        get children() { return render(retained.value, retained.index) },
      })
    },
  })
}
