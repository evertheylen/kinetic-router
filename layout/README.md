# @kinetic-router/layout (prototype)

`LayoutList` adds browser-native FLIP movement, entry/exit fades, and a smooth
container height change to a keyed Solid 2 list. It opts that list into layout
measurement and uses [`Lifecycle.For`](../lifecycle/README.md) to keep leaving
rows alive until their exit finishes. Restore a key during its exit to keep the
same row, including its local state.

```tsx
import { createSignal } from 'solid-js'
import { render } from '@solidjs/web'
import { LayoutList } from '@kinetic-router/layout'

const initial = [{ id: 1, title: 'Night atlas' }, { id: 2, title: 'Cloud garden' }]

function Row(props: { title: string; index: number }) {
  return <li>{props.index + 1}. {props.title} <input aria-label={`${props.title} note`} /></li>
}

function Queue() {
  const [items, setItems] = createSignal(initial)
  return <>
    <button onClick={() => setItems(items => [...items].reverse())}>Reverse</button>
    <button onClick={() => setItems(items => items.slice(1))}>Remove first</button>
    <button onClick={() => setItems(initial)}>Restore</button>
    <ul style="position:relative">
      <LayoutList each={items()} by={item => item.id} transition={{ duration: 0.25, ease: 'ease-out' }}>
        {(item, index) => <Row title={item().title} index={index()} />}
      </LayoutList>
    </ul>
  </>
}

render(() => <Queue />, document.body)
```

- Give each entry a unique key and render one stable, direct HTML element per row.
  `item` and `index` are accessors. Custom row components need no animation refs,
  props, or wrappers.
- Use one positioned, unscaled, natural-height parent for the rows (such as
  the `<ul>` above). Rows must keep their natural size as the container height
  animates: for a grid use `align-content: start`; in a column flexbox keep
  rows from shrinking (`flex: none`). Let `LayoutList` control the parent
  height and row movement, fade, and temporary exit positioning. Put
  independent effects on descendants or use
  [`@kinetic-router/animations`](../animations/README.md) for other targets.
- Timing is in seconds, with CSS easing. Zero duration and reduced motion snap.
  Focus and `inert` are application decisions: use a control outside the list
  as a safe focus target, and mark retained exits inert if they shouldn't be
  interactive. On Undo, restore focus after the row commits and is no longer inert.
- This is keyed list motion, not shared-element transitions or an observer of
  arbitrary resizing. Ordinary unmount disposes the list immediately.

Run the [Reading queue](../lifecycle/demo/reading-queue.tsx) for add, reorder,
remove, and keyboard Undo with focus restored to the draft:

```sh
CI=true pnpm install
pnpm --filter @kinetic-router/lifecycle dev
# Open http://127.0.0.1:5173 and find Reading queue.
```
