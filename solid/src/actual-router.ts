import { getSlugPath, RootSitemap, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, ParamDef, ParamMap, paramsByDefinition } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { locatorToUrl, urlToLocator } from "@kinetic-router/url";

import { Page, PageStatus, StaticPage } from "./page";
import { AppState, getRandomId, SerializedAppState } from "./app-state";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame";
import { createParamStorage, mapParamObjectToParamInitMap, ParamInit, ParamStorage, ReactiveValue } from "./params";
import { renderRoute, RenderedRoute } from "./rendered-route";
import { SolidImplementationMap } from "./implementation-map";
import { createEffect, runWithOwner } from "solid-js";
import { calculateRouteChanges, RouteChange } from "./diff";
import { RenderedRouteCache } from "./rendered-route-cache";



type NavigationInfo = {
  forceNewInstance?: boolean
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
  //   - a tempid-XYZ made by navigate calls we control that avoids serializing the AppState (should be very shortlived, has temporaryId)
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

    this.setupNavigationApi();

    const rootFrameElement = document.getElementById(rootFrameId);
    if (rootFrameElement === null) {
      throw new Error('No root frame found');
    }

    this.rootFrame = (rootFrameElement as any)[frameDelegateAttribute];

    if (this.rootFrame === undefined) {
      throw new Error('No delegate on root frame found');
    }

    const state = this.getState({
      id: window.navigation.currentEntry?.id, 
      rawState: window.navigation.currentEntry?.getState() as any,
      url: window.location
    })!;
    
    // url may be later rewritten by navigate call as window.location may point to Alias
    await this.renderNavigation(state, { replace: true });
    window.navigation.updateCurrentEntry({ state: state.serialize(this.sitemap) });
    this.commitNavigationEntry(window.navigation.currentEntry!, state);
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
    state.temporaryId = `tempid-${Math.random().toString(16).slice(2)}`;
    this.stateCache.set(state.temporaryId, state);

    console.debug('navigate to ', state);
    
    const url = locatorToUrl(this.sitemap, locator);
    const res = window.navigation.navigate(url, {
      state: state.serialize(this.sitemap),
      history: options?.replace ? 'replace' : 'push',
      info: { forceNewInstance: options?.forceNewInstance }
    });

    res.committed?.then(entry => this.commitNavigationEntry(entry, state));

    return res;
  }

  protected commitNavigationEntry(entry: NavigationHistoryEntry, state: AppState) {
    console.debug('commitNavigationEntry runs');
    console.assert(state.temporaryId === undefined, 'expected temporaryId to be unset by this point');
    this.stateCache.set(entry.id, state);

    // will also update .navigationEntryId
    this.rrCache.markUsedFor(entry.id, this.currentRenderedRoutes);

    entry.addEventListener('dispose', () => {
      this.rrCache.unreference(entry.id);
    });
  }

  protected setupNavigationApi() {
    setInterval(() => {
      console.debug('current id is', window.navigation.currentEntry?.id);
    }, 2000);

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

      const info = event.info as NavigationInfo;
      const rawState = event.destination.getState() as SerializedAppState | undefined;
      let state: AppState | undefined;

      // lazy as there are other more efficient ways in which we can get an AppState
      const deserialize = () => (
        rawState !== undefined
        ? AppState.deserialize(this.sitemap, rawState)
        : AppState.fromLocator(urlToLocator(this.sitemap, new URL(event.destination.url)))
      );

      if (event.navigationType === 'traverse') {
        const id = event.destination.id;
        if (id === null) {
          throw new Error('Expected a non-null id');
        }

        state = this.stateCache.get(id) ?? deserialize();
      } else {
        if (rawState?.temporaryId !== undefined) {
          state = this.stateCache.get(rawState.temporaryId);

          if (state !== undefined) {
            // temporary state cache, replaced later with correct id
            this.stateCache.delete(rawState.temporaryId);
            state.temporaryId = undefined;
          }
        }

        if (state === undefined) {
          state = deserialize();
        }
      }
      
      // Important note: we're unsure about how browsers deal with currentEntry during intercept.
      // Firefox seems to already set the new ID but this is not how I would read the spec.
      const currentId = window.navigation.currentEntry?.id;
      event.intercept({
        handler() {
          console.debug(`Intercepting ${event.navigationType} navigation`, event);
          const promise = router.renderNavigation(state, { currentId, replace: event.navigationType === 'replace', ...info })
          promise.then(() => {
            // TODO also here, is this the correct navigationEntry?
            // necessary to update rrCache!
            router.commitNavigationEntry(window.navigation.currentEntry!, state)
          }).catch(console.error);

          return promise;
        },
      });
    });

    window.navigation.addEventListener('navigatesuccess', (event) => {
      // console.debug('navigatesuccess runs');
      
      // this.stateCache.set(entry.id, state);

      // // will also update .navigationEntryId
      // this.rrCache.markUsedFor(entry.id, this.currentRenderedRoutes);

      // entry.addEventListener('dispose', () => {
      //   this.rrCache.unreference(entry.id);
      // });
    });
  }

  /** Make an AppState based on the best source of information */
  protected getState({ id, rawState, url }: {id?: string, rawState?: SerializedAppState, url?: { pathname: string, search: string }}) {
    return (
      (id === undefined ? undefined : this.stateCache.get(id))
      ?? (rawState && AppState.deserialize(this.sitemap, rawState))
      ?? (url && AppState.fromLocator(urlToLocator(this.sitemap, url)))
    );
  }

  protected async renderNavigation(
    newState: AppState,
    options: { currentId?: string, replace?: boolean } & NavigationInfo
  ) {
    const currentId = options.currentId;

    const log = (...args: any[]) => {
      console.debug(`[renderNavigation ${currentId}]`, ...args);
    }

    log('rendering', { newState, options });

    const newRouteStack = [...newState.route.nestedInRoutes, newState.route];
    const staticImpl = this.implMap.getStaticPartOfImplementation(newState.route); // sync!
    const untrackedParamDefs = new Set(staticImpl.untrackedKeys.map(k => newState.route.paramDefs[k]));

    log('rendering part 2', { newRouteStack, staticImpl, untrackedParamDefs });

    const potentialReusedRoutes: RenderedRoute[] = [];
    if (currentId !== undefined) {
      for (const route of newRouteStack) {
        const rendered = this.rrCache.getEntry(currentId, route)?.rendered
        if (rendered === undefined) {
          break;
        } else {
          potentialReusedRoutes.push(rendered);
        }
      }
    }

    log('rendering part 3', { potentialReusedRoutes });
    
    // compare current state with new requested state
    const routeChanges = calculateRouteChanges(
      untrackedParamDefs,
      { routes: potentialReusedRoutes, state: this.getState({ id: currentId }) },
      { routes: newRouteStack, state: newState }
    );

    if (options.forceNewInstance) {
      routeChanges[routeChanges.length-1] = 'render';
    }

    log('rendering part 4', { routeChanges });

    let i=0;
    let frame: FrameDelegate | undefined = this.rootFrame;

    // Loop through routechanges with simple parameter changes
    for (; i<routeChanges.length; i++) {
      const routeChange = routeChanges[i];

      if (routeChange === 'render') {
        break;
      } else {
        const existingRenderedRoute = potentialReusedRoutes[i]!;

        if (routeChange === 'set-params') {
          // TODO check if rest of code uses ownedValues correctly? (i.e. we're not updating needlessly here)
          const paramValues = existingRenderedRoute.renderArgs.params.ownedValues;
          for (const [pd, value] of paramValues.entries()) {
            // TODO should these be memos? if so, can we simplify the rest of the code?
            // should be reactive!
            (value as ReactiveValue<any>).write(newState.paramSnapshot.get(pd)!);
          }
        }

        frame = existingRenderedRoute.subFrame;
      }

      log(`  - reuse ${i} (${routeChange})`);
    }

    let parentParamStorage: Promise<ParamStorage> | undefined = undefined;
    let framePromise = Promise.resolve(frame);
    this.currentRenderedRoutes = potentialReusedRoutes.slice(0, i);

    log('rendering part 5, still doing ', newRouteStack.slice(i));

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

    // await final promise that ties all the others together (they form a DAG normally)
    await framePromise;
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
