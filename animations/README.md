# @kinetic-router/animations (prototype)

Browser-native reactive and lifecycle animations for Solid 2. Client-only, private,
experimental; uses the workspace's Solid 2 catalog version. No router
integration, dependencies on an animation engine, or per-frame JavaScript.

```tsx
import { Lifecycle } from '@kinetic-router/lifecycle'
import { createTransition, fade } from '@kinetic-router/animations'

function Panel() {
  const motion = createTransition(fade, { duration: 180 })
  return <section ref={motion}>Hello!</section>
}

<Lifecycle.Show when={open()}><Panel /></Lifecycle.Show>
```

`createTransition` uses WAAPI opacity/transform keyframes, reversible timelines,
pre-insertion styling, reduced-motion handling and automatic cleanup. Presets:
`fade`, `fadeScale`, `slide({ x: 0, y: 16 })`. Timings are milliseconds. Use
`{ duration: { in: 400, out: 150 } }` for different entry/exit speeds; reversal
preserves the same timeline's visual progress.

For reactive changes to an already-mounted element, no lifecycle boundary is needed:

```tsx
const motion = createAnimation(
  () => ({ transform: `translateX(${expanded() ? 200 : 0}px)` }),
  { duration: 200 },
)
// <div ref={motion} />
```

`createAnimation` applies its first target before insertion without interpolation;
later changes animate between authored targets, sampling the displayed pose only
when interrupting active motion. For an entrance animation, use `createTransition`
on a separate wrapper: its first frame is prepared before insertion, then played.

Compile a spring once into ordinary native timing options:

```tsx
const motion = createTransition(slide({ x: 100, y: 0 }), spring({
  stiffness: 200, damping: 20,
}))
```

`spring()` returns `{ duration, easing }`, usable with either helper or WAAPI.
It preserves overshoot using CSS `linear()`; it never runs physics each frame.

`createCssTransition` sets authored CSS state and waits for the named transitions
or keyframe animations on that element. List exact longhand or custom property names.
It handles reversals, cancellation and reduced motion without a JS animation loop.

```tsx
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
See [API comparison and gaps](API-COMPARISON.md) and [the integration demo](../lifecycle/demo/main.tsx).

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
