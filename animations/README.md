# @kinetic-router/animations (prototype)

Browser-native reactive and lifecycle animations for Solid 2. Client-only, private,
experimental; uses the workspace's Solid 2 catalog version. No router
integration, dependencies on an animation engine, or per-frame JavaScript.

## Motion components

`Motion` animates an existing DOM element through the Web Animations API (WAAPI).
It adds no wrapper and needs no forwarded ref. Solid lifecycle controls decide
when an exiting component may be removed; no `AnimatePresence` is needed.
See [Coming from Motion for React](API-COMPARISON.md) for a migration guide.

```tsx
import { createSignal } from 'solid-js'
import { Motion } from '@kinetic-router/animations'
import { Lifecycle as Lc } from '@kinetic-router/lifecycle'

function Card() {
  return <section aria-label="Preview">Hello!</section>
}

function Preview() {
  const [shown, setShown] = createSignal(true)
  const [tilted, setTilted] = createSignal(false)

  return <>
    <button onClick={() => setShown(value => !value)}>{shown() ? 'Hide' : 'Show'} preview</button>
    <button aria-pressed={tilted() ? 'true' : 'false'} onClick={() => setTilted(value => !value)}>Tilt preview</button>
    <Lc.Show when={shown()}>
      <Motion
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, rotate: tilted() ? -5 : 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.2, delay: 0, ease: 'easeOut' }}
      >
        <Card />
      </Motion>
    </Lc.Show>
  </>
}
```

- Put attributes, handlers, and refs on the actual child element, not on `Motion`.
  The child must resolve to exactly one DOM `Element` and keep that same node while
  `Motion` is mounted. Empty output, text-only output, multiple roots, and removing
  or replacing the root are errors. Put conditionals around `Motion` or inside the
  stable root, not in place of the root.
- To render a tag or author an explicit wrapper, use `motion.div`, `motion.span`,
  `motion.section`, `motion.button`, or `motion.li`. These accept native props,
  refs, and children as well as the motion props. For other tags, write the native
  tag directly inside `Motion`.
- The required `animate` target is reactive and takes any subset of `opacity`,
  `x`, `y`, `rotate`, and `scale`. Numeric `x` and `y` are pixels; `rotate` is
  degrees; `opacity` and `scale` are unitless.
- `initial` and `exit` override the corresponding `animate` values, not the entire
  pose. Omit `initial` or pass `initial={false}` to snap to the latest `animate`
  target at first commit. Later updates can still animate.
- Motion leaves opacity and transform alone unless a target requests them.
  Families named in `animate`, `initial`, or `exit` at mount start owned. A later
  target can add a family from its underlying CSS style. Once owned, omitted
  values return to neutral instead of releasing ownership.
- Component `transition.duration` and `transition.delay` are in **seconds**. `ease`
  accepts CSS easing strings and `easeIn`, `easeOut`, and `easeInOut`. Timing
  changes apply on the next target change; they don't retime a running animation.
- Configure `exit` at mount under the control that owns removal: `Lc.Show` for a
  condition, `Lc.For` for keyed rows, or `Lc.Switch`/`Lc.Match` for alternative
  branches. Ordinary Solid conditionals still unmount immediately. Entrance and
  mounted target updates don't require a lifecycle boundary. Retained content
  stays interactive: move focus out before hiding it and set `inert` when appropriate.
  Motion respects reduced motion and snaps if retargeted while disconnected.

The [Postcard studio](../lifecycle/demo/postcard-studio.tsx) animates a custom
postcard whose `<li>` stays directly inside its `<ul>`. Undo during exit keeps the
same card and its local draft.

## Lower-level refs

For lower-level control (for example, to animate a descendant rather than the
component root), bind a ref to the exact DOM element you want to animate:

```tsx
import { Lifecycle as Lc } from '@kinetic-router/lifecycle'
import { createTransition, fade } from '@kinetic-router/animations'

function Panel() {
  const fadeRef = createTransition(fade, { duration: 180 })
  return <section ref={fadeRef}>Hello!</section>
}

<Lc.Show when={open()}><Panel /></Lc.Show>
```

`createTransition` uses WAAPI opacity/transform keyframes, reversible timelines,
pre-insertion styling, reduced-motion handling and automatic cleanup. Presets:
`fade`, `fadeScale`, `slide({ x: 0, y: 16 })`. Ref timings are **milliseconds**, unlike
component `transition` timings. Use `{ duration: { in: 400, out: 150 } }` for different
entry/exit speeds; reversal preserves the same timeline's visual progress.

For reactive changes to an already-mounted element, no lifecycle boundary is needed:

```tsx
import { createAnimation } from '@kinetic-router/animations'

const animateRef = createAnimation(
  () => ({ transform: `translateX(${expanded() ? 200 : 0}px)` }),
  { duration: 200 },
)
// <div ref={animateRef} />
```

`createAnimation` applies its first target before insertion without interpolation;
later changes animate between authored targets, sampling the displayed pose only
when interrupting active motion. For an entrance animation, use `createTransition`
on a separate wrapper: its first frame is prepared before insertion, then played.

Compile a spring once into ordinary native timing options:

```tsx
import { createTransition, slide, spring } from '@kinetic-router/animations'

const slideRef = createTransition(slide({ x: 100, y: 0 }), spring({
  stiffness: 200, damping: 20,
}))
```

`spring()` returns `{ duration, easing }`, usable with either helper or WAAPI.
It preserves overshoot using CSS `linear()`; it never runs physics each frame.

`createCssTransition` sets authored CSS state and waits for the named transitions
or keyframe animations on that element. List exact longhand or custom property names.
It handles reversals, cancellation and reduced motion without a JS animation loop.

```tsx
import { createCssTransition } from '@kinetic-router/animations'

const space = createCssTransition({
  apply: (element, direction) => { element.dataset.space = direction },
  properties: ['grid-template-rows'],
})
// <div class="space" ref={space}><div class="content">...</div></div>
```

```css
.space { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 200ms ease-out; }
.space[data-space=in] { grid-template-rows: 1fr; }
@starting-style { .space[data-space=in] { grid-template-rows: 0fr; } }
.content { min-height: 0; overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .space { transition-duration: 0s; } }
```

The grid transition may reflow layout each frame **inside the browser**; it does
not run JavaScript each frame. Prefer opacity/transform for compositor-friendly
motion. CSS owns timing and endpoints; animate a wrapper when combining effects.
Use `animations: ['panel-in', 'panel-out']` and `mode: 'separate'` for named CSS
animations whose entry must finish before exit. Unrelated effects and effects that
are already infinite are ignored. Selected effects must be allowed to finish or cancel.

Detailed contracts: [presence](src/transition.ts), [reactive targets](src/animation.ts),
[spring compiler](src/spring.ts), and [CSS helper](src/css-transition.ts).
See [the integration demo](../lifecycle/demo/main.tsx) for runnable examples.

## Run

From the monorepo root:

```sh
pnpm --filter @kinetic-router/animations... -r build
pnpm --filter @kinetic-router/animations test
# Shared integration demo; browser tests exercise both packages.
pnpm --filter @kinetic-router/lifecycle dev
pnpm --filter @kinetic-router/lifecycle test:browser:container
LIFECYCLE_DEV=1 pnpm --filter @kinetic-router/lifecycle test:browser:container
```
