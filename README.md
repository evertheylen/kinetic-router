# kinetic-router

A type-safe client-side router for SolidJS, built on the browser's Navigation API.
Declare routes separately from their page implementations, then navigate with
ordinary-looking links and render pages through `<Frame>` outlets.

## What it offers

- Typed sitemaps, aliases, and path, search, and hidden parameters.
- Async and lazy-loaded pages, nested layouts, and inherited parameters.
- `<Link>` and programmatic navigation, with push, replace, and menu/resume modes.
- Cached page instances that preserve DOM state across Back/Forward navigation.
- Opt-in, cancellable page preparation on hover, focus, or primary press.
- Reactive lifecycle signals for loading resources, visibility, and page focus.
- Injectable navigation engines, including a memory engine for headless use.

Requires Solid 2.0 release candidates and the Navigation API (Chrome 102+, Safari 26.2+,
Firefox 147+). There is no History API fallback. Animated page transitions are
not implemented yet.

## A small example

Define a route, implement its page, and mount a frame:

```tsx
import { index, param, root, route } from '@kinetic-router/definition';
import { render } from '@solidjs/web';
import { Frame } from '@kinetic-router/solid/frame.js';
import { Link } from '@kinetic-router/solid/link.js';
import { Router } from '@kinetic-router/solid/router.js';

const home = route({ name: param.search<string>().withDefault('world') });
const sitemap = root({ [index]: home });
const router = new Router(sitemap, { prefetch: true });

router.implement(home, {
  untrackedKeys: [],
  async render() {
    return params => ({
      title: 'Home',
      html: <section>
        <h1>Hello, {params.name}!</h1>
        <Link route={home.locate({ name: 'Solid' })}>Greet Solid</Link>
      </section>,
    });
  },
});

render(() => <Frame component="main" />, document.getElementById('root')!);
```

Here `name` is a typed search parameter, and the link updates it without a full
page load. Larger apps can use nested frames, lazy page implementations, and
`mode="menu"` links that resume the last visit to a section.

See [example-app](example-app/) for a working demo. Detailed option and lifecycle
contracts live beside the exported types in [link.ts](solid/src/link.ts),
[router.ts](solid/src/router.ts), and [page.ts](solid/src/page.ts).

## Try the demo

```sh
CI=true pnpm install
pnpm --filter @kinetic-router/solid... -r build
pnpm --filter @kinetic-router/example-app dev
```

Open http://localhost:3000. For tests and interactive browser scenarios, see
[integration-tests/README.md](integration-tests/README.md).
