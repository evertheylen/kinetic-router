import { DeepMap } from "@dovetail-js/utils/deep-map.js";
import { isEqual } from "@dovetail-js/utils/equal.js";
import { getSlugPath, isSlugPathPrefix, RootSitemap, slugLookup, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, convertParamsByKey } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { locatorToUrl, serializePathParams, SerializedPathParams, urlToLocator } from "@kinetic-router/url";

import { Page, PageStatus } from "./page.js";
import { AppState, SerializedAppState } from "./app-state.js";
import { FrameDelegate, frameDelegateAttribute, rootFrameId } from "./frame.js";
import { createParamStorage, ParamStorage } from "./params.js";
import { renderRoute, RenderedRoute } from "./rendered-route.js";
import { SolidImplementationMap } from "./implementation-map.js";
import { Accessor, createEffect, createSignal, runWithOwner, Setter } from "solid-js";
import { calculateRouteChanges } from "./diff.js";
import { RenderedRouteCache } from "./rendered-route-cache.js";
import { EngineEntry, EngineNavigateEvent, EngineNavigationResult, EntrySource, NavigationEngine, NavigationInfo } from "./navigation-engine.js";

export type NavigationMode = 'push' | 'replace' | 'menu';
export type NavigateOptions = Pick<NavigationInfo, 'forceNewInstance'> & {
  mode?: NavigationMode,
};

type MenuBookmark = { id: string, key: string };

export type DestinationOperation =
  | { type: 'push' | 'replace' | 'no-op' }
  | { type: 'traverse', id: string, key: string };

/** A read-only plan, not a history entry or permission to traverse later.
 * Preparation and hrefs consume locator/url; activation re-resolves target/mode. */
export type DestinationSnapshot = {
  readonly target: Locator<any>,
  readonly mode: NavigationMode,
  readonly locator: Locator<any>,
  readonly url: string,
  readonly operation: DestinationOperation,
};


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

  // Route identity outside DeepMap; path-parameter equality inside it.
  protected bookmarks = new Map<Route, DeepMap<SerializedPathParams, MenuBookmark>>();
  protected navigationVersion: Accessor<number>;
  protected setNavigationVersion: Setter<number>;

  /** The AppState currently on screen; the target for pre-commit
   * scroll-position capture (see handleBeforeCommit). */
  protected currentState: AppState | undefined;

  protected _currentLocator: Accessor<Locator<any> | undefined>;
  protected _setCurrentLocator: Setter<Locator<any> | undefined>;
  protected activeLeaf: Accessor<RenderedRoute | undefined>;
  protected setActiveLeaf: Setter<RenderedRoute | undefined>;

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
    [this.activeLeaf, this.setActiveLeaf] = createSignal();
    [this.navigationVersion, this.setNavigationVersion] = createSignal(0);
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
      handleDispose: (entryId) => {
        this.rrCache.unreference(entryId);
        for (const [route, bookmarks] of this.bookmarks) {
          // DeepMap iteration is not stable under deletion from a hash bucket.
          for (const [params, bookmark] of [...bookmarks]) {
            if (bookmark.id === entryId) bookmarks.delete(params);
          }
          if (bookmarks.size === 0) this.bookmarks.delete(route);
        }
        this.setNavigationVersion(version => version + 1);
      },
      handleBeforeCommit: () => this.handleBeforeCommit(),
    });

    const state = this.getState(this.engine.currentEntry()!)!;
    
    const newLocator: Locator<any> = {
      route: state.route, values: convertParamsByKey(state.paramsByDefinition, state.route.paramDefs)
    };

    const newUrl = this.resolveDestination(newLocator, 'replace').url;
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

    this.recordVisit(state.locator);
    await this.renderNavigation(state, undefined, {});
  }

  navigate<ParamDefs extends AnyParamDefs>(locator: Locator<ParamDefs>, options?: NavigateOptions) {
    return this.executeDestination(this.resolveDestination(locator, options?.mode), options);
  }

  /** Shared by navigation, future hrefs and preparation. Reads engine history,
   * never changes it. Reactive consumers are invalidated at commit/disposal. */
  resolveDestination<ParamDefs extends AnyParamDefs>(
    target: Locator<ParamDefs>, mode: NavigationMode = 'push',
  ): DestinationSnapshot {
    this.navigationVersion();
    target = { route: target.route, values: { ...target.values } };
    const resolved = resolveAliases(target);
    const root = { route: resolved.route, values: { ...resolved.values } };
    const snapshot = (locator: Locator<any>, operation: DestinationOperation): DestinationSnapshot => ({
      target, mode, locator, url: locatorToUrl(this.sitemap, locator), operation,
    });
    if (mode !== 'menu') return snapshot(root, { type: mode });

    const rootPath = getSlugPath(this.sitemap, root.route);
    if (rootPath === undefined) throw new Error('Route is not registered in the provided rootSitemap.');
    const rootParams = serializePathParams(this.sitemap, root, rootPath);
    const matchesRootInstance = (locator: Locator<any>) => {
      const path = getSlugPath(this.sitemap, locator.route);
      return path !== undefined && isSlugPathPrefix(rootPath, path)
        && isEqual(rootParams, serializePathParams(this.sitemap, locator, rootPath));
    };
    const current = this.engine.currentEntry();
    const currentLocator = current && this.entryLocator(current);
    const entries = this.engine.entries();
    const traverse = (entry: EngineEntry, locator: Locator<any>) =>
      snapshot(locator, { type: 'traverse', id: entry.id, key: entry.key });

    if (current && currentLocator && matchesRootInstance(currentLocator)) {
      if (currentLocator.route === root.route) return snapshot(currentLocator, { type: 'no-op' });
      // Nearest preceding root, never a later/forward root or a layout parent.
      for (const entry of entries.toReversed()) {
        if (entry.index >= current.index) continue;
        const locator = this.entryLocator(entry);
        if (!locator) continue;
        if (locator.route === root.route && matchesRootInstance(locator)) return traverse(entry, locator);
      }
      return snapshot(root, { type: 'replace' });
    }

    const bookmark = this.bookmarks.get(root.route)?.get(rootParams);
    const entry = bookmark && entries.find(entry => entry.id === bookmark.id && entry.key === bookmark.key);
    const locator = entry && this.entryLocator(entry);
    if (entry && locator && matchesRootInstance(locator)) return traverse(entry, locator);
    return snapshot(root, { type: 'push' });
  }

  /** Revalidate at activation, retaining the original menu-root/alias identity
   * rather than treating a previously resolved resume URL as a new target. */
  activateDestination(snapshot: DestinationSnapshot, info?: Omit<NavigateOptions, 'mode'>): EngineNavigationResult {
    return this.executeDestination(this.resolveDestination(snapshot.target, snapshot.mode), info);
  }

  protected executeDestination({ locator, url, operation }: DestinationSnapshot, info?: Omit<NavigateOptions, 'mode'>): EngineNavigationResult {
    if (operation.type === 'no-op') return { finished: Promise.resolve() };
    if (operation.type === 'traverse') return this.engine.traverseTo(operation.key, { forceNewInstance: info?.forceNewInstance });
    return this.engine.navigate({
      url, history: operation.type,
      state: AppState.fromLocator(locator).serialize(this.sitemap),
      info: { forceNewInstance: info?.forceNewInstance },
    });
  }

  /** Unmatched or unreadable entries may exist in the engine but are not menu
   * destinations. Never traverse to one just because its key still survives. */
  protected entryLocator(entry: EntrySource): Locator<any> | undefined {
    try { return this.getState(entry)?.locator; }
    catch { return undefined; }
  }

  protected recordVisit(locator: Locator<any>): void {
    const entry = this.engine.currentEntry();
    if (!entry) return;
    const path = getSlugPath(this.sitemap, locator.route);
    if (!path) throw new Error('Route is not registered in the provided rootSitemap.');
    for (const [route, rootPath] of this.sitemap[slugLookup]) {
      if (route instanceof Alias || !isSlugPathPrefix(rootPath, path)) continue;
      let bookmarks = this.bookmarks.get(route);
      if (!bookmarks) {
        bookmarks = new DeepMap();
        this.bookmarks.set(route, bookmarks);
      }
      bookmarks.set(serializePathParams(this.sitemap, locator, rootPath), { id: entry.id, key: entry.key });
    }
    this.setNavigationVersion(version => version + 1);
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
    // A visit is committed even if its renderer is slow, fails, or is superseded.
    this.recordVisit(newState.locator);
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
          if (state.route instanceof Alias) {
            const resolved = AppState.fromLocator(resolveAliases(state.locator), state.id);
            resolved.scrollTops = state.scrollTops;
            return resolved;
          }
          return state;
        }
      }

      if (entry.url) {
        return AppState.fromLocator(
          urlToLocator(this.sitemap, typeof entry.url === 'string' ? new URL(entry.url, window.location.href) : entry.url),
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
    let releaseReused: (() => void) | undefined;
    const discard = () => {
      if (committed) return; // Successful stacks belong to the cache now.
      for (const params of createdParams.toReversed()) params.owner.dispose();
      for (const rendered of createdRoutes.toReversed()) {
        const html = rendered.renderOutput?.html;
        if (html !== undefined) html.parentNode?.removeChild(html);
      }
      releaseReused?.();
    };
    signal.addEventListener('abort', discard, { once: true });

    try {
      previousRender?.abort();
      signal.throwIfAborted();
      const newRouteStack = [...newState.route.nestedInRoutes, newState.route];
      const potentialReusedRoutes = cacheId === undefined ? [] : this.rrCache.get(cacheId) ?? [];
      const routeChanges = calculateRouteChanges(
        potentialReusedRoutes,
        { routes: newRouteStack, state: newState }
      );
      if (navInfo.forceNewInstance) routeChanges[routeChanges.length - 1] = 'render';
      const firstRender = routeChanges.indexOf('render');
      releaseReused = this.rrCache.retainForRender(potentialReusedRoutes.slice(0, firstRender < 0 ? routeChanges.length : firstRender));

      let i = 0;
      let frame: FrameDelegate | undefined = this.rootFrame;
      for (; i < routeChanges.length; i++) {
        signal.throwIfAborted();
        if (routeChanges[i] === 'render') break;
        const reused = potentialReusedRoutes[i];
        if (routeChanges[i] === 'set-params') {
          for (const [pd, value] of reused.renderArgs.params.ownedValues) {
            if (value.reactive) value.write(newState.paramsByDefinition.get(pd));
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
          runWithOwner(rendered.owner, () => createEffect(
            () => this.activeLeaf() === rendered ? rendered.renderOutput!.title : undefined,
            title => { if (title !== undefined) document.title = title; }
          ));
          renderedRoutes.push(rendered);
          frame.setElement(rendered.renderOutput!.html);
          return rendered.subFrame;
        });
      }

      const leafFrame = await framePromise;
      signal.throwIfAborted();
      leafFrame?.clear();
      this.restoreScrollPositions(newState);
      this.currentState = newState;
      committed = true;
      this.rrCache.markUsedFor(newState.id, renderedRoutes);
      signal.throwIfAborted();
      this.setActiveLeaf(renderedRoutes.at(-1));
      this._setCurrentLocator(newState.locator);
    } finally {
      // Also stop sibling work and clean up owners if rendering fails.
      if (!committed) controller.abort();
      releaseReused?.();
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
