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
  // mark rejections as handled: the caller of navigate() may legitimately
  // ignore the returned promises (fire-and-forget links)
  promise.catch(() => {});
  return { promise, resolve, reject };
}

type PendingNavigate = {
  proposalId: string;
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

  /**
   * URL of the initial entry. Defaults to `location.href`. Supply this when
   * the webview's own URL (the bundle URL) is not on the sitemap.
   */
  initialUrl?: string;
};

let nextLocalId = 0;

/** Local ids for entries created before Swift assigns real ids (the initial
 *  entry, and `ignore` navigations during router init). The shell adopts the
 *  initial id from the `ready` handshake, so both sides agree on it. */
function mintLocalId(): string {
  return `__native_local_${nextLocalId++}`;
}

let nextProposalId = 0;

function mintProposalId(): string {
  return `__proposal_${nextProposalId++}`;
}

/** Engine that delegates history ownership to a native shell (iOS/Android).
 *  JS proposes visits and renders on command; Swift owns the navigation stack. */
export class NativeBridgeEngine implements NavigationEngine {
  protected handlers: EngineHandlers | undefined;
  protected sitemap: RootSitemap;
  protected bridge: NativeBridge;
  protected getNativeMetadata: ((route: Route<any>) => NativeStaticData['native'] | undefined) | undefined;
  protected initialUrl: string | undefined;

  protected currentEntryData: { id: string; url: string; state: unknown } | undefined;
  protected pending: PendingNavigate | null = null;

  constructor(options: NativeBridgeEngineOptions) {
    this.sitemap = options.sitemap;
    this.bridge = options.bridge;
    this.getNativeMetadata = options.getNativeMetadata;
    this.initialUrl = options.initialUrl;
  }

  /** Establishes the initial entry (with a JS-minted id), sends the `ready`
   *  handshake carrying that id, installs the link click interceptor, and
   *  exposes `window.__kineticNative` so Swift can call back into the engine.
   *
   *  The initial entry exists *before* the handshake completes, so the
   *  router's init can proceed synchronously — the shell renders nothing;
   *  it merely adopts the id for its own entry table. */
  attach(handlers: EngineHandlers): void {
    this.handlers = handlers;

    this.currentEntryData = {
      id: mintLocalId(),
      url: this.initialUrl ?? location.href,
      state: undefined,
    };

    this.installClickInterceptor();
    this.installKineticNativeGlobal();
    this.sendReady();
  }

  currentEntry(): EntrySource | undefined {
    if (this.currentEntryData === undefined) return undefined;
    return this.toSource(this.currentEntryData);
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

  /** Mirrors leaf-page title changes to the shell (drives the nav bar). */
  titleChanged(title: string): void {
    if (this.currentEntryData === undefined) return;

    this.bridge.postMessage({
      type: 'titleChanged',
      entryId: this.currentEntryData.id,
      title,
    });
  }

  /** Sends a `visitProposed` message to Swift and returns pending promises.
   *  Swift owns the decision — the engine does not render anything on its own.
   *  Navigations flagged `ignore` are handled locally without touching Swift.
   *  Off-sitemap URLs are forwarded as `externalUrl` and rejected locally. */
  navigate(intent: NavigationIntent): EngineNavigationResult {
    if (intent.info?.ignore) {
      return this.navigateIgnored(intent);
    }

    const routeInfo = this.resolveRouteInfo(intent.url);
    if (routeInfo === undefined) {
      this.bridge.postMessage({ type: 'externalUrl', url: intent.url });
      const error = new Error(`URL is not on the sitemap, forwarded to the shell: ${intent.url}`);
      const committed = deferred<{ id: string; url?: string | null }>();
      const finished = deferred<unknown>();
      committed.reject(error);
      finished.reject(error);
      return { committed: committed.promise, finished: finished.promise };
    }

    return this.propose(intent.url, intent.state, intent.history, intent.info ?? {}, routeInfo);
  }

  // ── Swift → JS entry points ────────────────────────────────────────

  /** Called by Swift to trigger rendering. When `proposalId` matches the
   *  in-flight proposal, its `committed`/`finished` promises resolve with the
   *  Swift-assigned entry id; otherwise the render is standalone (pop, deep
   *  link, recovery) and any stale proposal is rejected as superseded. */
  render(entryId: string, url: string, state: unknown, proposalId?: string): Promise<void> {
    const handlers = this.requireHandlers();

    // Swift's JSON tunnel turns "no state" into null
    if (state === null) state = undefined;

    // pre-commit: the outgoing entry is still current, so the router can
    // persist scroll positions onto it (via updateCurrentEntry)
    handlers.handleBeforeCommit?.();

    const previousId = this.currentEntryData?.id;

    let pending: PendingNavigate | null = null;
    if (this.pending !== null) {
      if (proposalId !== undefined && proposalId === this.pending.proposalId) {
        pending = this.pending;
      } else {
        // the shell ignored or coalesced that proposal; drop it so it cannot
        // corrupt this (unrelated) navigation
        this.rejectPending(new Error('Visit proposal was not accepted by the shell'));
      }
      this.pending = null;
    }

    if (pending !== null) {
      const p = pending;

      // on replace, the old entry is disposed *after* rendering finished, so
      // rendered subtrees can be reused/migrated first (MemoryEngine semantics)
      const replacedId = p.action === 'replace' ? previousId : undefined;

      this.currentEntryData = { id: entryId, url, state };

      p.committed.resolve({ id: entryId, url });

      const event: EngineNavigateEvent = {
        navigationType: p.action,
        fromId: p.fromId,
        committedId: entryId,
        destination: this.toSource({ id: entryId, url, state }),
        info: p.info,
      };

      const disposeReplaced = () => {
        if (replacedId !== undefined) {
          this.handlers?.handleDispose(replacedId);
        }
      };

      return handlers.handleNavigate(event).then(
        () => {
          p.finished.resolve(undefined);
          this.bridge.postMessage({
            type: 'renderCompleted', entryId, title: document.title,
          });
          disposeReplaced();
        },
        (error) => {
          p.finished.reject(error);
          this.bridge.postMessage({
            type: 'renderFailed', entryId, error: String(error),
          });
          disposeReplaced();
          throw error;
        },
      );
    }

    // standalone render: pop, deep-link leaf, or process-death recovery
    this.currentEntryData = { id: entryId, url, state };

    const event: EngineNavigateEvent = {
      navigationType: 'traverse',
      fromId: previousId,
      committedId: entryId,
      destination: this.toSource({ id: entryId, url, state }),
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
   *  the initial URL. The entry is replaced *in place* (same id) so the id
   *  the shell adopted from the `ready` handshake stays valid; the shell is
   *  informed of the new URL/state via `stateUpdated`. */
  protected navigateIgnored(intent: NavigationIntent): EngineNavigationResult {
    if (this.currentEntryData === undefined) {
      this.currentEntryData = { id: mintLocalId(), url: intent.url, state: intent.state };
    } else {
      this.currentEntryData.url = intent.url;
      this.currentEntryData.state = intent.state;
    }

    this.bridge.postMessage({
      type: 'stateUpdated',
      entryId: this.currentEntryData.id,
      state: intent.state,
      url: intent.url,
    });

    return {
      committed: Promise.resolve({ id: this.currentEntryData.id, url: intent.url }),
      finished: Promise.resolve(),
    };
  }

  /** Sends `visitProposed` and registers the pending navigation. A proposal
   *  that is still unanswered gets superseded (rejected) first. */
  protected propose(
    url: string,
    state: unknown,
    action: 'push' | 'replace',
    info: NavigationInfo,
    routeInfo: { routePattern?: string; native?: NativeStaticData['native'] },
  ): EngineNavigationResult {
    this.rejectPending(new Error('Superseded by a newer visit proposal'));

    const proposalId = mintProposalId();
    const committed = deferred<{ id: string; url?: string | null }>();
    const finished = deferred<unknown>();

    this.bridge.postMessage({
      type: 'visitProposed',
      proposalId,
      url,
      state,
      action,
      routePattern: routeInfo.routePattern,
      native: routeInfo.native,
    } satisfies JsToSwiftMessage);

    this.pending = {
      proposalId,
      committed,
      finished,
      action,
      fromId: this.currentEntryData?.id,
      info,
    };

    return {
      committed: committed.promise,
      finished: finished.promise,
    };
  }

  protected rejectPending(reason: Error): void {
    if (this.pending === null) return;

    this.pending.committed.reject(reason);
    this.pending.finished.reject(reason);
    this.pending = null;
  }

  /** Uniform EntrySource shape: URLs arrive as path+search strings from the
   *  shell; parse them against the current origin so the router never has to
   *  guess whether a URL string is absolute. */
  protected toSource(entry: { id: string; url: string; state: unknown }): EntrySource {
    const parsed = new URL(entry.url, location.origin);
    return {
      id: entry.id,
      url: { pathname: parsed.pathname, search: parsed.search },
      getState: () => entry.state,
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

    if (parsed.origin !== location.origin) {
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
      url: this.currentEntryData!.url,
      initialEntryId: this.currentEntryData!.id,
    } satisfies JsToSwiftMessage);
  }

  protected installKineticNativeGlobal(): void {
    // Wrappers must not return the promises: WKWebView's evaluateJavaScript
    // fails with WKErrorJavaScriptResultTypeIsUnsupported when the script's
    // result is not serializable (a Promise). Completion is reported through
    // the renderCompleted/renderFailed messages instead.
    window.__kineticNative = {
      render: (entryId: string, url: string, state: unknown, proposalId?: string) => {
        void this.render(entryId, url, state, proposalId).catch(() => {
          // failure already reported via renderFailed
        });
      },
      dispose: (entryId: string) => {
        this.dispose(entryId);
      },
      setStack: (entries: SetStackEntry[]) => {
        this.setStack(entries);
      },
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

    const target = anchor.getAttribute('target');
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      (target !== null && target !== '' && target !== '_self') ||
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

    this.propose(anchor.href, undefined, 'push', {}, routeInfo);
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
