import { RootSitemap } from "@kinetic-router/definition/root.js";
import { SolidImplementationMap } from "./implementation-map.js";
import { ActualRouter, type DestinationSnapshot, type NavigateOptions, type NavigationMode } from "./actual-router.js";
import { locatorToUrl, urlToLocator } from "@kinetic-router/url";
import { Locator, resolveAliases } from "@kinetic-router/definition/routes.js";
import type { AnyParamDefs } from "@kinetic-router/definition/params.js";
import { Accessor, createSignal, getOwner, onCleanup, Setter } from "solid-js";
import { NavigationEngine } from "./navigation-engine.js";
import { NavigationApiEngine } from "./navigation-api-engine.js";
import { RenderedRouteCache } from "./rendered-route-cache.js";
import { PreparationRegistry, type PrefetchCacheOptions } from './preparation-registry.js';
import { registerLink, type Prefetch } from './link.js';

export type { DestinationSnapshot, NavigateOptions, NavigationMode } from './actual-router.js';
export type { PrefetchCacheOptions } from './preparation-registry.js';
export type { LinkMode, LinkProps, Prefetch, PrefetchOptions } from './link.js';

/** Public facade for typed implementations, navigation, and Link defaults.
 * Create the Router before Links and register implementations synchronously;
 * initialization starts in a microtask. Only one Router may be active:
 * dispose the previous Router before constructing a replacement. */

export class Router<
  // Static data about a page, should also be defined upfront for lazy routes
  // example: { 'viewAs': 'mainpage' | 'detail' | 'fullscreen' }
  ExtraStaticData extends object = {},

  // Output (besides html and title) that each page is supposed to give
  // example: opengraph attributes
  ExtraOutput extends object = {},
> {
  /** Cancels work, disposes pages, detaches the engine, and releases registration.
   * Automatic under a Solid owner. For module-level Routers, call on teardown,
   * including HMR (e.g. import.meta.hot?.dispose(router.dispose) in Vite). */
  readonly dispose: () => void;
  implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>;
  sitemap: RootSitemap;
  protected actualRouter: ActualRouter<ExtraStaticData, ExtraOutput> | undefined;
  protected didInit: Accessor<boolean>;
  protected setDidInit: Setter<boolean>;
  protected disposed = false;

  constructor(sitemap: RootSitemap, options?: {
    /** The history layer to use. Defaults to the browser's Navigation API.
     * Tests can use MemoryEngine; other integrations can supply their own. */
    engine?: NavigationEngine,
    /** Maximum history-cached pages and retained entry stacks (default 10).
     * Nested ancestors count; shared instances count once. The visible stack is
     * always kept, even above this limit. Zero keeps only the visible stack.
     * Speculative output and construction-only pins have a separate budget.
     * Must be a non-negative safe integer. Eviction preserves browser history
     * and saved parameters/scroll positions, but re-rendering resets local DOM state. */
    maxCachedPages?: number,
    /** Completed, unused speculative preparations only (defaults: 3 / 30s).
     * Either zero disables retention; independent of maxCachedPages. */
    prefetchCache?: PrefetchCacheOptions,
    /** Speculative loading is disabled unless enabled here or on a Link. */
    prefetch?: Prefetch,
  }) {
    const rrCache = new RenderedRouteCache(options?.maxCachedPages);
    const preparations = new PreparationRegistry(options?.prefetchCache);
    this.sitemap = sitemap;
    this.implMap = new SolidImplementationMap(this.sitemap);

    this.implement = this.implMap.implement.bind(this.implMap);
    this.implementLazy = this.implMap.implementLazy.bind(this.implMap);

    [this.didInit, this.setDidInit] = createSignal(false);
    const unregisterLink = registerLink(this, options?.prefetch, () => this.didInit() && !this.disposed);
    this.dispose = () => {
      if (this.disposed) return;
      this.disposed = true;
      this.setDidInit(false);
      try {
        if (this.actualRouter) this.actualRouter.dispose();
        else { preparations.dispose(); rrCache.dispose(); }
      } finally { unregisterLink(); }
    };
    if (getOwner()) onCleanup(this.dispose);

    queueMicrotask(async () => {
      if (this.disposed) return;
      try {
        this.implMap.check();
        const engine = options?.engine ?? new NavigationApiEngine();
        const router = new ActualRouter(this.sitemap, this.implMap, engine, rrCache, preparations);
        this.actualRouter = router;
        const initialization = router.init();
        // The engine is attached; navigation need not wait for the first page's
        // arbitrary async factory. currentLocator stays undefined until activation.
        this.setDidInit(true);
        await initialization;
      } catch (error) {
        if (this.disposed) return;
        this.dispose();
        throw error;
      }
    });
  }

  implement: typeof this.implMap.implement;
  implementLazy: typeof this.implMap.implementLazy;

  navigate<ParamDefs extends AnyParamDefs>(locator: Locator<ParamDefs>, options?: NavigateOptions) {
    if (this.disposed || !this.didInit()) throw new Error('Router is not active');

    return this.actualRouter!.navigate(locator, options);
  }

  resolveDestination<ParamDefs extends AnyParamDefs>(target: Locator<ParamDefs>, mode: NavigationMode = 'push'): DestinationSnapshot {
    if (!this.disposed && this.didInit()) return this.actualRouter!.resolveDestination(target, mode);
    // Before the engine attaches there are no bookmarks to resume, but anchors
    // still need a useful URL. No preparation or activation uses this fallback.
    const locator = resolveAliases(target);
    return { target, mode, locator, url: this.toUrl(locator), operation: { type: mode === 'replace' ? 'replace' : 'push' } };
  }

  /** @internal Links own interests; the Router owns their shared construction. */
  acquirePreparation(snapshot: DestinationSnapshot) {
    if (!this.disposed) return this.actualRouter?.acquirePreparation(snapshot);
  }

  activateDestination(snapshot: DestinationSnapshot, info?: Omit<NavigateOptions, 'mode'>) {
    if (this.disposed || !this.didInit()) throw new Error('Router is not active');
    return this.actualRouter!.activateDestination(snapshot, info);
  }

  toUrl(locator: Locator<any>) {
    // Also usable before asynchronous init (e.g. for an initial anchor href).
    return locatorToUrl(this.sitemap, locator);
  }

  toLocator(url: URL) {
    return urlToLocator(this.sitemap, url);
  }

  currentLocator() {
    if (!this.disposed && this.didInit()) {
      return this.actualRouter!.currentLocator();
    } else {
      return undefined;
    }
  }
}
