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
  protected attachment: AbortController | undefined;

  /** Entries we already attached a `dispose` listener to. */
  protected watchedEntries = new WeakSet<NavigationHistoryEntry>();

  attach(handlers: EngineHandlers) {
    if (this.handlers !== undefined) throw new Error('NavigationApiEngine is already attached');
    this.handlers = handlers;
    const attachment = this.attachment = new AbortController();

    // watch pre-existing entries (session restore) for disposal
    for (const entry of window.navigation.entries()) {
      this.watchDispose(entry);
    }

    window.navigation.addEventListener("navigate", (event) => {
      // Downloads have a native default action, not an in-app destination.
      if (event.downloadRequest != null) return;
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
      if (handlers.shouldIntercept?.(event.destination) === false) return;
      const presentation = handlers.handleBeforeCommit?.({
        navigationType: event.navigationType, destination: event.destination, info,
      });

      const fromId = window.navigation.currentEntry!.id;

      event.intercept({
        ...(presentation?.preservePresentation ? { focusReset: 'manual' as const, scroll: 'manual' as const } : {}),
        handler: async () => {
          attachment.signal.throwIfAborted();
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
            if (!event.signal.aborted && !attachment.signal.aborted) console.error('Navigation failed', error);
            throw error;
          }
        },
      });
    }, { signal: attachment.signal });

    return () => {
      if (this.attachment !== attachment) return;
      this.handlers = undefined;
      this.attachment = undefined;
      this.watchedEntries = new WeakSet();
      attachment.abort();
    };
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
    const attachment = this.attachment;
    void res.committed?.then(entry => {
      if (this.attachment === attachment) this.watchDispose(entry);
    }, () => {});

    return res;
  }

  protected watchDispose(entry: NavigationHistoryEntry) {
    const attachment = this.attachment;
    if (!attachment || this.watchedEntries.has(entry)) return;
    this.watchedEntries.add(entry);

    entry.addEventListener('dispose', () => {
      this.handlers?.handleDispose(entry.id);
    }, { signal: attachment.signal });
  }
}
