import { getSlugPath, RootSitemap, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, paramsByKey } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { locatorToUrl, urlToLocator } from "@kinetic-router/url";

import { Page, PageStatus } from "./page";
import { AppState, SerializedAppState } from "./app-state";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame";
import { createParamStorage, mapParamObjectToParamInitMap, ParamInit, ParamStorage, ReactiveValue } from "./params";
import { renderRoute, RenderedRoute } from "./rendered-route";
import { SolidImplementationMap } from "./implementation-map";
import { createEffect, runWithOwner } from "solid-js";
import { calculateRouteChanges, RouteChange } from "./diff";
import { RenderedRouteCache } from "./rendered-route-cache";
import { printNavigationState } from "./debug";



type NavigationInfo = {
  forceNewInstance?: boolean,
  ignore?: boolean
};


export class ActualRouter<
  ExtraStaticData extends object,
  ExtraOutput extends object,
> {
  readonly sitemap: RootSitemap;
  readonly implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>;

  // Simple cache for implementation, never cleaned (and no plans to do so)
  readonly implCache = new Map<Route<any>, Page<ExtraOutput, any, any>>();

  // Cache for rendered routes, may be cleaned in the future depending on disposed history
  // entries and max history depth.
  readonly rrCache = new RenderedRouteCache();

  // Cache for HistoryStates, just to avoid deserializing when possible.
  // Keys are given by either:
  //   - the UA as the `id` of a NavigationEntry
  //   - a temporary ID made by navigate calls we control that avoids serializing the AppState (should be very shortlived, .isTemporary())
  readonly stateCache = new Map<string, AppState>();

  // TODO use Backstage!

  // currentAppState: AppState | undefined;
  // currentAppStateId: string | undefined;
  currentRenderedRoutes: RenderedRoute[] = [];

  rootFrame!: FrameDelegate;

  constructor(sitemap: RootSitemap, implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>) {
    this.sitemap = sitemap;
    this.implMap = implMap;
  }

  async init() {
    //@ts-ignore
    window.__router = this;

    const rootFrameElement = document.getElementById(rootFrameId);
    if (rootFrameElement === null) {
      throw new Error('No root frame found');
    }

    this.rootFrame = (rootFrameElement as any)[frameDelegateAttribute];

    if (this.rootFrame === undefined) {
      throw new Error('No delegate on root frame found');
    }

    // setup after initial navigation stuff to avoid weird unwanted behaviour
    this.setupNavigationApi();

    const state = this.getState(window.navigation.currentEntry!)!;
    
    const newLocator: Locator<any> = {
      route: state.route, values: paramsByKey(state.paramSnapshot, state.route.paramDefs)
    };

    const newUrl = locatorToUrl(this.sitemap, newLocator);
    const serializedState = state.serialize(this.sitemap);

    await this.renderNavigation(state, undefined, {});
    if (window.navigation.currentEntry?.url !== newUrl) {
      const res = window.navigation.navigate(newUrl, {
        // set ignore=true to avoid weird behaviour not aligned with "first load"
        state: serializedState, history: 'replace', info: { ignore: true }
      });
      await res.committed;
    } else {
      window.navigation.updateCurrentEntry({ state: serializedState });
    }
  }

  navigate<ParamDefs extends AnyParamDefs>(
    locator: Locator<ParamDefs>,
    options?: { replace?: boolean } & NavigationInfo
  ) {
    if (locator.route instanceof Alias) {
      console.warn(`Shouldnt navigate to an Alias!`);
      locator = resolveAliases(locator);
    }

    const state = AppState.fromLocator(locator);
    // note that at this point, it is a temporary ID
    this.stateCache.set(state.id, state);

    console.debug('navigate to ', state);
    
    const url = locatorToUrl(this.sitemap, locator);
    const res = window.navigation.navigate(url, {
      state: state.serialize(this.sitemap),
      history: options?.replace ? 'replace' : 'push',
      info: { forceNewInstance: options?.forceNewInstance }
    });

    res.committed?.then(entry => {
      entry.addEventListener('dispose', () => {
        this.rrCache.unreference(entry.id);
      });
    });

    return res;
  }

  protected setupNavigationApi() {
    const router = this;

    window.navigation.addEventListener("navigate", (event) => {
      if (!event.canIntercept) {
        console.debug('Cannot intercept navigation', event);
        return;
      }

      if (event.navigationType === 'reload') {
        console.debug('Reloads not currently handled', event);
        return;
      }

      const info = (event.info ?? {}) as NavigationInfo;
      if (info.ignore) {
        event.intercept();
        return;
      }

      printNavigationState();

      const currentId = window.navigation.currentEntry!.id;

      event.intercept({
        handler() {
          // could be an existing state! (note: event)
          // major WTF: event.destination is different before the handler!
          const newState = router.getState(event.destination)!;
          console.debug(`Intercepting ${event.navigationType} navigation `, event);

          if (event.navigationType === 'traverse') {
            return router.renderNavigation(newState, newState.id, info);
          } else {
            // TODO handle 'replace' better if needed?
            const newId = window.navigation.currentEntry!.id;
            if (newState?.isTemporary()) {
              router.stateCache.delete(newState.id);
            }
            newState.id = newId;
            return router.renderNavigation(newState, currentId, info);
          }
        },
      });
    });

    window.navigation.addEventListener('navigateerror', (event) => {
      console.error("NAVIGATION ERROR");
      console.error(event.error);
    })

    window.navigation.addEventListener('navigatesuccess', (event) => {
      //console.debug('navigate success...');
    });
  }

  /** Make an AppState based on the best source of information */
  protected getState(entry: {
    id?: string | null,
    getState?: () => unknown | undefined,
    url?: { pathname: string, search: string } | string | null
  }) {
    if (entry.id) {
      const state = this.stateCache.get(entry.id);
      if (state !== undefined) return state;
    }

    if (entry.getState !== undefined) {
      const rawState = entry.getState();
      if (rawState !== undefined) {
        return AppState.deserialize(this.sitemap, rawState as SerializedAppState)
      }
    }

    if (entry.url) {
      return AppState.fromLocator(
        urlToLocator(this.sitemap, typeof entry.url === 'string' ? new URL(entry.url) : entry.url),
        entry.id ?? undefined
      );
    }
  }

  protected async renderNavigation(
    newState: AppState,
    cacheId: string | undefined,
    navInfo: NavigationInfo & { forceNewInstance?: boolean }
  ) {
    const newRouteStack = [...newState.route.nestedInRoutes, newState.route];
    const staticImpl = this.implMap.getStaticPartOfImplementation(newState.route); // sync!
    const untrackedParamDefs = new Set(staticImpl.untrackedKeys.map(k => newState.route.paramDefs[k]));

    const potentialReusedRoutes: RenderedRoute[] = [];
    if (cacheId !== undefined) {
      for (const route of newRouteStack) {
        const rendered = this.rrCache.getEntry(cacheId, route)?.rendered;

        if (rendered === undefined) {
          break;
        } else {
          potentialReusedRoutes.push(rendered);
        }
      }
    }

    // compare current state with new requested state
    const routeChanges = calculateRouteChanges(
      untrackedParamDefs,
      potentialReusedRoutes,
      { routes: newRouteStack, state: newState }
    );

    if (navInfo.forceNewInstance) {
      routeChanges[routeChanges.length-1] = 'render';
    }

    console.debug(`renderNavigation ${cacheId} > ${newState.id}: ${routeChanges.join(' | ')}`);
    console.debug(`  -> pot. reuse:`, potentialReusedRoutes);

    let i=0;
    let frame: FrameDelegate | undefined = this.rootFrame;

    // Loop through routechanges with simple parameter changes
    for (; i<routeChanges.length; i++) {
      const routeChange = routeChanges[i];

      if (routeChange === 'render') {
        break;
      } else {
        const reuseRoute = potentialReusedRoutes[i]!;

        if (routeChange === 'set-params') {
          // TODO check if rest of code uses ownedValues correctly? (i.e. we're not updating needlessly here)
          const paramValues = reuseRoute.renderArgs.params.ownedValues;
          for (const [pd, value] of paramValues.entries()) {
            // TODO should these be memos? if so, can we simplify the rest of the code?
            // should be reactive!
            (value as ReactiveValue<any>).write(newState.paramSnapshot.get(pd)!);
          }
        }

        this.assertFrame(frame, reuseRoute.route);
        // even if nothing changes, still have to adjust frames!
        frame.setElement(reuseRoute.renderOutput!.html);

        frame = reuseRoute.subFrame;
      }
    }

    let parentParamStorage: Promise<ParamStorage> | undefined = undefined;
    let framePromise = Promise.resolve(frame);
    this.currentRenderedRoutes = potentialReusedRoutes.slice(0, i);

    for (; i<routeChanges.length; i++) {
      const route = newRouteStack[i];
      // assume all changes are 'render' from here on out
      const implementationPromise = (
        this.implCache.get(route) ?? this.implMap.loadImplementation(route).then((impl) => {
          this.implCache.set(route, impl);
          return impl;
        })
      );

      const paramStorage: Promise<ParamStorage> = Promise.all([implementationPromise, parentParamStorage]).then(
        ([implementation, parent]) => createParamStorage({route, implementation, paramMap: newState.paramSnapshot, parent})
      );

      parentParamStorage = paramStorage;
      
      const renderPromise = Promise.all([implementationPromise, parentParamStorage]).then(
        ([implementation, params]) => renderRoute({
          renderArgs: { params, pageStatus: this.createPageStatus() },
          implementation,
          route,
        })
      );

      framePromise = Promise.all([renderPromise, framePromise]).then(([rendered, frame]) => {
        this.assertFrame(frame, route);

        if (i === routeChanges.length-1) {
          // TODO gate this behind some check if this route is active and most-specific (via PageStatus?)
          runWithOwner(rendered.owner, () => createEffect(
            () => rendered.renderOutput!.title,
            (title) => { document.title = title }
          ));
        }

        // push should be safe as these run in order thanks to framePromise
        this.currentRenderedRoutes.push(rendered);
        frame.setElement(rendered.renderOutput!.html);
        return rendered.subFrame;
      });
    }

    this.stateCache.set(newState.id, newState);
    // await final promise that ties all the others together (they form a DAG normally)
    await framePromise;

    this.rrCache.markUsedFor(newState.id, this.currentRenderedRoutes);
  }

  protected assertFrame(frame: FrameDelegate | undefined, route: Route<any>): asserts frame is FrameDelegate {
    if (frame === undefined) {
      const slugPath = getSlugPath(this.sitemap, route)!;
      const slugPathStr = slugPathToString(slugPath);
      throw new Error(`Cant render ${slugPathStr}: no frame!`);
    }
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
}
