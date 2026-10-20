import { DeepMap } from "@dovetail-js/utils/deep-map.js";
import { isEqual } from "@dovetail-js/utils/equal.js";
import { getSlugPath, isSlugPathPrefix, RootSitemap, slugLookup, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, convertParamsByKey } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { locatorToUrl, serializePathParams, SerializedPathParams, urlToLocator } from "@kinetic-router/url";

import { Page } from "./page.js";
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

/** Constructed output has no live frame, parameter, or history side effects.
 * The caller must either activate it or dispose it; adopt transfers ownership
 * to the history cache. Stage 3 can stage its new suffix in isolated containers. */
export type PreparedNavigation = {
  readonly routes: readonly RenderedRoute[],
  readonly reusedCount: number,
  readonly signal: AbortSignal,
  adopt(): void,
  dispose(): void,
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

  // TODO: Stage 3 — mount prepared output in isolated Backstage containers.

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
    [this.navigationVersion, this.setNavigationVersion] = createSignal(0);
  }

  currentLocator() {
    return this._currentLocator();
  }

  init() {
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
      handleNavigate: (event) => {
        const rendering = this.handleNavigateEvent(event);
        // Engine-initiated navigation can be fire-and-forget too.
        void rendering.catch(() => {});
        return rendering;
      },
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
    return this.initializeEntry();
  }

  protected async initializeEntry() {
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

    if (this.engine.currentEntry()?.id !== state.id) return;
    this.recordVisit(state.locator);
    const controller = this.beginRender();
    try {
      await this.renderNavigation(state, undefined, {}, controller);
    } catch (error) {
      // A successor owns rendering now. Genuine initialization errors still fail.
      if (!controller.signal.aborted) throw error;
    }
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
    const result = operation.type === 'traverse'
      ? this.engine.traverseTo(operation.key, { forceNewInstance: info?.forceNewInstance })
      : this.engine.navigate({
        url, history: operation.type,
        state: AppState.fromLocator(locator).serialize(this.sitemap),
        info: { forceNewInstance: info?.forceNewInstance },
      });
    // Callers can still await failures, but fire-and-forget navigation must not
    // produce unhandled rejections when a later navigation cancels construction.
    void result.committed?.catch(() => {});
    void result.finished?.catch(() => {});
    return result;
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
  protected async handleNavigateEvent(event: EngineNavigateEvent): Promise<void> {
    event.signal.throwIfAborted();
    // could be an existing state!
    const newState = this.getState(event.destination)!;

    newState.id = event.committedId;
    // A visit is committed even if its renderer is slow, fails, or is superseded.
    this.recordVisit(newState.locator);
    return this.renderNavigation(
      newState,
      event.navigationType === 'traverse' ? event.committedId : event.fromId,
      event.info,
      this.beginRender(),
      event.signal,
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

  protected beginRender(): AbortController {
    const previous = this.pendingRender;
    const controller = new AbortController();
    this.pendingRender = controller;
    previous?.abort();
    return controller;
  }

  protected async renderNavigation(
    newState: AppState,
    cacheId: string | undefined,
    navInfo: NavigationInfo,
    controller: AbortController,
    navigationSignal?: AbortSignal,
  ) {
    const signal = navigationSignal ? AbortSignal.any([controller.signal, navigationSignal]) : controller.signal;
    let prepared: PreparedNavigation | undefined;
    try {
      signal.throwIfAborted();
      const routes = [...newState.route.nestedInRoutes, newState.route];
      const cached = cacheId === undefined ? [] : this.rrCache.get(cacheId) ?? [];
      const changes = calculateRouteChanges(cached, { routes, state: newState });
      if (navInfo.forceNewInstance) changes[changes.length - 1] = 'render';
      const firstRender = changes.indexOf('render');
      const reused = cached.slice(0, firstRender < 0 ? changes.length : firstRender);
      prepared = await this.prepareNavigation(newState, reused, signal);
      signal.throwIfAborted();
      this.activateNavigation(newState, prepared, signal);
    } finally {
      // Disposal is a no-op once history has adopted the output. Failure disposes
      // construction without pretending that the navigation was superseded.
      prepared?.dispose();
      if (this.pendingRender === controller) this.pendingRender = undefined;
    }
  }

  /** Construction never mounts frames, writes live params, or registers history.
   * Reused ancestors are pinned, not modified. A future Backstage caller can
   * stage only routes.slice(reusedCount), then revalidate before activation. */
  protected async prepareNavigation(
    state: AppState, reused: readonly RenderedRoute[], requestSignal: AbortSignal,
  ): Promise<PreparedNavigation> {
    const controller = new AbortController();
    const { signal } = controller;
    const createdParams: ParamStorage[] = [];
    const createdRoutes: RenderedRoute[] = [];
    const releaseReused = this.rrCache.retainForRender(reused);
    let ownsConstruction = true;
    const detach = () => {
      requestSignal.removeEventListener('abort', dispose);
      releaseReused();
    };
    const adopt = () => {
      signal.throwIfAborted();
      ownsConstruction = false;
      detach();
    };
    const dispose = () => {
      if (!ownsConstruction) return;
      ownsConstruction = false;
      controller.abort(requestSignal.reason);
      for (const params of createdParams.toReversed()) params.owner.dispose();
      for (const rendered of createdRoutes.toReversed()) {
        const html = rendered.renderOutput?.html;
        if (html !== undefined) html.parentNode?.removeChild(html);
      }
      detach();
    };
    requestSignal.addEventListener('abort', dispose, { once: true });

    try {
      requestSignal.throwIfAborted();
      signal.throwIfAborted();
      const routes = [...state.route.nestedInRoutes, state.route];
      const pending = reused.map(rendered => Promise.resolve(rendered));
      let parentParams = reused.at(-1) && Promise.resolve(reused.at(-1)!.renderArgs.params);
      for (let i = reused.length; i < routes.length; i++) {
        const route = routes[i];
        const implementation = Promise.resolve(this.implCache.get(route) ?? this.implMap.loadImplementation(route).then(impl => {
          this.implCache.set(route, impl);
          return impl;
        }));
        const deferParent = i === reused.length && reused.length > 0;
        const params: Promise<ParamStorage> = Promise.all([implementation, parentParams]).then(([impl, parent]) => {
          signal.throwIfAborted();
          const storage = createParamStorage({ route, implementation: impl, paramMap: state.paramsByDefinition, parent, deferParent });
          createdParams.push(storage);
          return storage;
        });
        parentParams = params;
        pending.push(Promise.all([implementation, params]).then(([implementation, params]) => {
          signal.throwIfAborted();
          return renderRoute({ route, implementation, renderArgs: { params }, signal });
        }).then(rendered => {
          createdRoutes.push(rendered);
          signal.throwIfAborted();
          runWithOwner(rendered.owner, () => createEffect(
            () => rendered.renderArgs.pageStatus.hasFocus() ? rendered.renderOutput!.title : undefined,
            title => { if (title !== undefined) document.title = title; },
          ));
          return rendered;
        }));
      }
      // Observe every sibling rejection, even when another branch fails first.
      const renderedRoutes = await Promise.all(pending);
      signal.throwIfAborted();
      return { routes: renderedRoutes, reusedCount: reused.length, signal, adopt, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }

  /** The only phase allowed to touch live frames, parameters and current state. */
  protected activateNavigation(state: AppState, prepared: PreparedNavigation, signal: AbortSignal): void {
    signal = AbortSignal.any([signal, prepared.signal]);
    signal.throwIfAborted();
    let frame: FrameDelegate | undefined = this.rootFrame;
    for (const rendered of prepared.routes) {
      this.assertFrame(frame, rendered.route);
      frame = rendered.subFrame;
    }
    // Solid 2 batches signal writes until the end of this synchronous phase.
    for (const rendered of prepared.routes.slice(0, prepared.reusedCount)) {
      signal.throwIfAborted();
      for (const [pd, value] of rendered.renderArgs.params.ownedValues) {
        const next = state.paramsByDefinition.get(pd);
        if (value.reactive && !isEqual(value.read(), next)) value.write(next);
      }
    }
    for (const rendered of prepared.routes.slice(prepared.reusedCount)) rendered.renderArgs.params.activate();
    frame = this.rootFrame;
    for (const rendered of prepared.routes) {
      signal.throwIfAborted();
      frame!.setElement(rendered.renderOutput!.html);
      frame = rendered.subFrame;
    }
    signal.throwIfAborted();
    frame?.clear();
    this.restoreScrollPositions(state);
    signal.throwIfAborted();
    this.currentState = state;
    this.rrCache.markUsedFor(state.id, prepared.routes, prepared.adopt);
    signal.throwIfAborted();
    this._setCurrentLocator(state.locator);
  }

  protected assertFrame(frame: FrameDelegate | undefined, route: Route<any>): asserts frame is FrameDelegate {
    if (frame === undefined) {
      const slugPath = getSlugPath(this.sitemap, route)!;
      const slugPathStr = slugPathToString(slugPath);
      throw new Error(`Cant render ${slugPathStr}: no frame!`);
    }
  }

}
