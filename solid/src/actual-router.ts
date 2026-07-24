import { getSlugPath, RootSitemap, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, convertParamsByKey } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { locatorToUrl, urlToLocator } from "@kinetic-router/url";

import { Page, PageStatus } from "./page.js";
import { AppState, SerializedAppState } from "./app-state.js";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame.js";
import { createParamStorage, mapParamObjectToParamInitMap, ParamInit, ParamStorage, ReactiveValue } from "./params.js";
import { renderRoute, RenderedRoute } from "./rendered-route.js";
import { SolidImplementationMap } from "./implementation-map.js";
import { Accessor, createEffect, createSignal, runWithOwner, Setter } from "solid-js";
import { calculateRouteChanges, RouteChange } from "./diff.js";
import { RenderedRouteCache } from "./rendered-route-cache.js";
import { EngineNavigateEvent, EntrySource, NavigationEngine, NavigationInfo } from "./navigation-engine.js";


export class ActualRouter<
  ExtraStaticData extends object,
  ExtraOutput extends object,
> {
  readonly sitemap: RootSitemap;
  readonly implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>;
  readonly engine: NavigationEngine;

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

  /** The AppState currently on screen; the target for pre-commit
   * scroll-position capture (see handleBeforeCommit). */
  protected currentState: AppState | undefined;

  protected _currentLocator: Accessor<Locator<any> | undefined>;
  protected _setCurrentLocator: Setter<Locator<any> | undefined>;

  rootFrame!: FrameDelegate;

  constructor(
    sitemap: RootSitemap,
    implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>,
    engine: NavigationEngine
  ) {
    this.sitemap = sitemap;
    this.implMap = implMap;
    this.engine = engine;

    [this._currentLocator, this._setCurrentLocator] = createSignal();
  }

  currentLocator() {
    return this._currentLocator();
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
    this.engine.attach({
      handleNavigate: (event) => this.handleNavigateEvent(event),
      handleDispose: (entryId) => this.rrCache.unreference(entryId),
      handleBeforeCommit: () => this.handleBeforeCommit(),
    });

    const state = this.getState(this.engine.currentEntry()!)!;
    
    const newLocator: Locator<any> = {
      route: state.route, values: convertParamsByKey(state.paramsByDefinition, state.route.paramDefs)
    };

    const newUrl = locatorToUrl(this.sitemap, newLocator);
    const serializedState = state.serialize(this.sitemap);

    if (this.engine.currentEntry()?.url !== newUrl) {
      const res = this.engine.navigate({
        // set ignore=true to avoid weird behaviour not aligned with "first load"
        url: newUrl, state: serializedState, history: 'replace', info: { ignore: true }
      });
      const committedEntry = await res.committed;

      // replacing mints a new entry id: adopt it *before* rendering, so the
      // initial render is cached under the entry id it actually lives in
      if (committedEntry !== undefined) {
        state.id = committedEntry.id;
      }
    } else {
      this.engine.updateCurrentEntry(serializedState);
    }

    await this.renderNavigation(state, undefined, {});
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

    //console.debug('navigate to ', state);
    
    const url = locatorToUrl(this.sitemap, locator);
    return this.engine.navigate({
      url,
      state: state.serialize(this.sitemap),
      history: options?.replace ? 'replace' : 'push',
      info: { forceNewInstance: options?.forceNewInstance }
    });
  }

  /** Called by the engine right before a navigation commits, while the
   * outgoing entry is still current. Persists transient page state (scroll
   * positions) onto that entry — after commit, `updateCurrentEntry` would
   * target the *new* entry and corrupt its state. */
  protected handleBeforeCommit(): void {
    if (this.currentState === undefined) return;

    this.currentState.scrollTops = this.captureScrollPositions();
    this.engine.updateCurrentEntry(this.currentState.serialize(this.sitemap));
  }

  /** Called by the engine for every navigation it observes. */
  protected handleNavigateEvent(event: EngineNavigateEvent): Promise<void> {
    // could be an existing state!
    const newState = this.getState(event.destination)!;

    if (event.navigationType === 'traverse') {
      return this.renderNavigation(newState, newState.id, event.info);
    } else {
      // TODO handle 'replace' better if needed?
      if (newState?.isTemporary()) {
        this.stateCache.delete(newState.id);
      }
      newState.id = event.committedId;
      return this.renderNavigation(newState, event.fromId, event.info);
    }
  }

    /** Make an AppState based on the best source of information */
    protected getState(entry: EntrySource) {
      if (entry.id) {
        const state = this.stateCache.get(entry.id);
        if (state !== undefined) return state;
      }

      if (entry.getState !== undefined) {
        const rawState = entry.getState();
        // null happens for entries created without state (e.g. native link
        // clicks); treat it like a missing state and fall back to the URL
        if (rawState !== undefined && rawState !== null) {
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

    protected captureScrollPositions(): Map<string, number> {
      return new Map([['window', window.scrollY]]);
    }

    protected restoreScrollPositions(state: AppState): void {
      if (state.scrollTops.size > 0) {
        for (const [key, value] of state.scrollTops) {
          if (key === 'window') {
            window.scrollTo(0, value);
          }
        }
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

    // console.debug(`renderNavigation ${cacheId} > ${newState.id}: ${routeChanges.join(' | ')}`);
    // console.debug(`  -> potential reuse:`, potentialReusedRoutes);

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
            (value as ReactiveValue<any>).write(newState.paramsByDefinition.get(pd)!);
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
      // capture per iteration: `i` has moved on by the time the callbacks run
      const isLeafRoute = i === routeChanges.length-1;
      // assume all changes are 'render' from here on out
      const implementationPromise = (
        this.implCache.get(route) ?? this.implMap.loadImplementation(route).then((impl) => {
          this.implCache.set(route, impl);
          return impl;
        })
      );

      const paramStorage: Promise<ParamStorage> = Promise.all([implementationPromise, parentParamStorage]).then(
        ([implementation, parent]) => createParamStorage({route, implementation, paramMap: newState.paramsByDefinition, parent})
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

        if (isLeafRoute) {
          // TODO gate this behind some check if this route is active and most-specific (via PageStatus?)
          runWithOwner(rendered.owner, () => createEffect(
            () => rendered.renderOutput!.title,
            (title) => {
              document.title = title;
              this.engine.titleChanged?.(title);
            }
          ));
        }

        // push should be safe as these run in order thanks to framePromise
        this.currentRenderedRoutes.push(rendered);
        frame.setElement(rendered.renderOutput!.html);
        return rendered.subFrame;
      });
    }

    // (Scroll positions of the outgoing page are captured in
    // handleBeforeCommit, pre-commit — the only moment the outgoing entry is
    // still the engine's current entry.)

    this.stateCache.set(newState.id, newState);
    // await final promise that ties all the others together (they form a DAG normally)
    await framePromise;

    // Restore scroll positions from the new state (set during a previous navigate-away).
    this.restoreScrollPositions(newState);

    // Update other state
    this.currentState = newState;
    this._setCurrentLocator(newState.locator);

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
