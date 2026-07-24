import { RootSitemap, slugLookup, slugPathToString } from "@kinetic-router/definition/root.js";
import { Route } from "@kinetic-router/definition/routes.js";
import { urlToLocator } from "@kinetic-router/url";
import {
  NavigationEngine,
  NavigationIntent,
  EngineNavigationResult,
  EntrySource,
  EngineHandlers,
  NavigationInfo,
  EngineNavigateEvent,
} from "@kinetic-router/solid/navigation-engine.js";
import {
  PROTOCOL_VERSION,
  JsToSwiftMessage,
  SetStackEntry,
  NativeStaticData,
} from "./protocol.js";

declare global {
  interface Window {
    __kineticNative?: Record<string, (...args: any[]) => void>;
  }
}

/** Abstracts the native shell's message channel so tests can supply a mock. */
export interface NativeBridge {
  postMessage(message: JsToSwiftMessage): void;
}

type Deferred<T> = {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

/** Creates a promise whose resolution is controlled externally — used to bridge
 *  the gap between a `navigate()` call and Swift's later `render()` callback. */
function deferred<T>(): Deferred<T> & { promise: Promise<T> } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type PendingNavigate = {
  committed: Deferred<{ id: string; url?: string | null }>;
  finished: Deferred<unknown>;
  action: 'push' | 'replace';
  fromId: string | undefined;
  info: NavigationInfo;
};

export type NativeBridgeEngineOptions = {
  sitemap: RootSitemap;

  bridge: NativeBridge;

  /**
   * Resolve a Route to its native metadata (presentation hint, tag).
   * Called synchronously at proposal time so no chunk needs to load first.
   * If not provided, `visitProposed` messages omit the `native` field.
   */
  getNativeMetadata?: (route: Route<any>) => NativeStaticData['native'] | undefined;
};

let nextLocalId = 0;

/** Ignores navigations produce a local id; real entry ids are assigned by Swift. */
function mintLocalId(): string {
  return `__native_local_${nextLocalId++}`;
}

/** Engine that delegates history ownership to a native shell (iOS/Android).
 *  JS proposes visits and renders on command; Swift owns the navigation stack. */
export class NativeBridgeEngine implements NavigationEngine {
  protected handlers: EngineHandlers | undefined;
  protected sitemap: RootSitemap;
  protected bridge: NativeBridge;
  protected getNativeMetadata: ((route: Route<any>) => NativeStaticData['native'] | undefined) | undefined;

  protected currentEntryData: { id: string; url: string; state: unknown } | undefined;
  protected pending: PendingNavigate | null = null;

  constructor(options: NativeBridgeEngineOptions) {
    this.sitemap = options.sitemap;
    this.bridge = options.bridge;
    this.getNativeMetadata = options.getNativeMetadata;
  }

  /** Sends the `ready` handshake, installs the link click interceptor, and
   *  exposes `window.__kineticNative` so Swift can call back into the engine. */
  attach(handlers: EngineHandlers): void {
    this.handlers = handlers;

    this.installClickInterceptor();
    this.installKineticNativeGlobal();
    this.sendReady();
  }

  currentEntry(): EntrySource | undefined {
    if (this.currentEntryData === undefined) return undefined;

    const entry = this.currentEntryData;
    return {
      id: entry.id,
      url: entry.url,
      getState: () => entry.state,
    };
  }

  /** Persists state locally and forwards it to Swift so the shell can restore
   *  it later (e.g. scroll positions are stashed in `AppState.snapShotByKey`). */
  updateCurrentEntry(state: unknown): void {
    if (this.currentEntryData === undefined) return;

    this.currentEntryData.state = state;
    this.bridge.postMessage({
      type: 'stateUpdated',
      entryId: this.currentEntryData.id,
      state,
    });
  }

  /** Sends a `visitProposed` message to Swift and returns pending promises.
   *  Swift owns the decision — the engine does not render anything on its own.
   *  Navigations flagged `ignore` are handled locally without touching Swift. */
  navigate(intent: NavigationIntent): EngineNavigationResult {

    if (intent.info?.ignore) {
      return this.navigateIgnored(intent);
    }

    const fromId = this.currentEntryData?.id;

    const committed = deferred<{ id: string; url?: string | null }>();
    const finished = deferred<unknown>();

    const routeInfo = this.resolveRouteInfo(intent.url);

    this.bridge.postMessage({
      type: 'visitProposed',
      url: intent.url,
      state: intent.state,
      action: intent.history,
      routePattern: routeInfo?.routePattern,
      native: routeInfo?.native,
    } satisfies JsToSwiftMessage);

    this.pending = {
      committed,
      finished,
      action: intent.history,
      fromId,
      info: intent.info ?? {},
    };

    return {
      committed: committed.promise,
      finished: finished.promise,
    };
  }

  // ── Swift → JS entry points ────────────────────────────────────────

  /** Called by Swift to trigger rendering. If a pending navigate exists,
   *  resolves its `committed`/`finished` promises; otherwise synthesizes a
   *  `traverse` event (pop, initial load, or deep-link leaf). */
  render(entryId: string, url: string, state: unknown): Promise<void> {
    const handlers = this.requireHandlers();
    const previousId = this.currentEntryData?.id;

    if (this.pending !== null) {
      const p = this.pending;
      this.pending = null;

      if (p.action === 'replace' && this.currentEntryData !== undefined) {
        handlers.handleDispose(this.currentEntryData.id);
      }

      this.currentEntryData = { id: entryId, url, state };

      p.committed.resolve({ id: entryId, url });

      const event: EngineNavigateEvent = {
        navigationType: p.action,
        fromId: p.fromId,
        committedId: entryId,
        destination: { id: entryId, url, getState: () => state },
        info: p.info,
      };

      return handlers.handleNavigate(event).then(
        () => {
          this.currentEntryData!.state = state;
          p.finished.resolve(undefined);
          this.bridge.postMessage({
            type: 'renderCompleted', entryId, title: document.title,
          });
        },
        (error) => {
          p.finished.reject(error);
          this.bridge.postMessage({
            type: 'renderFailed', entryId, error: String(error),
          });
          throw error;
        },
      );
    }

    // standalone render: pop, initial load, or deep-link leaf
    this.currentEntryData = { id: entryId, url, state };

    const event: EngineNavigateEvent = {
      navigationType: 'traverse',
      fromId: previousId,
      committedId: entryId,
      destination: { id: entryId, url, getState: () => state },
      info: {},
    };

    return handlers.handleNavigate(event).then(
      () => {
        this.bridge.postMessage({
          type: 'renderCompleted', entryId, title: document.title,
        });
      },
      (error) => {
        this.bridge.postMessage({
          type: 'renderFailed', entryId, error: String(error),
        });
        throw error;
      },
    );
  }

  /**
   * Called by Swift when an entry leaves the native stack permanently.
   */
  dispose(entryId: string): void {
    const handlers = this.requireHandlers();
    handlers.handleDispose(entryId);
  }

  /**
   * Called by Swift for cold start / deep links: full stack description.
   * The last entry is the leaf and gets rendered immediately.
   */
  setStack(entries: SetStackEntry[]): void {
    if (entries.length === 0) return;

    const leaf = entries[entries.length - 1];
    void this.render(leaf.entryId, leaf.url, leaf.state);
  }

  // ── Internal helpers ───────────────────────────────────────────────

  /** The router calls `navigate({ ignore: true })` during init to normalize
   *  the initial URL. We resolve locally — no round-trip to Swift. */
  protected navigateIgnored(intent: NavigationIntent): EngineNavigationResult {
    const id = mintLocalId();

    if (this.currentEntryData !== undefined) {
      this.requireHandlers().handleDispose(this.currentEntryData.id);
    }

    this.currentEntryData = { id, url: intent.url, state: intent.state };

    return {
      committed: Promise.resolve({ id }),
      finished: Promise.resolve(),
    };
  }

  /** Resolves a URL against the sitemap to extract the slug pattern and native
   *  metadata for `visitProposed` messages. Returns undefined for external URLs. */
  protected resolveRouteInfo(url: string): {
    routePattern?: string;
    native?: NativeStaticData['native'];
  } | undefined {

    let parsed: URL;
    try {
      parsed = new URL(url, location.origin);
    } catch {
      return undefined;
    }

    let locator;
    try {
      locator = urlToLocator(this.sitemap, parsed);
    } catch {
      return undefined;
    }

    const slugPath = this.sitemap[slugLookup].get(locator.route);
    const routePattern = slugPath ? slugPathToString(slugPath) : undefined;

    const native = this.getNativeMetadata?.(locator.route);

    return { routePattern, native };
  }

  protected sendReady(): void {
    this.bridge.postMessage({
      type: 'ready',
      protocolVersion: PROTOCOL_VERSION,
      url: location.href,
    } satisfies JsToSwiftMessage);
  }

  protected installKineticNativeGlobal(): void {
    window.__kineticNative = {
      render: (entryId: string, url: string, state: unknown) =>
        this.render(entryId, url, state),
      dispose: (entryId: string) =>
        this.dispose(entryId),
      setStack: (entries: SetStackEntry[]) =>
        this.setStack(entries),
    };
  }

  protected installClickInterceptor(): void {
    document.addEventListener('click', this.handleClick, { capture: true });
  }

  /** Captured on `document` in the capture phase so it fires before any
   *  element-level handler. Only intercepts same-origin `<a>` clicks (respects
   *  modifier keys, `target`, and `download`). Prevents default navigation and
   *  sends `visitProposed` or `externalUrl` to Swift instead. */
  protected handleClick = (event: MouseEvent): void => {
    const anchor = this.findAnchor(event.target as Element | null);
    if (anchor === null) return;

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey ||
      anchor.getAttribute('target') !== null ||
      anchor.hasAttribute('download') ||
      anchor.origin !== location.origin
    ) {
      return;
    }

    event.preventDefault();

    const routeInfo = this.resolveRouteInfo(anchor.href);

    if (routeInfo === undefined) {
      this.bridge.postMessage({ type: 'externalUrl', url: anchor.href });
      return;
    }

    const committed = deferred<{ id: string; url?: string | null }>();
    const finished = deferred<unknown>();

    this.bridge.postMessage({
      type: 'visitProposed',
      url: anchor.href,
      state: null,
      action: 'push',
      routePattern: routeInfo.routePattern,
      native: routeInfo.native,
    } satisfies JsToSwiftMessage);

    this.pending = {
      committed,
      finished,
      action: 'push',
      fromId: this.currentEntryData?.id,
      info: {},
    };
  };

  protected findAnchor(el: Element | null): HTMLAnchorElement | null {
    let current = el;
    while (current !== null) {
      if (current.tagName === 'A') return current as HTMLAnchorElement;
      current = current.parentElement;
    }
    return null;
  }

  protected requireHandlers(): EngineHandlers {
    if (this.handlers === undefined) {
      throw new Error('NativeBridgeEngine is not attached to a router yet');
    }
    return this.handlers;
  }
}
