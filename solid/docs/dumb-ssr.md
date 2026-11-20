# Dumb SSR: public HTML, then a fresh client render

`renderDumbSsr` is a separately imported server entry in `@kinetic-router/solid`.
It renders useful public, URL-specific HTML for search engines, social previews
and no-JavaScript viewing. The browser then starts the ordinary client router
from scratch. **No hydration, DOM adoption, history snapshot or server data
transfer.** The server renderer is not a `NavigationEngine`.

Expect **public content → client loading shell → client content**, including
separate server and client API calls. This is not a faster-interactivity or
DOM-continuity feature. Scroll, focus and layout can change during takeover.

## Server entry

```tsx
import { SolidImplementationMap } from '@kinetic-router/solid/implementation-map.js';
import { renderDumbSsr, DumbSsrUrlError } from '@kinetic-router/solid/dumb-ssr.js';
import { sitemap, registerPages, App } from './pages.js';

const pages = new SolidImplementationMap<{}, { description: string }>(sitemap);
registerPages(pages);

const { html, title, description } = await renderDumbSsr({
  sitemap,
  pages,
  url: new URL(request.url),
  signal: request.signal,
  app: () => <App />,
});
```

`registerPages` is an ordinary application function accepting the existing
`implement`/`implementLazy` methods. Pass it a `Router` in the browser and a
`SolidImplementationMap` on the server. There is no second page DSL or
`ssrRender` method. Public server-specific implementations may use the same API.
Keep a shared map's registrations unchanged while requests are running.

The explicit URL is matched using the normal sitemap, aliases and parameter
defaults. If the app is mounted under a prefix, pass the same `basePath` (e.g.
`'/tools/app'`) to `renderDumbSsr` and the browser `Router`. SSR Links then include
that prefix. Configure the host to serve direct visits under the mount as well.

The result is the complete app markup plus the **leaf page's** title
and application-defined `ExtraOutput`. If `app` is omitted, the matched page
stack renders directly. Otherwise `app` must contain a root `Outlet`; each
matched layout must supply its child `Outlet`. Leaf outlets are empty. Missing
or competing required outlets reject rather than silently dropping/duplicating
matched content. Ordinary async Solid children and intentional error fallbacks
are supported; a fallback must still supply the required matched stack.

Inputs are one-shot, frozen parameter objects, split by each page's
`untrackedKeys`; inherited values follow parameter-definition identity, not key
names. Hidden inputs never read history/storage. They have only their declared
defaults or absent values—even a required hidden input can be absent. Applications
must render a public fallback rather than fabricate a private journey/ticket.
Missing required path/search inputs reject before page factories run.

Factories and output run under request-owned Solid scopes. Register `onCleanup`
synchronously before awaiting application work. Server `PageStatus` permits
fetching only for the render lifetime, supplies `fetchSignal()`, and always
reports visibility/focus/animation as false. Pass signals to loaders. Completion,
failure and caller cancellation dispose scopes and abort owned fetching; ignored
cancellation cannot keep the caller waiting or invoke a late returned closure.
A host deadline can use `AbortSignal.any([request.signal, AbortSignal.timeout(ms)])`.

`DumbSsrUrlError` distinguishes matching/deserialization/missing-input failures
and preserves the original `cause`. Do not classify every exception—or every
user-serde failure—as a 404. Genuine implementation/render failures reject;
HTTP status, redirects, logging and error documents belong to your adapter.

### Build and public-data boundary

Use server-conditioned Solid and SSR-compiled JSX on the server; build the
browser for ordinary, **non-hydrating DOM rendering**. With the installed Vite
plugin, the fixture uses `solid({ ssr: !!isSsrBuild })`: server transforms only
for the server build. Do not add a hydration script or initial-state payload.
The server entry uses Solid's `NoHydration` plus `noScripts`; it does not supply
a custom scheduler or progressive HTTP streaming API.

Shared page imports must not construct a browser `Router`, initialize analytics,
native bridges or browser storage. Reusing `Page` does not make arbitrary client
code server-safe. Client-only handlers must not force those imports on the server.
The browser components import only a small scoped context, not the server entry.

The library does not authorize requests or enforce public-data policy. Never
forward private account credentials into public page loaders. Give shareable
pages sufficient URL identifiers; choose indexing policy for personal/ephemeral
query pages deliberately.

## HTTP document and metadata

Send a full document with `html` inside a designated app root, styles and the
normal client entry script. Put title, description, canonical and Open Graph
metadata in the **HTTP response**, not just client-side effects. Escape metadata
for its HTML context; derive canonical/absolute social URLs and images from a
trusted configured public origin, not an unchecked request Host. Serve the same
public HTML policy to humans and crawlers—no bot detection.

Only app-root children are replaced. Preserve the document, head, loaded assets
and bootstrap script. The browser router updates `document.title`; other metadata
updates are application-owned and should edit existing tags, not recreate the head.

## Browser entry: replace, do not hydrate

```tsx
import { render } from '@solidjs/web';
import { Router } from '@kinetic-router/solid/router.js';
import { sitemap, registerPages, App } from './pages.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing app root');

const dispose = render(() => {
  const router = new Router(sitemap);
  registerPages(router);
  return <div><App router={router} /></div>;
}, root, Array.from(root.childNodes));

import.meta.hot?.dispose(dispose);
```

The fresh outer element matters: top-level primitive text can reuse an SSR Text
node in the supported Solid runtime. An existing element-rooted app shell is also
fine. Plain `render(app, root)` appends beside old HTML; the third argument removes
it without hydration. The same recipe works with an empty CSR shell. No new
replacement utility is needed.

Construct the Router under the render owner for automatic cleanup, register pages
synchronously, and mount the root `Outlet` immediately. Show loading/error UI
**alongside** the outlet; gating it on `currentLocator()` prevents initialization.
Use the current browser URL and ordinary client fetching/personal state. Do not
wait for every background request, stage a hidden app, or build a global readiness
protocol. Do not rewrite the document, clear `innerHTML`, use `document.write`,
reload, or execute fetched HTML as scripts.

An uncaught synchronous app-construction exception before attachment preserves
public nodes and disposes the owned Router in the inspected Solid runtime. This
is not rollback for arbitrary DOM mutations, effects, refs or async failures.
Disposal after successful takeover does not restore SSR. A bootstrap failure before
takeover leaves public content and native anchors usable.

**Initial Router errors have no comprehensive observable channel yet.** Router
initialization runs in an async microtask: `try/catch` around `render`, ordinary
Solid `Errored` and native `navigateerror` do not cover its failures.
`currentLocator() === undefined` cannot distinguish pending from failed/disposed;
URL-normalization `navigatesuccess` is not readiness. The example explicitly
handles its own initial API failures, disposes the failed root, and offers retry
with a fresh Router. It ignores aborted/stale attempts. This is an application
seam, not general registration/lazy-loader/renderer startup recovery; don't build
an error API by filtering global `unhandledrejection`. Subsequent navigation
failures have their navigation result/native error path.

Disable or make SSR form controls read-only, or show non-editable summaries, so
users cannot enter edits that vanish at replacement. Ordinary anchors remain
usable without JS. Do not steal focus or maintain a second hidden interactive copy.

## Runnable production fixture and validation

From the repository root:

```sh
pnpm -r build
pnpm --filter @kinetic-router/integration-tests exec node ssr-server.mjs
# Open http://127.0.0.1:4174/go/home
# ?shell serves an empty CSR shell; ?startupFailure demonstrates sync retry.
pnpm -w run test:browser
pnpm exec vitest run --project solid-server
NODE_ENV=production pnpm exec vitest run --project solid-server
```

Stop the manual server before running Playwright, which starts its own servers.
The fixture lives in `integration-tests/src/dumb-ssr/`, with a small HTTP adapter
in `integration-tests/ssr-server.mjs`. Tests in `integration-tests/tests/dumb-ssr.e2e.ts`
exercise production SSR/DOM builds in Chromium: JS-disabled HTML/head/native links,
non-editable SSR controls, fresh-node replacement exactly once, loading/API handoff,
empty-shell CSR, synchronous failure, app-handled API failure, stale attempts,
disposal/retry and navigation/Back/Forward. Node tests are a separate server-conditioned
Vitest project; run them in both default and `NODE_ENV=production` conditions.
Other browsers and real deployment/transport policies need application validation.

Service workers remain application-owned. A precached empty CSR shell uses this
same bootstrap; never cache one route-specific SSR document as every URL's shell.
Use hashed assets, retain old referenced assets, and do not force a reload over
handoff/unsaved edits. Align assets/manifest/worker scope with the app's sitemap
boundary (for Chuuchuu, literal `/go/`); keep website/API traffic outside its PWA
fallback. Worker takeover, offline policy, asset retention and consuming-app
migration are not router protocols or first-library-release gates.
