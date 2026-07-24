# kinetic-router — project guide

A type-safe, client-side router for SolidJS, built on the W3C Navigation API.
pnpm monorepo with a version catalog (`pnpm-workspace.yaml`).

## Layout

| Package | Path | Purpose |
|---|---|---|
| `@kinetic-router/definition` | `definition/` | Framework-agnostic DSL for declaring routes, params, and sitemaps. No runtime routing. |
| `@kinetic-router/url` | `url/` | `Locator` ⇄ URL (de)serialization. Depends on `definition`. |
| `@kinetic-router/solid` | `solid/` | The actual SPA router for SolidJS (peer deps: `solid-js`, `@solidjs/web`, both 2.0 beta). |
| `example-app` | `example-app/` | Vite + `vite-plugin-solid` demo (private). `pnpm --filter example-app dev`. |

`ios-plan.md` documents the plan (and current status) for running kinetic-router apps
inside a native iOS shell. Read it before touching anything engine- or bridge-related.

## Commands

```sh
CI=true pnpm install          # CI=true avoids interactive prompts
pnpm -r build                 # tsc --build per package (no bundler)
npx vitest run                # all test projects (definition, url, solid)
CI=true pnpm --filter @kinetic-router/solid exec vitest run   # one package
```

Publishing: `./publish.sh` — patch-bumps and publishes packages changed since the
`published` git branch, then force-moves that branch. Don't run it casually.

## Core concepts

There are no `<Route>`/`<Link>` components and no `useNavigate`. The model is:

1. **Sitemap** (`definition`): `route(paramDefs)` creates `Route` objects (identity
   symbols — not serializable); `root({...})` builds the tree. String keys are path
   segments, `index` is the index route, `pathParam.$` (a symbol) is a dynamic
   segment. `root()` attaches a `Route → Slug[]` lookup (`slugLookup` symbol).
2. **Params**: `param.path/search/hidden<T>()`, with `.optional()` /
   `.withDefault()`. Hidden params live in history state, not the URL.
3. **Pages** (`solid/src/page.ts`): a route implementation. `render(untrackedParams)`
   returns (async) a function `(reactiveParams, pageStatus) => { html, title, ...ExtraOutput }`.
   Registered via `router.implement(route, page)` or `implementLazy`.
4. **Frames** (`solid/src/frame.ts`): outlets. The root frame carries id
   `__kinetic_router_root_frame` and a `FrameDelegate` attached to its DOM element.
5. **Links** are plain `<a href={router.toUrl(route.locate({...}))}>`; the engine
   intercepts them (Navigation API `navigate` event in browsers).

### Router internals (`solid/`)

- `Router` (`router.ts`) — the client-facing facade. Constructs `ActualRouter`
  asynchronously in a `queueMicrotask`; `currentLocator()` is signal-backed.
- `ActualRouter` (`actual-router.ts`) — the engine-agnostic core: resolves entries to
  `AppState`s, diffs route stacks (`diff.ts`: `'render' | 'set-params' | 'nothing'`
  per nesting level), reuses rendered subtrees, mounts through the frame chain.
- **`NavigationEngine`** (`navigation-engine.ts`) — the history-layer abstraction.
  The engine owns the history stack (entries, ids, states); the router owns rendering
  and caches rendered routes *by entry id*. Implementations:
  - `NavigationApiEngine` (default, browsers, `window.navigation`),
  - `MemoryEngine` (headless tests/tooling; also the reference for engine semantics),
  - `NativeBridgeEngine` (planned, see `ios-plan.md`).
  Inject via `new Router(sitemap, { engine })`.
- Caches: `RenderedRouteCache` (rendered routes keyed by entry id; disposed via the
  engine's `handleDispose`), `implCache`, `stateCache` (`AppState` by entry id).
- `AppState` (`app-state.ts`) is serializable and engine-agnostic; it's the `state`
  payload stored in history entries.

## Conventions & gotchas

- **Deep imports only for `@kinetic-router/solid`**: it declares `main: dist/index.js`
  but has no `src/index.ts`; consumers use `@kinetic-router/solid/router.js` etc.
  (wildcard export map). Same wildcard exists on `definition`.
- **No bundler for libraries** — plain `tsc --build tsconfig.build.json` emitting ESM
  into `dist/`. TS project references: url→definition, solid→definition+url.
  `tsconfig.base.json` uses `strict`, `erasableSyntaxOnly`, `isolatedModules`.
- **Tests live next to sources** (`src/*.test.ts`), excluded from builds via
  `tsconfig.build.json`.
- **solid-js resolves to a no-op server build under Node.** The solid package's
  `vitest.config.ts` forces `resolve.conditions: ['browser', 'development']` and
  inlines `solid-js` — without this, `createEffect` silently does nothing in tests.
- **Router tests don't need JSX**: pages can return plain DOM nodes (happy-dom), and
  the root frame is faked by attaching a `FrameDelegate` to a div with the root frame
  id (see `solid/src/router.test.ts`).
- Solid 2.0 beta API differences: `createEffect(compute, effect)` takes two functions;
  `createOwner`/`runWithOwner` are used directly (rendered routes manage their own
  owners, see `rendered-route.ts`).
- `Router` init is async (`queueMicrotask`): register all `implement()` calls
  synchronously after construction; in tests, wait until `currentLocator()` is defined.
- **Known failing tests**: 17 pre-existing failures in `url/src/deserialize.test.ts`
  (tests pass raw strings where `urlToLocator` expects `URL`/`{pathname, search}`).
  Not related to router work; fix separately.
- Browser support: the default engine requires the Navigation API (Chrome 102+,
  Safari 26.2+, Firefox 147+). There is deliberately no History-API fallback.
