import { createComponent, createContext, createMemo, createSignal, flatten, onCleanup, runWithOwner, untrack } from "solid-js";

import { Route } from "@kinetic-router/definition/routes.js";

import { Page, PageStatus } from "./page.js";
import { ParamStorage } from "./params.js";
import type { OutletDelegate } from "./outlet.js";


export type RenderedRoute = {
  route: Route,
  implementation: Page<any, any, any>,
  renderArgs: {
    params: ParamStorage,
    pageStatus: PageStatus,
  }
  renderOutput?: {html: Node, title: string },
  lifecycle: ReturnType<typeof createPageLifecycle>,
  subOutlet: OutletDelegate | undefined;
};

export const InRenderedRoute = createContext<RenderedRoute | null>(null);

export type RenderArgs = {
  params: ParamStorage,
};

type PageLifecycleState = 'preparing' | 'retained' | 'active' | 'disposed';

/** Owned by one rendered instance. Independent signals keep focus/visibility
 * changes from invalidating resources that only track their fetch signal. */
export function createPageLifecycle() {
  let controller: AbortController | undefined = new AbortController();
  let state: PageLifecycleState = 'preparing';
  let focused = false;
  let requests = 0;
  // Cancellation can dispose this owner while its renderer is executing.
  const options = { ownedWrite: true };
  const [fetchSignal, setFetchSignal] = createSignal<AbortSignal | undefined>(controller.signal, options);
  const [isVisible, setVisible] = createSignal(false, options);
  const [hasFocus, setFocus] = createSignal(false, options);
  const update = () => {
    const previous = controller;
    const fetching = state !== 'disposed' && (state === 'preparing' || state === 'active' || requests > 0);
    controller = fetching ? controller ?? new AbortController() : undefined;
    setFetchSignal(controller?.signal);
    setVisible(state === 'active');
    setFocus(state === 'active' && focused);
    // Publish all state before abort callbacks can re-enter the router.
    if (controller !== previous) previous?.abort();
  };
  const setState = (next: PageLifecycleState, focus = false) => {
    if (state === 'disposed') return;
    state = next;
    focused = focus;
    update();
  };
  const requestFetch = () => {
    requests++;
    update();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      requests--;
      update();
    };
  };
  onCleanup(() => setState('disposed'));
  const status: PageStatus = {
    shouldFetch: () => fetchSignal() !== undefined,
    fetchSignal, isVisible, hasFocus,
    isAnimating: () => false,
  };
  return { status, setState, requestFetch };
}

export async function renderRoute({ route, implementation, renderArgs, signal }: {
    route: Route<any>,
    implementation: Page<any, any, any>,
    renderArgs: RenderArgs,
    signal: AbortSignal,
  }): Promise<RenderedRoute> {
    const { owner, dispose } = renderArgs.params;
    signal.addEventListener('abort', dispose, { once: true });
    try {
      signal.throwIfAborted();
      const lifecycle = runWithOwner(owner, createPageLifecycle);
      const pageStatus = lifecycle.status;
      const renderFunc = await runWithOwner(owner, () => implementation.render(
        renderArgs.params.untrackedObject, { signal, pageStatus },
      ));
      // Arbitrary application promises may finish after cancellation disposed us.
      signal.throwIfAborted();

      const res: RenderedRoute = {
        route,
        implementation,
        renderArgs: { ...renderArgs, pageStatus },
        lifecycle,
        subOutlet: undefined,  // to be set later
      };

      runWithOwner(owner, () => {
        // Use the public context provider: owner internals are mangled in production.
        const content = createComponent(InRenderedRoute, {
          value: res,
          get children() {
            return untrack(() => {
              let output = renderFunc(renderArgs.params.reactiveProxyObject, pageStatus);
              while (typeof output === 'function') {
                output = output();
              }
              while (typeof output.html === 'function') {
                output.html = output.html();
              }
              res.renderOutput = output;
              return output.html;
            });
          },
        });
        // A non-lazy memo keeps the provider observed for the page's lifetime.
        // Read it now so renderer errors reject construction synchronously.
        createMemo(() => flatten(content))();
      });

      // Application callbacks can cancel construction synchronously too.
      signal.throwIfAborted();
      return res;
    } catch (error) {
      dispose();
      throw error;
    } finally {
      signal.removeEventListener('abort', dispose);
    }
  }

