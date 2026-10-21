# @kinetic-router/lifecycle (prototype)

Lifecycle-aware control flow for **Solid 2.0.0-rc.15**. Client-only, private,
experimental; no router dependency. Retains **component instances and reactive
owners**, not just DOM nodes, while their lifecycle handlers finish.

**Data changes drive transitions; unmounting only cleans up.** Each flow manages
its own rows or branches. Removing a page does not make an unchanged list inside
it animate every row out.

## Run

Requires Node 22.12+ (Solid 2's minimum). This package shares the workspace's
pinned Solid RC runtime and `@solidjs/vite-plugin` compiler toolchain.
JSX uses `@solidjs/web` as `jsxImportSource`; core types come from `solid-js`.

From the monorepo root:

```sh
CI=true pnpm install
pnpm --filter @kinetic-router/lifecycle build
pnpm --filter @kinetic-router/lifecycle test
pnpm --filter @kinetic-router/lifecycle dev
# Open http://127.0.0.1:5173

# Production demo + Chromium tests (requires Playwright's Chromium):
pnpm --filter @kinetic-router/lifecycle exec playwright install chromium
pnpm --filter @kinetic-router/lifecycle test:browser
# The same browser tests with development-only runtime checks enabled:
pnpm --filter @kinetic-router/lifecycle test:browser:dev
```

The interactive demo covers keyed rows, object replacement, Show, Switch,
parallel exits, and independent nested flows. Edit inputs and click counters while
exiting; restore them before the exit ends. Instance numbers should not change.
The exit-only animations finish halfway through an independent abortable delay,
demonstrating that animation completion alone does not release retention. Two
CSS-only examples show separate enter/exit animations and reversible `inout`
transitions, including first-frame styles before insertion.

## API

```tsx
import { Lifecycle, onEnter, onExit, onInOut, useLifecycle } from '@kinetic-router/lifecycle'

<Lifecycle.For each={items()} by={item => item.id}>
  {(item, index) => <Item item={item()} index={index()} />}
</Lifecycle.For>

<Lifecycle.Show when={visible()} fallback={<Empty />}>
  <Modal />
</Lifecycle.Show>

<Lifecycle.Switch fallback={<NotFound />}>
  <Lifecycle.Match when={page() === 'home'}><Home /></Lifecycle.Match>
  <Lifecycle.Match when={page() === 'settings'}><Settings /></Lifecycle.Match>
</Lifecycle.Switch>
```

**Lifecycle.For always supplies accessors** for item/index, matching Solid 2's
custom-keyed For mode. Native RC For's default mode now supplies a raw item;
this API keeps accessors even without `by`, so same-key replacements can update.
Show/Match's optional child callback also receives an accessor. Read `item()`
reactively rather than snapshotting it at setup time.
`by` defaults to item identity; keys must be unique within each list. Reordering
and replacing an object with the same key preserve its instance. Reentry during
exit does too. After actual removal, that key creates a new instance.

Register any number of handlers synchronously during descendant setup:

```tsx
function Modal() {
  let element!: HTMLDivElement
  const { phase } = useLifecycle()
  onExit(({ signal }) => {
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], 600)
    const cancel = () => animation.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    return animation.finished.finally(() => {
      signal.removeEventListener('abort', cancel)
      animation.cancel()
    })
  })
  return <div ref={element} data-phase={phase()}>Modal</div>
}
```

- `phase()` is `present`, `exiting`, or `disposed`, from the nearest retained
  boundary. It reports requested presence, not animation progress: it can be
  `exiting` while a standalone enter is finishing. A For row and each conditional
  branch are individual boundaries.
- A boundary waits for its own current, non-aborted handlers, not nested flow
  boundaries. Handlers returning `void` are supported. Setup cleanup unregisters
  and aborts the handler.
- Callbacks run untracked and ownerless, like events/effect callbacks, so ordinary
  signal writes work. Capture context/hooks during setup, not inside the callback;
  do not create reactive primitives inside a lifecycle handler.
- Reentry aborts the exit signal and returns to `present`. Each subsequent exit
  gets a fresh signal. Stale promise fulfillment/rejection cannot dispose a
  newer instance or exit attempt. **Handlers must undo their own side effects**
  on abort; promises themselves cannot be cancelled by the library.
- Thrown errors and rejected promises are logged with `console.error` and count
  as completed work. Failures from aborted runs are ignored. Both failure forms
  settle asynchronously so a handler's same-turn reentry can render before disposal.
- Hooks belong to their nearest flow boundary. New hooks registered in an already
  exiting boundary join its exit. Work runs after rendering, when refs and reactive
  DOM attributes are ready. All superseded abort cleanup precedes new run callbacks.

### Enter and bidirectional hooks

```ts
onEnter(({ signal }) => enterWork(signal))
onExit(({ signal }) => exitWork(signal))

// Alternatively, one handler for both directions:
onInOut(({ direction, signal }) => transitionTo(direction, signal))
```

- `onEnter` runs after initial rendering, and again on reentry after an exit.
  Removal does **not** abort a running standalone enter. Ordinary `onExit`
  handlers on that boundary wait until all its standalone enters settle.
  Restoring it before then cancels the queued exit without restarting the enter.
- `onInOut` first runs toward `in`. Every subsequent direction change invalidates
  and aborts the previous run, then invokes the new direction **without awaiting
  the old promise**. It is not blocked by standalone enters on this boundary.
  Animation adapters, not the core, provide visual continuity.
- Only the latest requested presence matters; historical toggles are not queued.
- Hooks first registered in an already-exiting boundary skip standalone enter and
  start `onInOut` toward `out`. A new nested flow starts normally toward `in`.
- Final owner disposal aborts all work immediately, without starting new hooks.

### Nested flows

```tsx
<Lifecycle.Show when={pageVisible()}>
  <Page> {/* Registers the page fade on this Show branch. */}
    <Lifecycle.For each={users()} by={user => user.id}>
      {user => <UserRow user={user()} />}
    </Lifecycle.For>
  </Page>
</Lifecycle.Show>
```

- Changing `pageVisible` to false starts the page fade, not the row exits.
- While the page fades, actual changes to `users` still enter/exit rows normally.
- When the fade finishes, Solid disposes the page and its subtree. Pending row
  work is aborted; it cannot delay page removal.
- Restoring the page before its fade finishes preserves the subtree. Row
  lifecycles are unaffected; they neither restart nor reverse because of it.

There is no ancestor-exit propagation, child pinning, or cross-boundary waiting.
Multiple components can still contribute hooks to one boundary, including through
portals; only another lifecycle flow creates independent row/branch boundaries.

### First-frame styling (no entrance flicker)

A callback alone cannot hide content before its first paint. Declare CSS keyframe
animations in the initial JSX styles (`animation-fill-mode: both` also covers a
start delay), or use the **adapter form** of `onEnter` / `onInOut`:

```tsx
function FadingPanel() {
  const fade = onInOut<HTMLDivElement>({
    prepare(element, { direction }) {
      // Called synchronously by the ref, before insertion. No awaits here.
      element.dataset.direction = direction
    },
    run({ element, direction }) {
      // Retarget CSS from its current visual position; don't reset it on abort.
      element.dataset.direction = direction
      return Promise.all(element.getAnimations()
        .filter(animation => animation instanceof CSSTransition
          && animation.transitionProperty === 'opacity')
        .map(animation => animation.finished))
    },
  })
  return <div ref={fade} class="fade">Content</div>
}
```

```css
.fade { opacity: 0; transition: opacity 200ms ease-out; }
.fade[data-direction=in] { opacity: 1; }
@starting-style { .fade[data-direction=in] { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .fade { transition-duration: 0s; }
}
```

Bind the returned ref to **one** element. `prepare` runs ownerless and must apply
initial styles synchronously; `run` receives that element, direction, and an
abort signal once refs are ready. On reentry, `run` must also apply its target;
preparation is only for initial insertion. `onEnter` adapters receive direction
`in`; their preparation is skipped if registered in an already-exiting boundary.
The core never adds a global visibility/opacity override or chooses endpoints.

For separate CSS keyframes, prepare the entry animation's class/attribute and
have `run` await its designated `CSSAnimation.finished`. An exit callback applies
and awaits the separate exit animation. See `demo/main.tsx` and `demo/style.css`.
Only await designated finite animations, **not** unrelated infinite spinners or
pulses. CSS transitions reverse naturally when retargeted; cancelling a stale
waiter must not cancel/reset the visual transition. `@starting-style` requires
browser support; without it this example still exits but skips the first enter.
Post-render callbacks start/observe work, not first-frame styling: they can run
after paint. Preparation belongs in rendering, not in a deferred callback.

## Architecture and investigation

The installed RC client implementation (`solid-js/dist/solid.dev.js`) implements
For using `mapArray`; Show/Switch own their selected branches through memos;
Match is only a descriptor. In `@solidjs/signals`, `createOwner` attaches to the
current owner, `createRoot` uses it, and disposal recursively disposes children
before running cleanup. A Solid 1 detached-root assumption is unsafe here.
`onCleanup` cannot postpone disposal.

[`solid-primitives/transition-group`](https://github.com/solidjs-community/solid-primitives/tree/main/packages/transition-group)
provides useful list/branch retention patterns, but its inspected source uses
Solid 1 APIs (`batch`, `createComputed`, `useTransition`) and retains supplied
values/elements, not the input owners of arbitrary ordinary control flow.
[`solid-motion` Presence](https://github.com/solidjs-community/solid-motion/blob/main/src/presence.tsx)
coordinates animation/DOM retention; that alone does not guarantee an arbitrary
subtree's reactive ownership survives. Neither is a dependency here.

This prototype instead has one shared engine:

- `src/retain.ts` reconciles keyed selections into a **retained input list for
  Solid's actual For**. The list includes exiting entries, so Solid does not
  dispose their owners. No private Solid fields or manual DOM moves are used.
- `src/scope.ts` tracks one row/branch's presence and per-handler runs. Context
  associates hooks with that boundary, but scopes have no parent/child links.
  Solid owns the component tree and disposes nested flows normally.
- `src/flow.ts` is only selection logic: For selects keys, Show selects a stable
  content/fallback key, Switch selects the first truthy Match descriptor. Values
  stay at their last selected snapshot during exit. New and exiting branches
  coexist. Exiting rows keep their previous rendered indices; active rows fill
  the other slots in source order. Removing an earlier finished exit naturally
  closes the gap. A removal alone does not move the retained DOM nodes.

### Scheduling contract

The runtime does **not** call `queueMicrotask` or `flush`, and does not keep a
second scheduler alongside Solid's:

1. A `createRenderEffect` reconciles **committed** selections. Scope changes only
   cancel superseded work and queue new runs; they never invoke run callbacks.
   If Solid holds a render behind an action/async transition, the effect's apply
   phase waits too, so speculative removals cannot start exits.
2. Native For renders the retained list. Descendant setup registers handlers
   and nested scopes. Adapter refs apply first-frame styles synchronously before
   insertion. Queued work already counts toward retention.
3. One `createEffect` invokes queued handlers **after rendering**, then checks
   disposal. Refs and reactive DOM attributes are ready, and abort cleanup has
   finished before any new run callback. Ordinary exits wait for standalone
   enters; bidirectional runs do not. No special initial/late-registration
   scheduler or reactive owner per attempt is needed.
4. Each run follows `queued → running → done`. Promise completions only mark the
   current run done and invalidate the revision signal; they never invoke more
   handlers or prune directly. Cancellation invalidates run identity before
   aborting, so stale completions are harmless. Solid's render phase reconciles
   same-turn reentry before the effect starts more work or checks for removal.

This replaces a microtask/forced-flush bridge that could prune against stale
selections before a same-turn reentry had rendered. A regression test reproduces
that race under the old bridge. Tests also exercise automatic promise completion,
held actions, an independently pending Loading sibling, and 24 nested boundaries
without manually flushing. Test settling uses native `onSettled`/`until`, not a
fixed number of promise turns.

A universal `<Lifecycle><Show ... /></Lifecycle>` wrapper was deliberately not
implemented: the inner Show would already control/dispose the owner. Context
alone cannot intercept that disposal. Specialized input-retaining adapters are
necessary without changes to Solid itself.

Tests compile real JSX and mount through `@solidjs/web.render`, using Solid's
browser/development build in happy-dom. They check live effects, cleanup,
event handlers, context, key identity, concurrent exits, rapid cancellation,
conditional values/fallbacks, independent nested flows, streaming lists, late
registration, portals, errors, committed DOM reads, abort-cleanup ordering, and
final unmount. Playwright also tests the production and development demos with
real Chromium DOM and Web Animations, CSS first-frame opacity, sequential
keyframes, mid-flight bidirectional CSS transition reversal, and reduced-motion
styles (including removal of the entry delay).

## Deliberate limits

- Client-only on the pinned RC. The action/Loading scenarios above are tested;
  SSR/hydration and the full range of concurrent action/refresh/Loading
  interactions are not validated.
- Use lifecycle-aware controls at **every removal point** requiring retention.
  An ordinary Show/For, arbitrary JSX conditional, or external owner disposal
  can still tear down its own descendants immediately.
- Final app/control unmount is immediate: abort pending exits and clean up;
  it does not start or await new exits. Retain that control from an outer boundary
  if its removal itself should be asynchronous.
- No timeout: a never-settling, uncancelled handler retains its subtree forever.
  A never-settling standalone enter also blocks ordinary exits on its boundary;
  use `onInOut` for interruptible work.
- No out-in branch sequencing, For fallback, or keyed Show/Match variant.
  Show preserves one instance across truthy values; Switch expects stable Match
  descriptors. This is retention, not a layout/animation library.
- Retained controls remain interactive and in the accessibility tree. Real
  modals must manage focus, `inert`/ARIA, reduced motion, and layout as appropriate.
