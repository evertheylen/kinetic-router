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

  attach(handlers: EngineHandlers) {
    this.handlers = handlers;

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

      const fromId = window.navigation.currentEntry!.id;

      event.intercept({
        handler() {
          // major WTF: event.destination is different before the handler!
          //console.debug(`Intercepting ${event.navigationType} navigation `, event);
          const committedId = window.navigation.currentEntry!.id;

          return handlers.handleNavigate({
            navigationType: event.navigationType as 'push' | 'replace' | 'traverse',
            fromId,
            committedId,
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

    res.committed?.then(entry => {
      entry.addEventListener('dispose', () => {
        this.handlers?.handleDispose(entry.id);
      });
    });

    return res;
  }
}
