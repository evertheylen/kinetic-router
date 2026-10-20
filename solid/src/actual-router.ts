import { getSlugPath, RootSitemap, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, convertParamsByKey } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { locatorToUrl, urlToLocator } from "@kinetic-router/url";

import { Page, PageStatus } from "./page.js";
import { AppState, SerializedAppState } from "./app-state.js";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame.js";
import { createParamStorage, ParamStorage, ReactiveValue } from "./params.js";
import { renderRoute, RenderedRoute } from "./rendered-route.js";
import { SolidImplementationMap } from "./implementation-map.js";
import { Accessor, createEffect, createSignal, runWithOwner, Setter } from "solid-js";
import { calculateRouteChanges } from "./diff.js";
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

  readonly rrCache: RenderedRouteCache;

  // TODO use Backstage!

  protected pendingRender: AbortController | undefined;

  /** The AppState currently on screen; the target for pre-commit
   * scroll-position capture (see handleBeforeCommit). */
  protected currentState: AppState | undefined;

  protected _currentLocator: Accessor<Locator<any> | undefined>;
  protected _setCurrentLocator: Setter<Locator<any> | undefined>;

  rootFrame!: FrameDelegate;

  constructor(
    sitemap: RootSitemap,
    implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>,
    engine: NavigationEngine,
    rrCache = new RenderedRouteCache(),
  ) {
    this.sitemap = sitemap;
    this.implMap = implMap;
    this.engine = engine;
    this.rrCache = rrCache;

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
    // A committed entry may still be rendering while an older page is displayed.
    // Never overwrite that unfinished entry with the displayed page's state.
    if (this.currentState === undefined || this.currentState.id !== this.engine.currentEntry()?.id) return;

    this.currentState.scrollTops = this.captureScrollPositions();
    this.engine.updateCurrentEntry(this.currentState.serialize(this.sitemap));
  }

  /** Called by the engine for every navigation it observes. */
  protected handleNavigateEvent(event: EngineNavigateEvent): Promise<void> {
    // could be an existing state!
    const newState = this.getState(event.destination)!;

    newState.id = event.committedId;
    return this.renderNavigation(
      newState,
      event.navigationType === 'traverse' ? event.committedId : event.fromId,
      event.info,
    );
  }

    /** Make an AppState based on the best source of information */
    protected getState(entry: EntrySource) {
      if (entry.getState !== undefined) {
        const rawState = entry.getState();
        // null happens for entries created without state (e.g. native link
        // clicks); treat it like a missing state and fall back to the URL
        if (rawState !== undefined && rawState !== null) {
          const state = AppState.deserialize(this.sitemap, rawState as SerializedAppState);
          // Serialized state can still carry a temporary or replaced entry id.
          if (entry.id) state.id = entry.id;
          return state;
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
    navInfo: NavigationInfo
  ) {
    const previousRender = this.pendingRender;
    const controller = new AbortController();
    const { signal } = controller;
    this.pendingRender = controller;

    const createdParams: ParamStorage[] = [];
    const createdRoutes: RenderedRoute[] = [];
    const renderedRoutes: RenderedRoute[] = [];
    let committed = false;
    const discard = () => {
      if (committed) return; // Successful stacks belong to the cache now.
      for (const params of createdParams.toReversed()) params.owner.dispose();
      for (const rendered of createdRoutes.toReversed()) {
        const html = rendered.renderOutput?.html;
        if (html !== undefined) html.parentNode?.removeChild(html);
      }
    };
    signal.addEventListener('abort', discard, { once: true });

    try {
      previousRender?.abort();
      signal.throwIfAborted();
      const newRouteStack = [...newState.route.nestedInRoutes, newState.route];
      const staticImpl = this.implMap.getStaticPartOfImplementation(newState.route);
      const untrackedParamDefs = new Set(staticImpl.untrackedKeys.map(k => newState.route.paramDefs[k]));
      const potentialReusedRoutes = cacheId === undefined ? [] : this.rrCache.get(cacheId) ?? [];
      const routeChanges = calculateRouteChanges(
        untrackedParamDefs,
        potentialReusedRoutes,
        { routes: newRouteStack, state: newState }
      );
      if (navInfo.forceNewInstance) routeChanges[routeChanges.length - 1] = 'render';

      let i = 0;
      let frame: FrameDelegate | undefined = this.rootFrame;
      for (; i < routeChanges.length; i++) {
        if (routeChanges[i] === 'render') break;
        const reused = potentialReusedRoutes[i];
        if (routeChanges[i] === 'set-params') {
          for (const [pd, value] of reused.renderArgs.params.ownedValues) {
            (value as ReactiveValue<any>).write(newState.paramsByDefinition.get(pd)!);
          }
        }
        this.assertFrame(frame, reused.route);
        frame.setElement(reused.renderOutput!.html);
        frame = reused.subFrame;
        renderedRoutes.push(reused);
      }

      let parentParamStorage: Promise<ParamStorage> | undefined = i === 0
        ? undefined
        : Promise.resolve(potentialReusedRoutes[i - 1].renderArgs.params);
      let framePromise = Promise.resolve(frame);

      // Prepare nested renders concurrently, but mount them in ancestor order.
      for (; i < routeChanges.length; i++) {
        const route = newRouteStack[i];
        const isLeafRoute = i === routeChanges.length - 1;
        const implementationPromise = (
          this.implCache.get(route) ?? this.implMap.loadImplementation(route).then(impl => {
            this.implCache.set(route, impl);
            return impl;
          })
        );
        const paramStorage: Promise<ParamStorage> = Promise.all([implementationPromise, parentParamStorage]).then(
          ([implementation, parent]) => {
            signal.throwIfAborted();
            const params = createParamStorage({ route, implementation, paramMap: newState.paramsByDefinition, parent });
            createdParams.push(params);
            return params;
          }
        );
        parentParamStorage = paramStorage;

        const renderPromise = Promise.all([implementationPromise, paramStorage]).then(
          ([implementation, params]) => renderRoute({
            renderArgs: { params, pageStatus: this.createPageStatus() },
            implementation,
            route,
            signal,
          })
        );
        framePromise = Promise.all([renderPromise, framePromise]).then(([rendered, frame]) => {
          signal.throwIfAborted();
          createdRoutes.push(rendered);
          this.assertFrame(frame, route);
          if (isLeafRoute) {
            runWithOwner(rendered.owner, () => createEffect(
              () => rendered.renderOutput!.title,
              title => { document.title = title; }
            ));
          }
          renderedRoutes.push(rendered);
          frame.setElement(rendered.renderOutput!.html);
          return rendered.subFrame;
        });
      }

      await framePromise;
      signal.throwIfAborted();
      this.restoreScrollPositions(newState);
      this.currentState = newState;
      committed = true;
      this.rrCache.markUsedFor(newState.id, renderedRoutes);
      signal.throwIfAborted();
      this._setCurrentLocator(newState.locator);
    } finally {
      // Also stop sibling work and clean up owners if rendering fails.
      if (!committed) controller.abort();
      signal.removeEventListener('abort', discard);
      if (this.pendingRender === controller) this.pendingRender = undefined;
    }
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
