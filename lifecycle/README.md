# @kinetic-router/lifecycle (prototype)

Lifecycle-aware control flow and native animations for Solid 2. Components keep
their DOM, reactive state, and event handlers while exiting; restoring them before
exit completes preserves the same instance.

Client-only, private, experimental. Requires Node 22.12+ and the workspace's pinned
Solid 2 release candidate. No router dependency or automatic page transitions.

## Use

```tsx
import { Lifecycle, createTransition, fade } from '@kinetic-router/lifecycle'

function Panel() {
  const motion = createTransition(fade, { duration: 180 })
  return <section ref={motion}>Hello!</section>
}

<Lifecycle.Show when={open()}><Panel /></Lifecycle.Show>
```

Presets: `fade`, `fadeScale`, and `slide({ x: 0, y: 16 })`. Bind each ref to one
element. Animations reverse smoothly, respect reduced motion, and clean up
automatically. Only opacity and transforms are supported; interpolation is native
WAAPI, with no per-frame JavaScript.

For custom motion, pass `{ inout: [hiddenFrame, visibleFrame] }`, or separate
`{ in: [...], out: [...] }` keyframes. Separate entry finishes before exit starts.
Options are `duration` (200ms), `delay` (0ms), and `easing` (`ease-out`), captured
at setup. Register `onEnter`, `onExit`, or `onInOut` for other async lifecycle work.

Lists and conditional branches work too:

```tsx
<Lifecycle.For each={items()} by={item => item.id}>
  {(item, index) => <Row item={item()} index={index()} />}
</Lifecycle.For>

<Lifecycle.Switch fallback={<NotFound />}>
  <Lifecycle.Match when={page() === 'home'}><Home /></Lifecycle.Match>
  <Lifecycle.Match when={page() === 'settings'}><Settings /></Lifecycle.Match>
</Lifecycle.Switch>
```

- List keys must be unique. Item/index arguments are always accessors.
- Data changes trigger transitions. Hiding a parent does not animate every nested
  row out; nested controls respond to their own data changes.
- Use lifecycle-aware controls at every removal point that needs retention.
  Ordinary conditionals and final unmount dispose immediately.
- Exit handlers must settle or respond to cancellation; there is no timeout.
  Retained content remains interactive: manage focus, `inert`, and ARIA as needed.

See [the demo](demo/main.tsx) for CSS-only effects and interactive examples.
Detailed contracts live beside the [hooks](src/scope.ts),
[controls](src/flow.ts), and [animation helper](src/animations.ts).

## Run

From the monorepo root:

```sh
CI=true pnpm install
pnpm --filter @kinetic-router/lifecycle build
pnpm --filter @kinetic-router/lifecycle test
pnpm --filter @kinetic-router/lifecycle dev
# Open http://127.0.0.1:5173
```

## Browser tests

Recommended: run all three browsers in the official prebuilt Playwright image.
Requires Podman or Docker, not host browser libraries:

```sh
pnpm --filter @kinetic-router/lifecycle test:browser:container
LIFECYCLE_DEV=1 pnpm --filter @kinetic-router/lifecycle test:browser:container
```

No image rebuilds: source is mounted read-only; dependencies are cached in volumes
separate from host `node_modules`. Results go to `lifecycle/test-results/container/`.
Arguments such as `--project=firefox` are forwarded. Set `CONTAINER_ENGINE=docker`
to prefer Docker when both engines are installed.

For native execution instead:

```sh
pnpm --filter @kinetic-router/lifecycle exec playwright install chromium firefox webkit
pnpm --filter @kinetic-router/lifecycle test:browser
```

On supported Debian/Ubuntu hosts, add `--with-deps` to the install command.
On Arch, with Chromium already working, these additional dependencies cover the
default browser builds (review AUR recipes before installing):

```sh
sudo pacman -S --needed \
  gtk3 gtk4 graphene libepoxy \
  gstreamer gst-plugins-base-libs gst-plugins-bad-libs \
  flite harfbuzz-icu libmanette enchant hyphen libxml2-legacy
paru -S --needed icu74 flite-voices-extra
```

These compatibility packages coexist with current system libraries. Arch is not
an officially supported Playwright host; browser updates may change requirements.
