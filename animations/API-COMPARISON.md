# API comparison and gaps

This package supplies **native reactive and presence animations**, not a general
Motion replacement. `lifecycle` owns retention and branch sequencing; `animations`
only supplies effects and a setup-time spring compiler. There is no JavaScript
animation loop. CSS layout interpolation can reflow the page inside the browser;
prefer opacity/transform when compositor-only motion matters.

## Solid Motion / Solid MotionOne

The concrete comparison is [`solid-motionone`](https://github.com/solidjs-community/solid-motionone),
whose API is `<Motion initial animate exit transition>` plus `<Presence>`.
Its [package metadata](https://github.com/solidjs-community/solid-motionone/blob/main/package.json)
requires Solid `^1.8.0`; this repository uses Solid 2 RC. It is not a drop-in
runtime dependency or the same API as Motion for React.

| Concern | This package + lifecycle | Solid MotionOne |
| --- | --- | --- |
| Binding | Setup functions returning refs; ordinary DOM/JSX | `<Motion.div>` / `<Motion tag="…">`, including SVG |
| Retention | Explicit `Lifecycle.For/Show/Switch`; retains owners and state | `<Presence>` with `exit` |
| Branch sequencing | `Lifecycle.Switch mode="out-in"` waits for work and disposal | `<Presence exitBeforeEnter>` |
| Presence effects | `{ inout }` reversible timeline, or separate `{ in, out }` | `initial`, `animate`, `exit` targets |
| Updates while mounted | `createAnimation(() => target, options)` | Reactive `animate` properties |
| Properties | Direct WAAPI: opacity/transform; CSS adapter: authored properties/names | Independent x/rotate/scale and other CSS properties |
| Timing | Milliseconds, finite iteration, scalar or `{ in, out }` duration | Seconds, per-property options and exit-specific timing |
| Springs | `spring()` compiles finite CSS `linear()` timing once | Spring generators can precompute native keyframes |
| Authored CSS | Explicit finite property/keyframe-name filtering | Primarily declarative Motion targets |
| Initial appearance | Presence prepares the hidden endpoint before insertion, then plays | `initial` target; `initial={false}` skips first animation |
| Reduced motion | Helpers skip motion/delays and respond during playback | Not specified in the README used for the comparison |

`createCssTransition({ mode: 'separate' })` sequences one element's entry before
its exit. It is not branch-level out-in sequencing. Ordinary Solid conditionals
still unmount immediately; animation refs do not intercept them.

## Native equivalents now available

```tsx
// Solid MotionOne: animate={{ x: expanded() ? 200 : 0 }}
const motion = createAnimation(
  () => ({ transform: `translateX(${expanded() ? 200 : 0}px)` }),
  { duration: 200 },
)

// Solid MotionOne: transition duration plus exit-specific transition duration.
const presence = createTransition(fade, { duration: { in: 400, out: 150 } })

// Solid MotionOne core: easing: spring({ stiffness: 200, damping: 20 }).
const springTiming = spring({ stiffness: 200, damping: 20 })
const springMotion = createTransition(slide(), springTiming)
```

The reactive helper's first target applies before insertion without interpolation;
it animates subsequent target changes. For appearance, use a separate wrapper with
`createTransition`: the hidden first frame is installed before insertion and then
played. This prevents a flash; it does not suppress entry. No `initial: false`
option has been added to presence effects.

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
- **Transform shorthands.** Native transform strings stay the API; presets are just
  reusable keyframes. No custom-property composition engine is needed.
- **Gesture physics, inertia, arbitrary JS-value animation.** These are outside the
  browser-native scope. Native scroll/view timelines are preferable to JS scroll
  interpolation if scroll-linked effects are added later.
