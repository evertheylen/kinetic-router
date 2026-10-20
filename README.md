# kinetic-router

A type-safe client-side router for SolidJS, built on the browser's Navigation API.
Requires Solid 2.0 beta and a browser with Navigation API support; no History API fallback.

## Status / TODO

- [x] Typed routes, aliases, and path/search/hidden parameters.
- [x] Multi-level nested pages with inherited parameters and `<Frame>` outlets.
- [x] Ordinary `<a href={router.toUrl(route.locate(params))}>` links, programmatic
  navigation, and back/forward navigation. There is no dedicated `<Link>` component.
- [x] Reuse rendered pages and restore cached DOM on back/forward navigation.
- [x] Bounded page cache and cleanup on history-entry `dispose` events.
- [ ] Prefetch pages on hover or pointer/touch down (`implementLazy` is loading on demand, not prefetching).
- [x] Discard superseded renders and dispose unfinished page owners without
  overwriting newer pages.
- [ ] Propagate navigation abort signals to page fetches. Pending application
  promises and fetches still need application-managed cancellation.
- [ ] Implement reactive `PageStatus`: visibility, focus, fetching, and animation
  status are still placeholders. Offscreen cached pages are not automatically paused.
- [ ] Animated page transitions / View Transition API integration. Pages currently
  swap DOM directly; `navigation.transition` tracks pending rendering, not animation.

## Page cache

```ts
const router = new Router(sitemap, { maxCachedPages: 10 }); // default
```

The cache evicts **least-recently-visited history-entry stacks**, not individual
nested pages. Visits refresh recency and enforce the budget when rendering completes;
no timers are used. Incoming and outgoing pages can coexist during rendering.

- The budget counts distinct rendered page instances, including ancestors.
  Shared parents count once. Keeping a child always keeps its complete ancestor stack.
- Retained history-entry indexes are also capped at this number, so repeated visits
  sharing one page cannot grow cache bookkeeping indefinitely.
- The visible stack is never evicted, even if its nesting depth exceeds the budget.
  `maxCachedPages: 0` keeps only the visible stack. Limits must be non-negative safe integers.
- Eviction does not change browser history. Revisiting an evicted entry renders it
  again: URL/hidden parameters and saved scroll positions survive, but local page state resets.
- Pages are disposed only when no retained entry or visible stack needs them.
  Solid cleanup handlers run; fetch cancellation still needs application-managed cleanup.

## Development

```sh
CI=true pnpm install
pnpm -w test              # build + unit tests
pnpm -w run test:browser  # real Navigation API tests in Chromium
pnpm --filter example-app dev
```

See [integration-tests/README.md](integration-tests/README.md) for browser setup and manual scenarios.
