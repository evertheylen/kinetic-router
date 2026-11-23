# @kinetic-router/lifecycle (prototype)

Lifecycle-aware control flow for Solid 2. Components keep
their DOM, reactive state, and event handlers while exiting; restoring them before
exit completes preserves the same instance.

Client-only, private, experimental. Uses the workspace's Solid 2 catalog version
and requires Node 22.12+. No router dependency or automatic page transitions.

## Use

```tsx
import { Lifecycle } from '@kinetic-router/lifecycle'
import { createTransition, fade } from '@kinetic-router/animations'

function Panel() {
  const motion = createTransition(fade, { duration: 180 })
  return <section ref={motion}>Hello!</section>
}

<Lifecycle.Show when={open()}><Panel /></Lifecycle.Show>
```

Animation helpers live in [`@kinetic-router/animations`](../animations/README.md).
Register `onEnter`, `onExit`, or `onInOut` for other async lifecycle work.

Lists and conditional branches work too:

```tsx
<Lifecycle.For each={items()} by={item => item.id}>
  {(item, index) => <Row item={item()} index={index()} />}
</Lifecycle.For>

<Lifecycle.Switch mode="out-in" fallback={<NotFound />}>
  <Lifecycle.Match when={page() === 'home'}><Home /></Lifecycle.Match>
  <Lifecycle.Match when={page() === 'settings'}><Settings /></Lifecycle.Match>
</Lifecycle.Switch>
```

- List keys must be unique. Item/index arguments are always accessors.
- Switch defaults to parallel branches. `mode="out-in"` waits for outgoing work
  and disposal before mounting the latest selection; selecting an exiting branch
  again restores its existing owner/state.
- Data changes trigger transitions. Hiding a parent does not animate every nested
  row out; nested controls respond to their own data changes.
- Use lifecycle-aware controls at every removal point that needs retention.
  Ordinary conditionals and final unmount dispose immediately.
- Exits wait for the promises you return; there is no timeout. Use the provided
  abort signal to cancel work on reentry or final unmount.
- `useLifecycle().phase()` is a signal, not a DOM attribute. Retained content stays
  interactive unless the component manages focus, `inert`, or ARIA itself.

See [the demo](demo/main.tsx) for CSS-only effects and interactive examples.
Detailed contracts live beside the [hooks](src/scope.ts)
and [controls](src/flow.ts).

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
