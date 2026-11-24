# kinetic-router

A type-safe client-side router for SolidJS, built on the browser's Navigation API.
Declare routes separately from their page implementations, then navigate with
ordinary-looking links and render pages through `<Outlet>` components.

## What it offers

- Typed sitemaps, aliases, and path, search, and hidden parameters.
- Mount the same sitemap at `/` or a subpath with `new Router(sitemap, { basePath: '/tools/app' })`.
- Async and lazy-loaded pages, nested layouts, and inherited parameters.
- `<Link>` and programmatic navigation, with push, replace, and menu/resume modes.
- Cached page instances that preserve DOM state across Back/Forward navigation.
- Opt-in, cancellable page preparation on hover, focus, or primary press.
- Reactive lifecycle signals for loading resources, visibility, and page focus.
- Experimental per-outlet page animations in this workspace: `MotionOutlet` from
  `@kinetic-router/motion-router` pairs with the private `@kinetic-router/motion`
  and `@kinetic-router/lifecycle` packages. These three packages are not published.
- Injectable navigation engines, including a memory engine for headless use.
- Optional [dumb SSR](solid/docs/dumb-ssr.md): public HTML followed by a fresh
  client render, without hydration or server-state transfer.

Requires Solid 2 (`solid-js` and `@solidjs/web` 2.0.3 or newer within 2.x) and
the Navigation API (Chrome 102+, Safari 26.2+, Firefox 147+). There is no
History API fallback.

## A small example

Define a route, implement its page, and mount an outlet:

```tsx
import { index, param, root, route } from '@kinetic-router/definition';
import { render } from '@solidjs/web';
import { Outlet } from '@kinetic-router/solid/outlet.js';
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

render(() => <Outlet component="main" />, document.getElementById('root')!);
```

Here `name` is a typed search parameter, and the link updates it without a full
page load. Larger apps can use nested outlets, lazy page implementations, and
`mode="menu"` links that resume the last visit to a section.

See [example-app](example-app/) for a working demo. Detailed option and lifecycle
contracts live beside the exported types in [link.ts](solid/src/link.ts),
[router.ts](solid/src/router.ts), and [page.ts](solid/src/page.ts).

## Try the demo

```sh
CI=true pnpm install
pnpm --filter @kinetic-router/example-app... -r build
pnpm --filter @kinetic-router/example-app dev
```

Open http://localhost:3000. For tests and interactive browser scenarios, see
[integration-tests/README.md](integration-tests/README.md).
