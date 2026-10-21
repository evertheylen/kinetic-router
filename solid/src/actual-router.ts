import { DeepMap } from "@dovetail-js/utils/deep-map.js";
import { isEqual } from "@dovetail-js/utils/equal.js";
import { getSlugPath, isSlugPathPrefix, RootSitemap, slugLookup, slugPathToString } from "@kinetic-router/definition/root.js";
import { AnyParamDefs, convertParamsByDefinition, convertParamsByKey } from "@kinetic-router/definition/params.js";
import { Alias, Locator, resolveAliases, Route } from "@kinetic-router/definition/routes.js";
import { locatorToUrl, serializePathParams, SerializedPathParams, urlToLocator } from "@kinetic-router/url";

import { Page } from "./page.js";
import { AppState, SerializedAppState } from "./app-state.js";
import { OutletDelegate, outletDelegateAttribute, rootOutletId } from "./outlet.js";
import { createParamStorage, ParamStorage } from "./params.js";
import { renderRoute, RenderedRoute } from "./rendered-route.js";
import { SolidImplementationMap } from "./implementation-map.js";
import { Accessor, createEffect, createSignal, runWithOwner, Setter } from "solid-js";
import { reusableRoutes } from "./diff.js";
import { RenderedRouteCache } from "./rendered-route-cache.js";
import { EngineBeforeCommit, EngineEntry, EngineNavigateEvent, EngineNavigationResult, EntrySource, NavigationEngine, NavigationInfo } from "./navigation-engine.js";
import type { TransientHandle } from './router.js';
import { Backstage } from './backstage.js';
import { PreparationRegistry, type PreparationLease } from './preparation-registry.js';
import { NavigationTransition, type NavigationTransitionOptions } from './navigation-transition.js';

/** push (default) adds an entry, or replaces a transient-marked current entry;
 * replace replaces the current entry.
 * menu resumes a subtree's last committed visit from outside, returns to its
 * root from below, and is a no-op at the root. Activation revalidates the
 * original menu root rather than blindly following a previously resolved href. */
export type NavigationMode = 'push' | 'replace' | 'menu';
export type NavigateOptions = Pick<NavigationInfo, 'forceNewInstance'> & {
  mode?: NavigationMode,
};

/** Isolated construction and its consumer interest. Adoption gives history
 * ownership without ending that interest; dispose releases it. Only the new
 * suffix is mounted in Backstage, without live outlet or parameter side effects. */
export type PreparedNavigation = {
  readonly routes: readonly RenderedRoute[],
  readonly reusedCount: number,
  readonly signal: AbortSignal,
  adopt(): void,
  setRequested(requested: boolean): void,
  dispose(): void,
};

type MenuBookmark = { id: string, key: string };
/** Map membership means pending or live; removal permanently expires the record.
 * entryId is absent until commit. enter is consumed before invocation (or skipped
 * by an early close); cleanup then owns the interaction until departure. */
type TransientRecord = {
  enter?: () => void | (() => void),
  cleanup?: () => void,
  predecessor: MenuBookmark,
  entryId?: string,
  opening?: EngineNavigationResult,
  closeRequested: boolean,
  closing?: EngineNavigationResult,
};

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

  protected readonly preparations: PreparationRegistry;
  protected readonly implLoads = new Map<Route<any>, Promise<Page<ExtraOutput, any, any>>>();
  protected readonly preparationHandoffs = new WeakMap<NavigationInfo, PreparationLease>();
  // Info identity is the runtime token for a pending or live interaction.
  protected readonly transients = new Map<NavigationInfo, TransientRecord>();
  // Parent-first stacks for entries sharing the visible page; cleared on ordinary
  // departure. They own no output and may retain expired tokens, so Forward can
  // reuse the page without reviving callbacks.
  protected readonly transientStacksByEntry = new Map<string, readonly NavigationInfo[]>();

  protected pendingTransition: NavigationTransition | undefined;
  protected detachEngine: (() => void) | undefined;
  protected disposed = false;

  // Route identity outside DeepMap; path-parameter equality inside it.
  protected bookmarks = new Map<Route, DeepMap<SerializedPathParams, MenuBookmark>>();
  protected navigationVersion: Accessor<number>;
  protected setNavigationVersion: Setter<number>;

  /** The AppState currently on screen; the target for pre-commit
   * scroll-position capture (see handleBeforeCommit). */
  protected currentState: AppState | undefined;

  protected _currentLocator: Accessor<Locator<any> | undefined>;
  protected _setCurrentLocator: Setter<Locator<any> | undefined>;

  rootOutlet!: OutletDelegate;

  constructor(
    sitemap: RootSitemap,
    implMap: SolidImplementationMap<ExtraStaticData, ExtraOutput>,
    engine: NavigationEngine,
    rrCache = new RenderedRouteCache(),
    preparations = new PreparationRegistry(),
  ) {
    this.sitemap = sitemap;
    this.implMap = implMap;
    this.engine = engine;
    this.rrCache = rrCache;
    this.preparations = preparations;

    [this._currentLocator, this._setCurrentLocator] = createSignal();
    [this.navigationVersion, this.setNavigationVersion] = createSignal(0);
  }

  currentLocator() {
    return this._currentLocator();
  }

  init() {
    //@ts-ignore
    window.__router = this;

    const rootOutletElement = document.getElementById(rootOutletId);
    if (rootOutletElement === null) {
      throw new Error('No root outlet found');
    }

    this.rootOutlet = (rootOutletElement as any)[outletDelegateAttribute];

    if (this.rootOutlet === undefined) {
      throw new Error('No delegate on root outlet found');
    }

    // setup after initial navigation stuff to avoid weird unwanted behaviour
    this.detachEngine = this.engine.attach({
      handleNavigate: (event) => {
        const rendering = this.handleNavigateEvent(event);
        // Engine-initiated navigation can be fire-and-forget too.
        void rendering.catch(() => {});
        return rendering;
      },
      handleDispose: (entryId) => {
        this.transientStacksByEntry.delete(entryId);
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
      handleBeforeCommit: event => this.handleBeforeCommit(event),
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
    }

    if (this.disposed || this.engine.currentEntry()?.id !== state.id) return;
    this.recordVisit(state.locator);
    this.engine.updateCurrentEntry(state.serialize(this.sitemap));
    if (this.disposed || this.engine.currentEntry()?.id !== state.id) return;
    const transition = this.beginTransition(state);
    try {
      await this.renderNavigation(transition);
    } catch (error) {
      // A successor owns rendering now. Genuine initialization errors still fail.
      if (!transition.signal.aborted) throw error;
    }
  }

  navigate<ParamDefs extends AnyParamDefs>(locator: Locator<ParamDefs>, options?: NavigateOptions) {
    return this.executeDestination(this.resolveDestination(locator, options?.mode), options);
  }

  pushTransient(enter: () => void | (() => void)): TransientHandle {
    const predecessor = this.engine.currentEntry();
    if (this.disposed || !predecessor || this.currentState?.id !== predecessor.id || this.pendingTransition) {
      throw new Error('Router has no fully activated current page');
    }
    if (this.transients.size) console.warn('Nested transient: navigating away may leave extra Back steps.');
    const info: NavigationInfo = {};
    const record: TransientRecord = { enter, predecessor: { id: predecessor.id, key: predecessor.key }, closeRequested: false };
    const state = this.currentState.serialize(this.sitemap);
    // Install before navigate: MemoryEngine commits synchronously.
    this.transients.set(info, record);
    try {
      const url = predecessor.url;
      if (!url) throw new Error('Current entry has no URL');
      const opening = record.opening = this.engine.navigate({
        url: typeof url === 'string' ? url : url.pathname + url.search,
        state: { ...state, $transient: true }, history: 'push', info,
      });
      const releasePending = () => {
        if (!record.entryId || (record.enter && !record.closeRequested)) this.expireTransients([info]);
      };
      void opening.committed?.catch(() => {});
      void Promise.resolve(opening.finished).then(releasePending, releasePending);
      return { committed: opening.committed, finished: opening.finished, close: () => this.closeTransient(info, record) };
    } catch (error) {
      this.expireTransients([info]);
      throw error;
    }
  }

  protected closeTransient(info: NavigationInfo, record: TransientRecord): EngineNavigationResult {
    if (record.closing) return record.closing;
    if (this.disposed || this.transients.get(info) !== record) return { finished: Promise.resolve() };
    record.closeRequested = true;
    // Publish the close before traversal, whose commit/cleanup can be synchronous.
    const ready = Promise.withResolvers<EngineNavigationResult>();
    const closing: EngineNavigationResult = {
      committed: ready.promise.then(result => result.committed ?? { id: this.engine.currentEntry()?.id ?? record.predecessor.id }),
      finished: ready.promise.then(result => result.finished),
    };
    record.closing = closing;
    const traverse = () => {
      const current = this.engine.currentEntry();
      if (this.disposed || this.transients.get(info) !== record || !current
        || this.currentState?.id !== current.id
        || this.liveTransientStack(current.id).at(-1) !== info) return {};
      const target = this.engine.entries().find(entry =>
        entry.id === record.predecessor.id && entry.key === record.predecessor.key);
      if (!target || this.engine.currentEntry()?.id !== current.id) return {};
      return this.engine.traverseTo(target.key);
    };
    if (!record.entryId) {
      // Closing early suppresses enter. Never undo a successor or newer child.
      const afterOpening = () => {
        record.enter = undefined;
        ready.resolve(this.engine.currentEntry()?.id === record.entryId ? traverse() : {});
      };
      void Promise.resolve(record.opening?.finished).then(afterOpening, afterOpening).catch(ready.reject);
    } else {
      try { ready.resolve(traverse()); }
      catch (error) { ready.reject(error); }
    }
    const settled = () => { if (record.closing === closing) record.closing = undefined; };
    void closing.committed?.catch(() => {});
    void closing.finished?.then(settled, settled);
    return closing;
  }

  protected liveTransientStack(id: string): NavigationInfo[] {
    return (this.transientStacksByEntry.get(id) ?? []).filter(info => this.transients.get(info)?.entryId !== undefined);
  }

  /** Delete the whole batch before callbacks; reentrant disposal/navigation must
   * not double-clean or accidentally expire a newly opened interaction. */
  protected expireTransients(tokens: readonly NavigationInfo[] = [...this.transients.keys()]): void {
    const cleanups: (() => void)[] = [];
    for (const info of tokens.toReversed()) {
      const record = this.transients.get(info);
      if (!record) continue;
      this.transients.delete(info);
      if (record.cleanup) cleanups.push(record.cleanup);
      record.enter = record.cleanup = undefined;
    }
    for (const cleanup of cleanups) this.runTransientCleanup(cleanup);
  }

  protected runTransientCleanup(cleanup: () => void): void {
    try { cleanup(); }
    catch (error) { console.error('Transient cleanup failed', error); }
  }

  /** Shared by navigation, hrefs and preparation. Reads engine history,
   * never changes it. Reactive consumers are invalidated at commit/disposal. */
  resolveDestination<ParamDefs extends AnyParamDefs>(
    target: Locator<ParamDefs>, mode: NavigationMode = 'push',
  ): DestinationSnapshot {
    this.navigationVersion();
    // Materialize defaults in the snapshot so a factory is not rerun between
    // hover, preparation and activation. Keep the original alias identity.
    target = { route: target.route, values: convertParamsByKey(
      convertParamsByDefinition(target.values, target.route.paramDefs), target.route.paramDefs,
    ) };
    const resolved = resolveAliases(target);
    const root = { route: resolved.route, values: { ...resolved.values } };
    const snapshot = (locator: Locator<any>, operation: DestinationOperation): DestinationSnapshot => ({
      target, mode, locator, url: locatorToUrl(this.sitemap, locator), operation,
    });
    const push = this.isTransientEntry(this.engine.currentEntry()) ? 'replace' : 'push';
    if (mode !== 'menu') return snapshot(root, { type: mode === 'push' ? push : mode });

    const rootPath = getSlugPath(this.sitemap, root.route);
    if (rootPath === undefined) throw new Error('Route is not registered in the provided rootSitemap.');
    const rootParams = serializePathParams(this.sitemap, root, rootPath);
    const matchesRootInstance = (locator: Locator<any>) => {
      const path = getSlugPath(this.sitemap, locator.route);
      return path !== undefined && isSlugPathPrefix(rootPath, path)
        && isEqual(rootParams, serializePathParams(this.sitemap, locator, rootPath));
    };
    const current = this.engine.currentEntry();
    const currentLocator = current && this.entryLocator(current, true);
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
    return snapshot(root, { type: push });
  }

  /** Revalidate at activation, retaining the original menu-root/alias identity
   * rather than treating a previously resolved resume URL as a new target. */
  activateDestination(snapshot: DestinationSnapshot, info?: Omit<NavigateOptions, 'mode'>): EngineNavigationResult {
    return this.executeDestination(this.resolveDestination(snapshot.target, snapshot.mode), info);
  }

  protected executeDestination({ locator, url, operation }: DestinationSnapshot, info?: Omit<NavigateOptions, 'mode'>): EngineNavigationResult {
    if (this.disposed) throw new Error('Router is disposed');
    if (operation.type === 'no-op') return { finished: Promise.resolve() };
    const state = AppState.fromLocator(locator);
    // Bridge activation to the engine's (possibly later) committed event. This
    // ownership is acquired synchronously, before a Link can release its lease.
    const handoff = !info?.forceNewInstance
      ? this.preparations.claim(state, operation.type === 'traverse' ? operation.id : undefined)
      : undefined;
    const navigationInfo = { forceNewInstance: info?.forceNewInstance };
    if (handoff) this.preparationHandoffs.set(navigationInfo, handoff);
    try {
      const result = operation.type === 'traverse'
        ? this.engine.traverseTo(operation.key, navigationInfo)
        : this.engine.navigate({
          url, history: operation.type, state: state.serialize(this.sitemap),
          info: navigationInfo,
        });
      const release = () => handoff?.release();
      void Promise.resolve(result.finished).then(release, release);
      // Fire-and-forget callers must not orphan a rejected commit promise.
      void result.committed?.catch(() => {});
      return result;
    } catch (error) {
      handoff?.release();
      throw error;
    }
  }

  /** Resolve again when acquiring preparation;
   * snapshots are plans, never permission to use stale menu/history targets. */
  acquirePreparation(snapshot: DestinationSnapshot): PreparationLease | undefined {
    const destination = this.resolveDestination(snapshot.target, snapshot.mode);
    if (destination.operation.type === 'no-op') return;
    const entryId = destination.operation.type === 'traverse' ? destination.operation.id : undefined;
    const state = AppState.fromLocator(destination.locator);
    return this.preparations.acquire(state, entryId, signal => {
      const cached = entryId === undefined ? this.rrCache.currentRoutes() : this.rrCache.get(entryId) ?? [];
      return this.prepareNavigation(state, reusableRoutes(cached, state), signal);
    });
  }

  /** Stop callbacks and rendering before releasing preparation and page owners. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.transientStacksByEntry.clear();
    this.expireTransients();
    this.detachEngine?.();
    this.pendingTransition?.abort();
    this.pendingTransition = undefined;
    this.disposePreparations();
    this.rrCache.dispose();
    this.bookmarks.clear();
  }

  /** Release speculative ownership without disposing the active pages. */
  disposePreparations() {
    this.preparations.dispose();
  }

  protected isTransientEntry(entry: EntrySource | undefined): boolean {
    return (entry?.getState?.() as SerializedAppState | undefined)?.$transient === true;
  }

  /** Unmatched or unreadable entries may exist in the engine but are not menu
   * destinations. Never traverse to one just because its key still survives. */
  protected entryLocator(entry: EntrySource, includeTransient = false): Locator<any> | undefined {
    try { return !includeTransient && this.isTransientEntry(entry) ? undefined : this.getState(entry)?.locator; }
    catch { return undefined; }
  }

  protected recordVisit(locator: Locator<any>): void {
    const entry = this.engine.currentEntry();
    if (!entry) return;
    if (this.isTransientEntry(entry)) {
      this.setNavigationVersion(version => version + 1);
      return;
    }
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
  protected handleBeforeCommit(event: EngineBeforeCommit): void | { preservePresentation: true } {
    // A committed entry may still be rendering while an older page is displayed.
    // Never overwrite that unfinished entry with the displayed page's state.
    if (this.currentState === undefined || this.currentState.id !== this.engine.currentEntry()?.id) return;

    this.currentState.scrollTops = this.captureScrollPositions();
    this.engine.updateCurrentEntry(this.currentState.serialize(this.sitemap));
    if (this.isTransientOnly(event, this.engine.currentEntry()?.id)) return { preservePresentation: true };
  }

  protected isTransientOnly(event: EngineBeforeCommit, fromId: string | undefined): boolean {
    if (!fromId || this.currentState?.id !== fromId || this.pendingTransition
      || !this.transientStacksByEntry.has(fromId)) return false;
    if (event.navigationType === 'push') {
      const opening = this.transients.get(event.info);
      return opening !== undefined && !opening.entryId && opening.predecessor.id === fromId;
    }
    return event.navigationType === 'traverse' && !event.info.forceNewInstance
      && event.destination.id != null && this.transientStacksByEntry.has(event.destination.id);
  }

  protected assertCurrent(id: string, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.disposed || this.engine.currentEntry()?.id !== id) throw new DOMException('Navigation superseded', 'AbortError');
  }

  protected commitTransient(event: EngineNavigateEvent, state: AppState): void {
    const opening = this.transients.get(event.info);
    const outgoing = this.liveTransientStack(event.fromId!);
    const stack = opening ? [...outgoing, event.info] : this.transientStacksByEntry.get(state.id)!;
    this.currentState = state;
    this.transientStacksByEntry.set(state.id, stack);
    if (opening) opening.entryId = state.id;
    this.engine.updateCurrentEntry(state.serialize(this.sitemap));
    this.assertCurrent(state.id, event.signal);
    this.rrCache.markUsedFor(state.id, this.rrCache.currentRoutes());
    this.assertCurrent(state.id, event.signal);
    this.setNavigationVersion(version => version + 1);
    this.assertCurrent(state.id, event.signal);
    if (!opening || this.transients.get(event.info) !== opening) return;
    const enter = opening.enter;
    opening.enter = undefined;
    if (opening.closeRequested) return;
    try {
      const cleanup = enter?.();
      if (cleanup) {
        if (this.transients.get(event.info) === opening) opening.cleanup = cleanup;
        else this.runTransientCleanup(cleanup);
      }
    } catch (error) {
      this.expireTransients([event.info]);
      throw error;
    }
    this.assertCurrent(state.id, event.signal);
  }

  /** Called by the engine for every navigation it observes. */
  protected async handleNavigateEvent(event: EngineNavigateEvent): Promise<void> {
    this.assertCurrent(event.committedId, event.signal);
    const transientOnly = this.isTransientOnly(event, event.fromId);
    // Capture only the interactions this commit leaves, before application code
    // can navigate again. Opening a child retains the whole outgoing stack.
    let departing: NavigationInfo[] = [];
    if (!transientOnly) {
      departing = [...this.transients.keys()];
      this.transientStacksByEntry.clear();
    } else if (event.navigationType === 'traverse') {
      const retained = new Set(this.liveTransientStack(event.committedId));
      departing = this.liveTransientStack(event.fromId!).filter(info => !retained.has(info));
    }

    let newState: AppState;
    try {
      newState = this.getState(event.destination)!;
      newState.id = event.committedId;
      this.assertCurrent(newState.id, event.signal);
      if (transientOnly) {
        this.commitTransient(event, newState);
      } else {
        // A visit is committed even if persistence/rendering reentrantly navigates.
        this.recordVisit(newState.locator);
        this.assertCurrent(newState.id, event.signal);
        // Persist defaults before cleanup callbacks can navigate again.
        this.engine.updateCurrentEntry(newState.serialize(this.sitemap));
      }
    } finally {
      // Departure is already committed, even if resolution or persistence failed.
      this.expireTransients(departing);
    }
    this.assertCurrent(newState.id, event.signal);
    if (transientOnly) return;
    const entryId = event.navigationType === 'traverse' ? event.committedId : undefined;
    const transition = this.beginTransition(newState, {
      cacheId: entryId ?? event.fromId,
      entryId,
      forceNewInstance: event.info.forceNewInstance,
      signal: event.signal,
    });
    const rendering = this.renderNavigation(transition);
    // renderNavigation has acquired its own lease before its first await.
    this.preparationHandoffs.get(event.info)?.release();
    this.preparationHandoffs.delete(event.info);
    return rendering;
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
            resolved.transient = state.transient;
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

  protected beginTransition(
    state: AppState, options: NavigationTransitionOptions & { cacheId?: string } = {},
  ): NavigationTransition {
    const cached = options.cacheId === undefined ? undefined : this.rrCache.get(options.cacheId);
    // An unfinished outgoing entry may have no cached output. Fall back to the
    // displayed stack, but never merge distinct history restorations.
    const source = cached ?? (options.entryId === undefined ? this.rrCache.currentRoutes() : []);
    const previous = this.pendingTransition;
    const transition = new NavigationTransition(source, state, options);
    // Publish first: abort callbacks may synchronously start another navigation.
    this.pendingTransition = transition;
    previous?.abort();
    return transition;
  }

  protected async renderNavigation(transition: NavigationTransition) {
    const { to, signal } = transition;
    try {
      this.assertCurrent(to.id, signal);
      const prepared = await transition.prepare(this.preparations,
        (reused, requestSignal) => this.prepareNavigation(to, reused, requestSignal),
      );
      this.activateNavigation(to, prepared, signal);
    } finally {
      transition.dispose();
      if (this.pendingTransition === transition) this.pendingTransition = undefined;
    }
  }

  protected loadImplementation(route: Route<any>) {
    const cached = this.implCache.get(route);
    if (cached) return Promise.resolve(cached);
    let loading = this.implLoads.get(route);
    if (!loading) {
      loading = this.implMap.loadImplementation(route).then(impl => {
        this.implCache.set(route, impl);
        return impl;
      }).finally(() => this.implLoads.delete(route));
      this.implLoads.set(route, loading);
    }
    return loading;
  }

  /** Only the new suffix is staged. Reused ancestors are pinned, never mounted
   * in Backstage, and inherited destination params remain isolated until adopt. */
  protected async prepareNavigation(
    state: AppState, reused: readonly RenderedRoute[], requestSignal: AbortSignal,
  ): Promise<PreparedNavigation> {
    const controller = new AbortController();
    const { signal } = controller;
    const createdParams: ParamStorage[] = [];
    const createdRoutes: RenderedRoute[] = [];
    const stagedRoutes = new Map<number, RenderedRoute>();
    const backstage = Backstage();
    let stageIndex = reused.length;
    let stageOutlet: OutletDelegate | undefined = {
      setElement: node => backstage.replaceChildren(node), clear: () => backstage.replaceChildren(),
    };
    let releaseRoutes = this.rrCache.retainForRender(reused);
    let renderedRoutes: readonly RenderedRoute[] = reused;
    let phase: 'constructing' | 'adopted' | 'disposed' = 'constructing';
    let requested = true;
    let fetching = reused.map(rendered => rendered.lifecycle.requestFetch());
    const releaseFetching = () => {
      const previous = fetching;
      fetching = [];
      for (const release of previous) release();
    };
    const setRequested = (value: boolean) => {
      if (phase === 'disposed' || requested === value) return;
      requested = value;
      if (value) fetching = [...reused, ...createdRoutes].map(rendered => rendered.lifecycle.requestFetch());
      else releaseFetching();
    };
    const detach = () => {
      requestSignal.removeEventListener('abort', dispose);
      backstage.remove();
    };
    const adopt = () => {
      signal.throwIfAborted();
      if (phase !== 'constructing') return;
      phase = 'adopted';
      // History owns the output now, but outstanding consumers still pin the
      // complete tree and request fetching, even if history later evicts it.
      const releaseReused = releaseRoutes;
      releaseRoutes = this.rrCache.retainForRender(renderedRoutes);
      detach();
      releaseReused();
    };
    const dispose = () => {
      if (phase === 'disposed') return;
      const constructing = phase === 'constructing';
      phase = 'disposed';
      if (constructing) {
        controller.abort(requestSignal.reason);
        for (const params of createdParams.toReversed()) params.owner.dispose();
        for (const rendered of createdRoutes.toReversed()) {
          const html = rendered.renderOutput?.html;
          if (html !== undefined) html.parentNode?.removeChild(html);
        }
      }
      detach();
      releaseFetching();
      releaseRoutes();
    };
    requestSignal.addEventListener('abort', dispose, { once: true });

    try {
      requestSignal.throwIfAborted();
      signal.throwIfAborted();
      const routes = [...state.route.nestedInRoutes, state.route];
      if (routes.length > reused.length) document.body.append(backstage);
      const pending = reused.map(rendered => Promise.resolve(rendered));
      let parentParams = reused.at(-1) && Promise.resolve(reused.at(-1)!.renderArgs.params);
      for (let i = reused.length; i < routes.length; i++) {
        const route = routes[i];
        const implementation = this.loadImplementation(route);
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
          // Fetch interest is independent of visibility and survives adoption.
          fetching.push(rendered.lifecycle.requestFetch());
          rendered.lifecycle.setState('retained');
          stagedRoutes.set(i, rendered);
          while (stagedRoutes.has(stageIndex)) {
            const next = stagedRoutes.get(stageIndex)!;
            this.assertOutlet(stageOutlet, next.route);
            stageOutlet.setElement(next.renderOutput!.html);
            stageOutlet = next.subOutlet;
            stageIndex++;
            signal.throwIfAborted();
          }
          runWithOwner(rendered.owner, () => createEffect(
            () => rendered.renderArgs.pageStatus.hasFocus() ? rendered.renderOutput!.title : undefined,
            title => { if (title !== undefined) document.title = title; },
          ));
          return rendered;
        }));
      }
      // Observe every sibling rejection, even when another branch fails first.
      renderedRoutes = await Promise.all(pending);
      signal.throwIfAborted();
      return { routes: renderedRoutes, reusedCount: reused.length, signal, adopt, setRequested, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }

  /** The only phase allowed to touch live outlets, parameters and current state. */
  protected activateNavigation(state: AppState, prepared: PreparedNavigation, signal: AbortSignal): void {
    signal = AbortSignal.any([signal, prepared.signal]);
    signal.throwIfAborted();
    let outlet: OutletDelegate | undefined = this.rootOutlet;
    for (const rendered of prepared.routes) {
      this.assertOutlet(outlet, rendered.route);
      outlet = rendered.subOutlet;
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
    outlet = this.rootOutlet;
    for (const rendered of prepared.routes) {
      signal.throwIfAborted();
      outlet!.setElement(rendered.renderOutput!.html);
      outlet = rendered.subOutlet;
    }
    signal.throwIfAborted();
    outlet?.clear();
    this.restoreScrollPositions(state);
    signal.throwIfAborted();
    this.currentState = state;
    this.rrCache.markUsedFor(state.id, prepared.routes, prepared.adopt);
    signal.throwIfAborted();
    this.transientStacksByEntry.set(state.id, []);
    this._setCurrentLocator(state.locator);
  }

  protected assertOutlet(outlet: OutletDelegate | undefined, route: Route<any>): asserts outlet is OutletDelegate {
    if (outlet === undefined) {
      const slugPath = getSlugPath(this.sitemap, route)!;
      const slugPathStr = slugPathToString(slugPath);
      throw new Error(`Cant render ${slugPathStr}: no outlet!`);
    }
  }

}
