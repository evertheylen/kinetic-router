import {
  EngineHandlers,
  EngineNavigationResult,
  EngineEntry,
  NavigationEngine,
  NavigationInfo,
  NavigationIntent,
} from "./navigation-engine.js";

/** The default browser engine, backed by the W3C Navigation API
 * (`window.navigation`). */
export class NavigationApiEngine implements NavigationEngine {
  protected handlers: EngineHandlers | undefined;

  /** Entries we already attached a `dispose` listener to. */
  protected watchedEntries = new WeakSet<NavigationHistoryEntry>();

  attach(handlers: EngineHandlers) {
    if (this.handlers !== undefined) throw new Error('NavigationApiEngine is already attached');
    this.handlers = handlers;

    // watch pre-existing entries (session restore) for disposal
    for (const entry of window.navigation.entries()) {
      this.watchDispose(entry);
    }

    window.navigation.addEventListener("navigate", (event) => {
      if (!event.canIntercept) {
        console.warn('Cannot intercept navigation', event);
        return;
      }

      if (event.navigationType === 'reload') {
        console.warn('Reloads not currently handled', event);
        return;
      }

      const info = (event.info ?? {}) as NavigationInfo;
      if (info.ignore) {
        event.intercept();
        return;
      }

      // the listener runs pre-commit: the outgoing entry is still current
      handlers.handleBeforeCommit?.();

      const fromId = window.navigation.currentEntry!.id;

      event.intercept({
        handler: async () => {
          // Read the final identity after commit, not from the pre-commit destination.
          const committedEntry = window.navigation.currentEntry!;

          // entries minted by link clicks / traversals never pass through
          // navigate(); watch them here so handleDispose fires for them too
          this.watchDispose(committedEntry);

          try {
            await handlers.handleNavigate({
              navigationType: event.navigationType as 'push' | 'replace' | 'traverse',
              signal: event.signal,
              fromId,
              committedId: committedEntry.id,
              destination: committedEntry,
              info,
            });
          } catch (error) {
            // Cancellation belongs to this event, not to an error's name. A
            // page throwing AbortError without navigation cancellation is a failure.
            if (!event.signal.aborted) console.error('Navigation failed', error);
            throw error;
          }
        },
      });
    });

  }

  currentEntry(): EngineEntry | undefined {
    return window.navigation.currentEntry ?? undefined;
  }

  entries(): readonly EngineEntry[] {
    return window.navigation.entries();
  }

  traverseTo(key: string, info?: NavigationInfo): EngineNavigationResult {
    return window.navigation.traverseTo(key, { info });
  }

  updateCurrentEntry(state: unknown) {
    window.navigation.updateCurrentEntry({ state });
  }

  navigate(intent: NavigationIntent): EngineNavigationResult {
    const res = window.navigation.navigate(intent.url, {
      state: intent.state,
      history: intent.history,
      info: intent.info,
    });

    // Covers `ignore` navigations, which bypass interception. Observe rejection
    // too, so this listener cannot orphan a rejected promise; callers keep res.
    void res.committed?.then(entry => this.watchDispose(entry), () => {});

    return res;
  }

  protected watchDispose(entry: NavigationHistoryEntry) {
    if (this.watchedEntries.has(entry)) return;
    this.watchedEntries.add(entry);

    entry.addEventListener('dispose', () => {
      this.handlers?.handleDispose(entry.id);
    });
  }
}
