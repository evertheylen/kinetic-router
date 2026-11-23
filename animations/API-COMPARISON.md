# API comparison and gaps

This package supplies **native reactive and presence animations**. `motion` and
`AnimatePresence` are inspired by Motion for React, not API-compatible with it.
`lifecycle` owns retention and branch sequencing; Motion components use native
WAAPI, without CSS transition setup, data attributes, or a JavaScript animation
loop. The separate CSS adapter can delegate layout interpolation to the browser;
prefer opacity/transform when compositor-only motion matters.

## Solid Motion / Solid MotionOne

The concrete comparison is [`solid-motionone`](https://github.com/solidjs-community/solid-motionone),
whose API is `<Motion initial animate exit transition>` plus `<Presence>`.
Its [package metadata](https://github.com/solidjs-community/solid-motionone/blob/main/package.json)
requires Solid `^1.8.0`; this repository uses Solid 2. It is not a drop-in
runtime dependency or the same API as Motion for React.

| Concern | This package + lifecycle | Solid MotionOne |
| --- | --- | --- |
| Binding | `motion` shorthands or `motion.create('article')` for native HTML; native props, refs, and children; lower-level ref helpers | `<Motion.div>` / `<Motion tag="…">`, including SVG |
| Retention | `<AnimatePresence when={shown()}>` wraps `Lifecycle.Show`, not child diffing; use `Lifecycle.For` for keys or `Lifecycle.Switch` for branches | `<Presence>` with `exit` |
| Branch sequencing | `Lifecycle.Switch mode="out-in"` waits for work and disposal | `<Presence exitBeforeEnter>` |
| Presence effects | Optional partial `initial` and `exit` override the `animate` pose; `createTransition` also supports reversible `{ inout }` or separate `{ in, out }` keyframes | `initial`, `animate`, `exit` targets |
| Updates while mounted | Reactive `animate` target or `createAnimation(() => target, options)` | Reactive `animate` properties |
| Properties | `opacity`, `x`/`y` in pixels, `rotate` in degrees, and `scale`; low-level opacity/transform strings or authored CSS via the adapter | Independent x/rotate/scale and other CSS properties |
| Timing | Motion components use **seconds** and CSS easing or `easeIn`/`easeOut`/`easeInOut`; refs use **milliseconds** and `createTransition` supports `{ in, out }` duration | Seconds, per-property options and exit-specific timing |
| Springs | `spring()` compiles finite CSS `linear()` timing once for lower-level helpers or WAAPI | Spring generators can precompute native keyframes |
| Authored CSS | Optional adapter with explicit property/keyframe-name filtering | Primarily declarative Motion targets |
| Initial appearance | Without `initial`, or with `initial={false}`, Motion snaps to the first `animate` pose; `createTransition` prepares the hidden endpoint before insertion | `initial` target; `initial={false}` skips first animation |
| Reduced motion | Helpers skip motion/delays and respond during playback | Not specified in the README used for the comparison |

`createCssTransition({ mode: 'separate' })` sequences one element's entry before
its exit. It is not branch-level out-in sequencing. Ordinary Solid conditionals
still unmount immediately; animation refs do not intercept them.

## Choosing an API

```tsx
import { AnimatePresence, motion } from '@kinetic-router/animations'

<AnimatePresence when={shown()}>
  <motion.div initial={false} animate={{ x: expanded() ? 200 : 0, opacity: 1 }}
    exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: 'ease-out' }} />
</AnimatePresence>
```

Use Motion components for declarative targets with a shared transition. Changes
in timing are sampled on the next target change, not applied to a running effect.
Use refs for authored transform strings, multiple keyframes, exit-specific timing,
or CSS coordination. The milliseconds in these ref examples are intentional:

```tsx
import { createAnimation, createTransition, fade, slide, spring } from '@kinetic-router/animations'

const moveRef = createAnimation(
  () => ({ transform: `translateX(${expanded() ? 200 : 0}px)` }),
  { duration: 200 },
)
const fadeRef = createTransition(fade, { duration: { in: 400, out: 150 } })
const springRef = createTransition(slide(), spring({ stiffness: 200, damping: 20 }))
```

## Where Motion One adds machinery beyond WAAPI

Based on the inspected `@motionone/dom@10.17.0` implementation:

- [Independent transforms](https://unpkg.com/@motionone/dom@10.17.0/lib/animate/utils/transforms.js)
  compose through registered `--motion-*` custom properties, rather than a simple
  native transform string. These paths are not automatically compositor-eligible.
- [Spring generators](https://unpkg.com/@motionone/dom@10.17.0/lib/easing/create-generator-easing.js)
  pre-generate keyframes and can carry velocity across retargeting. Springs do not
  inherently imply per-frame JavaScript. Our simpler compiler has no carried
  velocity: inout reversal retraces the same finite easing curve.
- [Compatibility paths](https://unpkg.com/@motionone/dom@10.17.0/lib/animate/animate-style.js)
  can fall back to a JS numeric animation for transforms when native support is
  insufficient. That implementation also has a default WebKit workaround forcing
  native animations onto the main thread. Browser main-thread animation is distinct
  from per-frame JavaScript. Our helpers provide no JS interpolation fallback.
- Presence, target retargeting, hover/press state and in-view observation add
  framework/event coordination. They do not intrinsically require a JS frame loop.

## Deliberately not implemented

- **Per-property timing and stagger utilities.** Simple stagger is index × delay;
  multiple timelines can already be composed on wrapper/child elements.
- **Reorder/shared-layout motion.** Neither this package nor Solid MotionOne has a
  built-in `layout` / `layoutId` API. Broader [Motion](https://github.com/motiondivision/motion/tree/main/packages/motion)
  and [AutoAnimate](https://auto-animate.formkit.com/) offer layout/move animation.
  The CSS space helper collapses entering/leaving flow, not keyed reorders. FLIP can
  use one-shot measurements plus native transforms, but geometry/scroll/clipping
  and interruption coordination are a separate, larger feature.
- **Independent transform timelines and a custom-property composition engine.**
  Motion's numeric transform shorthands compose into a native transform; the
  lower-level refs still accept authored transform strings.
- **Gesture physics, inertia, arbitrary JS-value animation.** These are outside the
  browser-native scope. Native scroll/view timelines are preferable to JS scroll
  interpolation if scroll-linked effects are added later.
