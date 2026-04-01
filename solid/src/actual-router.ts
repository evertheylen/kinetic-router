import { getSlugPath, RootSitemap, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, ParamMap } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { urlToLocator } from "@kinetic-router/url";

import { Page, PageStatus, StaticPage } from "./page";
import { AppState } from "./app-state";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame";
import { createParamStorage, mapParamObjectToParamInitMap, ParamInit, ParamStorage } from "./params";
import { renderRoute, RenderedRoute } from "./rendered-route";
import { SolidImplementationMap } from "./implementation-map";
import { StateTransition, transition } from "./state-transition";
import { createEffect, runWithOwner } from "solid-js";


type RenderedRouteCache = {
  /** How many AppStates refer to it? */
  refCount: number,

  /** The actual rendered route */
  rendered: RenderedRoute,
};


type RequiredRouteChange = (
  | 'render'  // different route entirely OR same route but untracked params changed, so rerender (or explicitly asked in navigate call)
  | 'set-params'  // same route, can change without rerender
  | 'none'  // the routes are equal and so are the params
);


export class ActualRouter<
  ExtraStaticData extends object,
  ExtraOutput extends object,
> {
  readonly sitemap: RootSitemap;
  readonly implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>;
  readonly implCache = new Map<Route<any>, Page<ExtraOutput, any, any> & StaticPage<any> & ExtraStaticData>();
  readonly rrCache = new Map<string, Map<Route<any>, RenderedRouteCache>>();

  // TODO keep cache of RouteInstance!
  // TODO use Backstage!
  // TODO use AppState!

  /** AppState of which ALL RouteInstance's are rendered */
  loadedAppState: AppState | undefined;
  activeRenderedRoutes: RenderedRoute[] = [];
  /** AppState of which at least one RouteInstance has state Initial or ImplLoaded */
  //loadingAppState: AppState | undefined;

  rootFrame!: FrameDelegate;

  constructor(sitemap: RootSitemap, implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>) {
    this.sitemap = sitemap;
    this.implMap = implMap;
  }

  async init() {
    this.setupNavigationApi();

    const locator = urlToLocator(this.sitemap, window.location);
    // url may be later rewritten by navigate call as window.location may point to Alias

    const rootFrameElement = document.getElementById(rootFrameId);
    if (rootFrameElement === null) {
      throw new Error('No root frame found');
    }

    this.rootFrame = (rootFrameElement as any)[frameDelegateAttribute];

    if (this.rootFrame === undefined) {
      throw new Error('No delegate on root frame found');
    }

    await this.navigate(locator, { updateCurrent: true });
  }

  setupNavigationApi() {
    const router = this;
    window.navigation.addEventListener("navigate", (event) => {
      const url = new URL(event.destination.url);
      const locator = urlToLocator(this.sitemap, url);

      event.intercept({
        async handler() {
          console.debug('Intercepting navigation', {url, locator});
          await router.navigate(locator, {});
        },
      });
    });
  }

  createPageStatus(): PageStatus {
    // TODO implement PageStatus properly
    return {
      shouldFetch: () => true,
      isVisible: () => true,
      isAnimating: () => false,
      hasFocus: () => true
    };
  }

  /** Returns an array of required route changes of the same size as routes.new */
  protected requiredRouteChanges(
    routes: {old: Route<any>[], new: Route<any>[]},
    params: {old: ParamMap, new: ParamInit}
  ): RequiredRouteChange[] {
    return [...Array(routes.new.length-1).keys()].map(i => {
      if (routes.old[i] !== routes.new[i]) {
        // also covers when routes.old is shorter than routes.new
        return 'render'
      }

      const route = routes.new[i];

      for (const pd of Object.values(route.paramDefs as AnyParamDefs)) {
        if (params.old.get(pd) !== params.new.get(pd)) {
          return i
        }
      }
    });
  }

  async navigate<ParamDefs extends AnyParamDefs>(
    locator: Locator<ParamDefs>,
    options: { updateCurrent?: boolean, forceNewInstance?: boolean }
  ) {
    // TODO dont just ignore old RI's duuude
    // TODO respect options

    if (locator.route instanceof Alias) {
      console.warn(`Shouldnt navigate to an Alias!`);
      locator = resolveAliases(locator);
    }

    const routeStack = [...locator.route.nestedInRoutes, locator.route];

    const allParamInits = mapParamObjectToParamInitMap(
      locator.route.paramDefs,
      // yay it's synchronous!
      this.implMap.getStaticPartOfImplementation(locator.route).untrackedKeys,
      locator.values
    );

    // compare current state with new requested state


    let parentParamStorage: Promise<ParamStorage> | undefined = undefined;
    const renderingRoutes: { route: Route<any>, promise: Promise<RenderedRoute> }[] = [];

    for (const route of routeStack) {
      const implementationPromise = (
        this.implCache.get(route) ?? this.implMap.loadImplementation(route).then((impl) => {
          this.implCache.set(route, impl);
          return impl;
        })
      );

      const paramStorage: Promise<ParamStorage> = Promise.all([implementationPromise, parentParamStorage]).then(
        ([implementation, parent]) => createParamStorage({route, implementation, allParamInits, parent})
      );

      parentParamStorage = paramStorage;
      
      const promise = Promise.all([implementationPromise, parentParamStorage]).then(
        ([implementation, params]) => renderRoute({
          renderArgs: { params, pageStatus: this.createPageStatus() },
          implementation,
          route
        })
      );

      renderingRoutes.push({ route, promise });
    }

    await this.putElementsInDocument(renderingRoutes);

    window.navigation.updateCurrentEntry({
      state: locator.values,
    })
  }

  async putElementsInDocument(renderingRoutes: { route: Route<any>, promise: Promise<RenderedRoute> }[]) {
    let frame: FrameDelegate | undefined = this.rootFrame;

    const lastRendering = renderingRoutes[renderingRoutes.length-1];
    for (const rendering of renderingRoutes) {
      if (frame === undefined) {
        const slugPath = getSlugPath(this.sitemap, rendering.route)!;
        const slugPathStr = slugPathToString(slugPath);
        throw new Error(`Cant render ${slugPathStr}: no frame!`);
      }

      const rendered = await rendering.promise;

      frame.setElement(rendered.renderOutput!.html);
      frame = rendered.subFrame;

      if (rendering === lastRendering) {
        runWithOwner(rendered.owner, () => createEffect(
          () => rendered.renderOutput!.title,
          (title) => { document.title = title }
        ));
      }
    }
  }
}
