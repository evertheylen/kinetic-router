# kinetic-router iOS Native Plan

Turn kinetic-router SPAs into native-feeling iOS apps: a single `WKWebView` renders the
SolidJS app, while a native `UINavigationController` owns the navigation stack. On
navigation, the current page is frozen as a snapshot, the webview is handed to a new
screen, and the transition (including the interactive back-swipe) is 100% native.

This is the architecture pioneered by Turbo/Hotwire Native, adapted for client-side
rendering. It is a *better* fit for an SPA than for server-rendered pages: there is one
persistent JS context across the entire native stack, so application state, data caches,
and Solid's reactive graph survive every navigation — no page reloads, ever.

## Guiding requirement

**Application code must be environment-agnostic.** A kinetic-router app (sitemap, pages,
frames, `router.toUrl(...)` links) must run unchanged in a regular browser and inside the
native shell. No custom build, no separate router instance in userland. The switch
happens inside the library, at runtime.

---

## Architecture overview

```
┌─ iOS App (SwiftUI) ────────────────────────────────────────────┐
│  KineticNavigationView (SwiftUI wrapper)                       │
│   └─ KineticNavigationController (UINavigationController)      │
│       ├─ VisitableViewController  [snapshot]      (entry 1)    │
│       ├─ VisitableViewController  [snapshot]      (entry 2)    │
│       └─ VisitableViewController  [live WKWebView] (entry 3)   │
│                                        ▲                       │
│  KineticSession ── Bridge ─────────────┘                       │
└──────────────│─────────────────────────────────────────────────┘
               │ JSON messages (WKScriptMessageHandlerWithReply /
               │                evaluateJavaScript)
┌──────────────▼─────────────────────────────────────────────────┐
│  SPA bundle (unchanged app code)                               │
│   Router ─► ActualRouter ─► NavigationEngine (interface)       │
│                              ├─ NavigationApiEngine (browser)  │
│                              └─ NativeBridgeEngine (in shell)  │
└────────────────────────────────────────────────────────────────┘
```

**Ownership rule:** in native mode, **Swift owns the history stack**. JS *proposes*
visits and *renders on command*. This is non-negotiable because the interactive pop
gesture is native, cancellable mid-flight, and must never wait on JS.

**Route-identity rule:** routes are identity symbols that exist only in JS. Swift never
parses URLs or matches routes. Anything Swift needs to know about a route (presentation,
tags) is resolved in JS and shipped in the `visitProposed` payload.

---

## Decisions

- **Minimum iOS version: 26.** Motivations beyond "greenfield library":
  - `WKWebView.obscuredContentInsets` (new in 26.0): shrinks the layout viewport for
    areas covered by native chrome (nav bar, tab bar) and fixes `fixed`/`sticky`
    rendering near those edges — the correct solution for web content flowing under
    translucent/Liquid Glass bars. Pre-26 this is inset-hack territory.
  - `WKWebView.restoreData(_:)` + session/local-storage restoration APIs (26.0):
    directly serve the webview process-death recovery story.
  - Liquid Glass is the only design target for the shell's chrome; no
    compatibility-mode styling.
  - Swift 6.2 (default MainActor isolation etc.) keeps bridge code simple.
  - Consistent with browser mode already requiring the Navigation API (Safari 26.2+).
  - Note: the new SwiftUI `WebView`/`WebPage` (also 26.0) is *not* usable for the core —
    we must snapshot and reparent a raw `WKWebView` across view controllers, and
    `WebPage` doesn't expose its underlying webview. Possibly useful later for
    auxiliary surfaces.
- **Native metadata is resolved in JS** and travels with each proposal (see "Route
  metadata"). Swift-side `RouteConfiguration` is reduced to an optional override /
  native-screen mechanism keyed on JS-assigned tags, not URLs.
- **Bundle delivery: served remotely** (instant updates, no app-store round-trip).
  Version compatibility between the deployed bundle and the installed shell is handled
  at two levels: the shell advertises itself in the user agent
  (`KineticNative/<shellVersion>; protocol <protocolVersion>`) so the server can serve
  a compatible bundle, and the `ready` handshake hard-rejects protocol mismatches.
  Exact update/rollback/offline strategy to be revisited later.

---

## Part 0 — Prerequisite refactor in `@kinetic-router/solid`

Today `ActualRouter` (`solid/src/actual-router.ts`) is hard-wired to `window.navigation`.
Extract the history layer behind an interface; everything else (diffing, rendered-route
cache, frames, pages) stays untouched.

```ts
// solid/src/navigation-engine.ts
export type EngineEntry = {
  id: string;
  url: string;
  getState(): unknown; // serialized AppState
};

export type NavigationIntent = {
  url: string;
  state: unknown;
  history: "push" | "replace";
  info?: unknown;
};

export interface NavigationEngine {
  /** Programmatic navigation (Router.navigate). */
  navigate(intent: NavigationIntent): void;
  currentEntry(): EngineEntry | undefined;
  updateCurrentEntry(state: unknown): void;
  /**
   * Fires for every navigation the engine observes (programmatic, link
   * click, traverse/back). The handler renders and resolves when done.
   */
  onNavigate(handler: (event: EngineNavigateEvent) => Promise<void>): void;
  /** Entry evicted from history; router disposes cached rendered routes. */
  onDispose(handler: (entryId: string) => void): void;
}
```

Implementations:

1. **`NavigationApiEngine`** — the existing `window.navigation` code, moved verbatim.
   Zero behavior change in browsers. Remains the default.
2. **`MemoryEngine`** — trivial in-memory stack. Free byproduct of the refactor; enables
   the currently-missing headless tests for `@kinetic-router/solid` and SSR-ish tooling.
3. **`NativeBridgeEngine`** — lives in the new JS package (Part 1).

Engine selection happens inside `new Router(sitemap)` (or an optional constructor
argument for tests): detect the native shell, otherwise use the Navigation API engine.
App code never sees this.

Notes:

- `AppState` (`solid/src/app-state.ts`) is already serializable and engine-agnostic —
  it becomes the `state` payload for every engine. Its existing `snapShotByKey` slot is
  where scroll positions get stashed (see “Scroll restoration” below).
- `ActualRouter.getState()` already accepts a structural `{id?, getState?, url?}` entry,
  so `EngineEntry` slots in with minimal churn.
- `RenderedRouteCache` is keyed by entry id today (Navigation API entry ids); it keeps
  working as-is with engine-issued ids. In native mode, entry ids are minted by Swift
  and map 1:1 to view controllers.

---

## Part 1 — JS package: `@kinetic-router/native-bridge`

Platform-generic name on purpose (an Android shell can reuse it later). Depends on
`@kinetic-router/solid`. Contents:

### Detection & handshake

- Native shell is detected via `window.webkit?.messageHandlers?.kineticRouter`
  (deterministic: Swift registers the handler before any script runs) plus a user-agent
  suffix (`KineticNative/<version>`) as a sanity check.
- On startup the engine sends `ready { protocolVersion, bundleVersion, url }` and
  receives the initial instruction set (initial entry id, possibly a deep-link stack).
  Protocol version mismatch → loud error, not silent breakage. (With remote bundle
  delivery, the UA string lets the server pick a compatible bundle *before* this point;
  the handshake is the last line of defense.)

### `NativeBridgeEngine implements NavigationEngine`

- **Link interception:** in native mode, do *not* rely on the Navigation API. Install a
  capturing `document` click listener for same-origin `<a>` elements (`target`,
  modifier keys, `download` etc. respected). This means native mode works on iOS
  versions older than 26.2 (where WKWebView gained the Navigation API), and JS history
  is never touched — the webview's own URL is irrelevant.
- **`navigate(intent)`** and intercepted clicks both become `visitProposed` messages to
  Swift. The engine does not render anything on its own. Before sending, the engine
  resolves the URL to a route (`router.toLocator`) and attaches:
  - the route's canonical slug pattern (derivable from the `slugLookup` that `root()`
    already computes, e.g. `"users/:id/posts"`) — a stable, human-readable identifier
    for logging/debugging and coarse matching, since `Route` objects themselves are
    identity symbols with no serializable form;
  - the route's `native` metadata blob from `ExtraStaticData` (presentation, tag —
    see "Route metadata"). This is what Swift actually acts on.
- **Rendering on command:** Swift calls into JS (a global installed by the package,
  e.g. `window.__kineticNative.render(...)`); the engine synthesizes an
  `EngineNavigateEvent`, the existing `ActualRouter` machinery renders (reusing
  `RenderedRouteCache` for back navigation), and the returned promise resolution is
  reported back as `renderCompleted`.
- External/off-sitemap URLs: `router.toLocator(url)` fails → forward to Swift as
  `externalUrl` (Swift opens `SFSafariViewController` or hands to the OS).

### Message protocol (JSON, versioned)

JS → Swift (`webkit.messageHandlers.kineticRouter.postMessage`):

| Message | Payload | Meaning |
|---|---|---|
| `ready` | `protocolVersion, bundleVersion, url` | Bridge handshake. |
| `visitProposed` | `url, state, action: push\|replace, routePattern, native?: { presentation?, tag?, ... }` | User tapped a link / `router.navigate` called. Swift decides what happens. |
| `renderCompleted` | `entryId, title` | Requested render finished; safe to reveal webview. |
| `renderFailed` | `entryId, error` | Render threw; Swift shows error UI / aborts push. |
| `titleChanged` | `entryId, title` | Leaf page title changed reactively (drives nav bar). |
| `stateUpdated` | `entryId, state` | `updateCurrentEntry` (e.g. scroll snapshot). Swift persists it per entry. |
| `externalUrl` | `url` | URL outside the sitemap. |

Swift → JS (`evaluateJavaScript` on `window.__kineticNative`):

| Call | Meaning |
|---|---|
| `render(entryId, url, state)` | Render this entry now (new visit or restore). Webview is hidden behind a snapshot/placeholder while this runs. |
| `dispose(entryId)` | Entry left the native stack permanently; router evicts its `RenderedRouteCache` slot. |
| `setStack(entries)` | Cold start / deep link: full stack description, render the leaf. |

Design point: JS never assumes a proposal is accepted. Swift may ignore `visitProposed`
(route claimed by a native screen), turn a push into a modal, or coalesce double-taps.

---

## Part 2 — Swift package: `KineticRouterNative` (SPM)

SwiftUI-consumable, UIKit-powered where it matters. SwiftUI's `NavigationStack` doesn't
expose enough transition/gesture control for the snapshot handoff, so the stack itself
is a `UINavigationController` wrapped for SwiftUI — same call Hotwire Native made.

### Components

- **`KineticSession`** — the heart. Owns:
  - the single shared `WKWebView` (configured with the message handler, UA suffix,
    `allowsBackForwardNavigationGestures = false` — gestures are ours);
  - the `Bridge` (`WKScriptMessageHandlerWithReply`, `Codable` message types);
  - the entry table: `entryId → (url, state, title, snapshot)`.
- **`VisitableViewController`** — one per entry. Contains a snapshot image view and a
  slot for the webview. Exposes `showSnapshot()` / `showWebView(_:)`. Reports
  `viewWillAppear`/pop events back to the session.
- **`KineticNavigationController`** — `UINavigationController` subclass +
  `UINavigationControllerDelegate` implementing the choreography below; keeps the
  default interactive pop gesture.
- **`KineticNavigationView`** — `UIViewControllerRepresentable` so the whole stack drops
  into a SwiftUI app (tab bars, sheets, etc. remain plain SwiftUI).
- **`RouteConfiguration`** — optional app-supplied overrides keyed on the `native.tag`
  a route declared in JS: `tag → native(ViewControllerFactory) | webPush | webModal`.
  No URL matching in Swift — route identity stays in JS. Phase-1 apps supply nothing
  (every proposal follows its JS-provided `presentation`, defaulting to push).

### Choreography

**Push (link tapped):**

1. JS intercepts click → `visitProposed`.
2. Swift snapshots the webview (`takeSnapshot`), lays the image over the webview in the
   *current* `VisitableViewController` (it now looks identical but is frozen).
3. Swift mints `entryId`, creates the new `VisitableViewController` (showing a
   placeholder matching the page background), moves the webview into it, and calls
   `render(entryId, url, state)`.
4. Push with the standard animation immediately — client-side renders are typically
   sub-frame, so `renderCompleted` usually arrives before the animation's first frame;
   the placeholder is removed on `renderCompleted`. If the render is slow (lazy route
   chunk), the user sees a native push onto a loading state — still native-feeling.
5. On `renderFailed`, pop back without animation and surface the error.

**Pop (back button or edge swipe):**

1. Fully native, zero JS involvement at gesture time: the previous
   `VisitableViewController` still holds its snapshot, so the swipe reveals real pixels
   instantly and cancellation costs nothing.
2. When the pop *commits* (`navigationController(_:didShow:)`), Swift calls
   `render(previousEntryId, ...)` — a cache hit in `RenderedRouteCache`, so effectively
   instant — then moves the webview under the snapshot and removes the snapshot.
3. `dispose(poppedEntryId)` frees the JS-side cache; Swift drops the popped entry and
   its snapshot.
4. Known tradeoff (shared with Hotwire): the snapshot can be momentarily stale if page
   content changed while the user was away. The cache-hit restore makes the window tiny.

**Replace:** `visitProposed(action: replace)` → snapshot, `render` new entry into the
same view controller, swap on `renderCompleted`, dispose old entry.

**Modal:** `native.presentation: "modal"` → present a second, lightweight nav controller
hosting the webview; on dismiss, restore the webview to the stack top (which kept its
snapshot). Sheets are where SwiftUI presentation composes nicely.

**Cold start / deep links (universal links):** app resolves the URL to a stack (often
`[root, leaf]`), pushes snapshot-less `VisitableViewController`s without animation, and
sends `setStack`. Intermediate entries get snapshots lazily, the first time they’re
navigated away from.

**Webview process death:** handle `webViewWebContentProcessDidTerminate`: reload the
bundle, replay handshake + `setStack` from Swift's entry table (Swift owning the stack
pays off here — full recovery without JS state).

### Route metadata — reusing existing seams

- **Presentation hints & tags live in JS** and are *pushed* to Swift per proposal —
  Swift holds no route table. `Router<ExtraStaticData, ExtraOutput>` already threads
  per-route static data; define
  `type NativeStaticData = { native?: { presentation?: "push" | "modal", tag?: string } }`.
  Static data is eager even for `implementLazy` routes, so the engine can resolve it
  synchronously at proposal time, before any chunk loads. Browsers ignore it. `tag` is
  an opaque app-chosen string for the rare case where Swift needs to special-case a
  route (native screen override) — this replaces URL-pattern matching entirely.
- **Nav bar title:** `Page.render` output already includes `title`; the effect that sets
  `document.title` today additionally emits `titleChanged` in native mode.
- **Nav bar buttons / toolbar (later):** same trick via `ExtraOutput`.

### Scroll restoration

Native pop shows the snapshot first, so there is no visible jump — but the live webview
must match before the swap. Store `scrollTop` per frame in the existing
`AppState.snapShotByKey` on navigate-away; `render(entryId, …, state)` restores it
before `renderCompleted`. This also fixes scroll restoration for the browser engine —
another shared win.

---

## Edge cases to design for

- Double-tap on a link / tap during transition → Swift coalesces proposals while a
  visit is in flight.
- Nested frames navigating (only leaf-level route changes should propose native pushes;
  `calculateRouteChanges` in `solid/src/diff.ts` already computes this — a `set-params`
  or nested-only change can be rendered in place with **no** native transition).
- `<a target="_blank">`, downloads, `mailto:` → never intercepted; `externalUrl` path.
- Rubber-band scrolling, safe-area insets (`viewport-fit=cover` +
  `env(safe-area-inset-*)` guidance in docs), text selection/callout tuning.
- Dark mode: page background must match the placeholder color to avoid flashes.
- Memory: snapshots are the main cost; downscale them and cap the count (evict from the
  middle of deep stacks, re-render on demand).

## Risks (honest list)

1. **Handoff flashes** — the moments where snapshot ↔ live webview swap are where all
   the perceived quality lives. Budget real polish time; test on slow devices.
2. **Single webview = single JS context** — a strength for state, but it means only one
   screen is ever "live". Fine for push navigation; becomes a real constraint for tabs
   (below).
3. **Refactor risk in `ActualRouter`** — mitigated by `MemoryEngine`-based tests landing
   in the same phase, and by keeping `NavigationApiEngine` a pure code move.
4. **evaluateJavaScript latency** — bridge round-trips are ~1ms but asynchronous; the
   choreography above never blocks a gesture on the bridge, keep it that way.

## Later phases (explicitly out of scope for v1)

- **Tabs:** one `KineticSession` (own webview + JS context) per tab, Hotwire-style.
  Cross-tab JS state is *not* shared then — document this loudly, or explore a
  shared-worker-style pattern later.
- **Native screens mixed into the stack** via `RouteConfiguration` tag overrides.
- **Android shell** reusing `@kinetic-router/native-bridge` verbatim (protocol is
  platform-neutral by construction).
- Pull-to-refresh, per-route nav bar buttons, form-sheet sizes.

---

## Milestones

1. ✅ **Engine extraction** (`@kinetic-router/solid`) — *done, 2026-07-24.*
   `NavigationEngine` interface, `NavigationApiEngine` (pure move), `MemoryEngine` +
   first solid-package tests. See status below.
2. ✅ **`@kinetic-router/native-bridge`**: detection, handshake, protocol types,
   `NativeBridgeEngine`, click interception. Testable headlessly with a mock bridge.
3. ✅ **`KineticRouterNative` (SPM)** — *initial scaffolding, 2026-07-24.* `KineticSession`,
    bridge, `VisitableViewController`, push/pop choreography with snapshots. Demo app
    in the repo (`example-ios/`) wrapping the existing `example-app` is the next step.
4. **Polish**: scroll restoration, titles, replace/modal, deep links, process-death
   recovery, snapshot memory cap, dark-mode flash hunting.
5. **Docs**: "your app just works" guide + shell setup guide.

## Status (updated 2026-07-24)

**Milestone 1 shipped.** What landed in `@kinetic-router/solid`:

- `src/navigation-engine.ts` — `NavigationEngine` interface + shared types
  (`EntrySource`, `NavigationIntent`, `EngineNavigateEvent`, `NavigationInfo`,
  `EngineHandlers`, `EngineNavigationResult`).
- `src/navigation-api-engine.ts` — the `window.navigation` code moved out of
  `ActualRouter`, still the default engine.
- `src/memory-engine.ts` — in-memory stack with `back()`/`forward()`/`traverse()`/
  `entries()`; the reference implementation of engine semantics (entries dispose only
  after the triggering navigation finished rendering).
- `ActualRouter` takes an engine in its constructor; the navigate-event interception
  became the engine-agnostic `handleNavigateEvent`. `Router` accepts
  `new Router(sitemap, { engine })`, defaulting to `NavigationApiEngine`.
- Tests: `src/memory-engine.test.ts` (engine unit tests) and `src/router.test.ts`
  (end-to-end on MemoryEngine + happy-dom: init, push/replace, set-params reuse,
  forceNewInstance, back/forward cache restoration, pruned-entry disposal).

Two deliberate behavior fixes made along the way (both latent bugs, also in browsers):

1. **Init ordering**: init used to render *then* replace-navigate; the replace mints a
   new entry id, orphaning the initial render in `RenderedRouteCache` (full re-render
   on first navigation). Init now commits the replace first and renders under the
   final entry id.
2. **`document.title` was never set**: the leaf-route check in `renderNavigation` read
   the loop variable inside an async callback after the loop had finished. Now captured
   per iteration.


**Milestone 2 shipped.** `@kinetic-router/native-bridge`:
- `src/protocol.ts` — `PROTOCOL_VERSION = 1`, all JS↔Swift message types, `SetStackEntry`,
  `NativeStaticData`, `NativePresentation`.
- `src/native-bridge-engine.ts` — full `NavigationEngine` implementation: sends `ready`
  on `attach()`, exposes `window.__kineticNative` (render/dispose/setStack), click
  interception (capture phase, respects modifiers/target/download), `resolveRouteInfo()`
  for slug pattern + native metadata extraction, `ignore` navigations handled locally.
- `src/native-bridge-engine.test.ts` — 24 tests (mock bridge + happy-dom): ready
  handshake, navigate→visitProposed→render cycle, renderCompleted/renderFailed,
  ignore navigations, replace→dispose, standalone traverse renders, dispose, setStack,
  currentEntry/updateCurrentEntry tracking, click interception (same-origin, external,
  modifiers, target=_blank, download, nested elements), routePattern inclusion.

**Milestone 3 initial scaffolding shipped.** `KineticRouterNative` SPM package at `ios/`:
- `Package.swift` — iOS 26, Swift 6.2.
- `Messages.swift` — `Codable` JS↔Swift message types, `SendableJSON` tunnel for state,
  `decodeJsMessage()` discriminated union parser.
- `KineticError.swift` — `unrecognizedMessage`, `protocolMismatch`, errors.
- `KineticSessionDelegate.swift` — delegate protocol + default `openExternalUrl` via
  `SFSafariViewController`.
- `Bridge.swift` — `WKScriptMessageHandler` registered as `kineticRouter`, async
  `render`/`dispose`/`setStack` via `evaluateJavaScript`.
- `EntryStore.swift` — `entryId → (url, state, title, snapshot)` lookup with
  append/removeLast/replace/removeAllAfter.
- `KineticSession.swift` — owns `WKWebView` (UA suffix, `allowsBackForwardNavigationGestures`
  disabled), `Bridge`, `EntryStore`, `RouteConfiguration`. Handles `ready` (protocol version
  check), `visitProposed` (push/modal/native dispatch per tag), `renderCompleted`,
  `renderFailed`, `titleChanged`, `stateUpdated`, `externalUrl`. Snapshot→push choreography.
  `WKNavigationDelegate` (process-death hook). `restoreStack()` for cold start/deep links.
- `VisitableViewController.swift` — per-entry VC: snapshot `UIImageView`, placeholder view,
  `showWebView(_:)` to move the live webview.
- `KineticNavigationController.swift` — `UINavigationController` subclass implementing
  `KineticSessionDelegate` + `UINavigationControllerDelegate`. Push choreography: placeholder
  → push animated → render → reveal on `renderCompleted`. Pop choreography: `didShow` detects
  stack decrease → disposes popped entries → moves webview + renders revealed entry (cache hit).
- `KineticNavigationView.swift` — `UIViewControllerRepresentable` for SwiftUI integration.
- `RouteConfiguration.swift` — tag-based `RouteBehaviour` lookup (`.webPush`/`.webModal`/
  `.native(factory:)`).
- Tests: `KineticRouterNativeTests.swift` — `EntryStore` (append, removeLast, replace,
  removeAllAfter, bounds), `Messages` (decode ready/visitProposed/unrecognized), `KineticEntry`
  properties. Requires Xcode/macOS to compile.

**Next up: Milestone 4** — Polish: scroll restoration, replace action, modal push,
  deep-link animation, process-death recovery replay, snapshot memory cap.

### Polish Recommendations (Milestone 4 Details)

1. **Avoid Handoff Flashes during Push/Modal transitions (Applied):** Before moving the live `WKWebView` into the new view controller, freeze the current view controller's visual state by showing its captured snapshot (using `lastVC.show(snapshot:)`). This ensures the transition from old VC to new VC doesn't reveal a blank background.
2. **Robust JSON Script Encoding (Applied):** Use `JSONEncoder` to properly serialize individual string arguments (like `url` and `entryId`) when evaluating JavaScript, eliminating any vulnerability or script execution failures due to unescaped query parameter characters or quote variations.
3. **Handle Webview Process-Death Recovery Replay:** In `webViewWebContentProcessDidTerminate`, reset `isReady = false` and reload the bundle. When the handshake returns, check if `entryStore.entries` is non-empty. If so, reconstruct and replay the entire navigation history stack to JS using `bridge.setStack(...)` to preserve the user's stack seamlessly across crashes.
4. **Avoid userContentController Retain Cycles:** Add a `deinit` block to `KineticSession` to cleanly call `webView.configuration.userContentController.removeScriptMessageHandler(forName: "kineticRouter")`. This breaks potential memory leaks where WebKit retains the session message handler indefinitely.
5. **Layout & Scaling on Snapshots:** Use `.scaleToFill` or `.scaleAspectFill` instead of `.scaleAspectFit` for the snapshot image view, as the snapshot represents a pixel-to-pixel identical representation of the webview and shouldn't have any letterbox bars.
6. **Complete Support for Native View Controllers:** Implement full integration for pushing native view controllers from the router stack via the `UINavigationController` push methods.

## Open questions

- Where do native hints live long-term — `ExtraStaticData` (per implementation, chosen
  for v1) or the sitemap DSL (per route definition)? Sitemap-level is more discoverable
  but extends `@kinetic-router/definition`.
- Remote bundle delivery details: caching/offline behavior, rollback, forced-upgrade UX
  when the installed shell is too old for every available bundle. Revisit before launch.
