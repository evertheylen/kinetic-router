import { RootSitemap } from "@kinetic-router/definition/root.js";
import { SolidImplementationMap } from "./implementation-map.js";
import { ActualRouter, type DestinationSnapshot, type NavigateOptions, type NavigationMode } from "./actual-router.js";
import { locatorToUrl, urlToLocator } from "@kinetic-router/url";
import { Locator } from "@kinetic-router/definition";
import type { AnyParamDefs } from "@kinetic-router/definition/params.js";
import { Accessor, createSignal, Setter } from "solid-js";
import { NavigationEngine } from "./navigation-engine.js";
import { NavigationApiEngine } from "./navigation-api-engine.js";
import { RenderedRouteCache } from "./rendered-route-cache.js";

export type { DestinationSnapshot, NavigateOptions, NavigationMode } from './actual-router.js';

// This class just collects the most useful methods of the various objects
// and centralizes it into one type-safe object that delegates the calls to the 
// correct sub-object. Should never be used within the library, only for clients.

export class Router<
  // Static data about a page, should also be defined upfront for lazy routes
  // example: { 'viewAs': 'mainpage' | 'detail' | 'fullscreen' }
  ExtraStaticData extends object = {},

  // Output (besides html and title) that each page is supposed to give
  // example: opengraph attributes
  ExtraOutput extends object = {},
> {
  implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>;
  sitemap: RootSitemap;
  protected actualRouter: ActualRouter<ExtraStaticData, ExtraOutput> | undefined;
  protected didInit: Accessor<boolean>;
  protected setDidInit: Setter<boolean>;

  constructor(sitemap: RootSitemap, options?: {
    /** The history layer to use. Defaults to the browser's Navigation API.
     * Tests can use MemoryEngine; other integrations can supply their own. */
    engine?: NavigationEngine,
    /** Maximum live rendered pages and retained history-entry stacks (default 10).
     * Nested ancestors count; shared instances count once. The visible stack is
     * always kept, even above this limit. Zero keeps only the visible stack. */
    maxCachedPages?: number,
  }) {
    const rrCache = new RenderedRouteCache(options?.maxCachedPages);
    this.sitemap = sitemap;
    this.implMap = new SolidImplementationMap(this.sitemap);

    this.implement = this.implMap.implement.bind(this.implMap);
    this.implementLazy = this.implMap.implementLazy.bind(this.implMap);

    [this.didInit, this.setDidInit] = createSignal(false);

    queueMicrotask(async () => {
      this.implMap.check();
      const engine = options?.engine ?? new NavigationApiEngine();
      const router = new ActualRouter(this.sitemap, this.implMap, engine, rrCache);
      const initialization = router.init();
      // The engine is attached; navigation need not wait for the first page's
      // arbitrary async factory. currentLocator stays undefined until activation.
      this.actualRouter = router;
      this.setDidInit(true);
      await initialization;
    });
  }

  // page<Input extends object, UntrackedKeys extends keyof Input = any>(
  //   p: Page<ExtraOutput, Input, UntrackedKeys> & ExtraStaticData
  // ) {
  //   return p;
  // }

  implement: typeof this.implMap.implement;
  implementLazy: typeof this.implMap.implementLazy;

  navigate<ParamDefs extends AnyParamDefs>(locator: Locator<ParamDefs>, options?: NavigateOptions) {
    if (this.actualRouter === undefined) {
      throw new Error('Router didnt init yet')
    }

    return this.actualRouter.navigate(locator, options);
  }

  resolveDestination<ParamDefs extends AnyParamDefs>(locator: Locator<ParamDefs>, mode?: NavigationMode) {
    if (this.actualRouter === undefined) throw new Error('Router didnt init yet');
    return this.actualRouter.resolveDestination(locator, mode);
  }

  activateDestination(snapshot: DestinationSnapshot, info?: Omit<NavigateOptions, 'mode'>) {
    if (this.actualRouter === undefined) throw new Error('Router didnt init yet');
    return this.actualRouter.activateDestination(snapshot, info);
  }

  toUrl(locator: Locator<any>) {
    // Also usable before asynchronous init (e.g. for an initial anchor href).
    return locatorToUrl(this.sitemap, locator);
  }

  toLocator(url: URL) {
    return urlToLocator(this.sitemap, url);
  }

  currentLocator() {
    if (this.didInit()) {
      return this.actualRouter!.currentLocator();
    } else {
      return undefined;
    }
  }
}
