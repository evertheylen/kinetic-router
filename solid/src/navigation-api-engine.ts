import {
  EngineHandlers,
  EngineNavigationResult,
  EntrySource,
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

      //printNavigationState();

      // the listener runs pre-commit: the outgoing entry is still current
      handlers.handleBeforeCommit?.();

      const fromId = window.navigation.currentEntry!.id;
      const watchDispose = (entry: NavigationHistoryEntry) => this.watchDispose(entry);

      event.intercept({
        handler() {
          // major WTF: event.destination is different before the handler!
          //console.debug(`Intercepting ${event.navigationType} navigation `, event);
          const committedEntry = window.navigation.currentEntry!;

          // entries minted by link clicks / traversals never pass through
          // navigate(); watch them here so handleDispose fires for them too
          watchDispose(committedEntry);

          return handlers.handleNavigate({
            navigationType: event.navigationType as 'push' | 'replace' | 'traverse',
            fromId,
            committedId: committedEntry.id,
            destination: event.destination,
            info,
          });
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

  currentEntry(): EntrySource | undefined {
    return window.navigation.currentEntry ?? undefined;
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

    // covers `ignore` navigations, which bypass the intercept handler
    res.committed?.then(entry => this.watchDispose(entry));

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
