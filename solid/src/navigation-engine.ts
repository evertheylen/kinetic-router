// The NavigationEngine abstracts the history layer away from ActualRouter.
//
// Implementations:
//   - NavigationApiEngine: the default browser engine, backed by the W3C
//     Navigation API (`window.navigation`).
//   - MemoryEngine: an in-memory stack, used for headless testing/tooling.
//   - NativeBridgeEngine (planned, see ios-plan.md): forwards navigation
//     intents to a native shell which owns the history stack.
//
// The engine owns the history stack (entries, current index, entry ids and
// their serialized states). The router owns everything else: resolving URLs
// and states to routes, rendering, and caching rendered routes by entry id.

/** Extra, non-persistent information attached to a single navigation. */
export type NavigationInfo = {
  /** Force a full re-render of the leaf route even if it could be reused. */
  forceNewInstance?: boolean,

  /** Commit the history change, but don't render anything. Engines must
   * swallow navigations carrying this flag instead of reporting them via
   * `handleNavigate`. */
  ignore?: boolean
};

/** A structural view on a history entry, just enough for the router to
 * reconstruct an AppState from the best available source of information.
 * Both NavigationHistoryEntry and NavigationDestination satisfy this shape.
 * `url` is either an absolute URL string or an already-parsed path+search. */
export type EntrySource = {
  readonly id?: string | null,
  readonly url?: { pathname: string, search: string } | string | null,
  getState?(): unknown,
};

/** A programmatic navigation request from the router to the engine. */
export type NavigationIntent = {
  url: string,
  /** Serialized AppState to attach to the new entry. */
  state: unknown,
  history: 'push' | 'replace',
  info?: NavigationInfo,
};

/** A navigation observed by the engine (programmatic, link click, or
 * traverse), reported to the router for rendering. */
export type EngineNavigateEvent = {
  navigationType: 'push' | 'replace' | 'traverse',

  /** Id of the entry that was current *before* this navigation committed.
   * Used as the cache id for reusing rendered routes. */
  fromId: string | undefined,

  /** Id of the entry that is current now that the navigation committed.
   * For 'push'/'replace' this is the engine-assigned id of the new entry. */
  committedId: string,

  /** The entry being navigated to. Read lazily, after commit. */
  destination: EntrySource,

  info: NavigationInfo,
};

export type EngineHandlers = {
  /** Render the destination. The returned promise resolves when rendering
   * is complete (used for navigation success/failure reporting). */
  handleNavigate(event: EngineNavigateEvent): Promise<void>,

  /** An entry left the history stack permanently; the router disposes any
   * rendered routes cached under this id. */
  handleDispose(entryId: string): void,

  /** Called right *before* a navigation commits, while the outgoing entry is
   * still the engine's current entry. The router uses this to persist
   * transient page state (scroll positions) onto the outgoing entry via
   * `updateCurrentEntry` — the only moment this is possible, since the
   * Navigation API can only update the *current* entry. Engines must not
   * call this for `ignore` navigations. */
  handleBeforeCommit?(): void,
};

/** What `NavigationEngine.navigate` returns. The Navigation API's
 * NavigationResult satisfies this shape. */
export type EngineNavigationResult = {
  committed?: Promise<{ readonly id: string, readonly url?: string | null }>,
  finished?: Promise<unknown>,
};

export interface NavigationEngine {
  /** Called exactly once by the router, before any navigation is observed. */
  attach(handlers: EngineHandlers): void;

  currentEntry(): EntrySource | undefined;

  /** Attach a new serialized state to the current entry, without navigating. */
  updateCurrentEntry(state: unknown): void;

  navigate(intent: NavigationIntent): EngineNavigationResult;

  /** Optional: notified whenever the leaf page's title changes (reactively or
   * on render). Used by engines that mirror the title to a host environment
   * (e.g. the native shell's navigation bar). */
  titleChanged?(title: string): void;
}
