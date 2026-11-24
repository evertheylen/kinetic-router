import type { OutletDelegate } from './outlet.js';
import type { RenderedRoute } from './rendered-route.js';
import type { RenderedRouteCache } from './rendered-route-cache.js';

type Outgoing = {
  readonly routes: readonly RenderedRoute[];
  readonly depth: number;
  finish(keepElement?: boolean): void;
  release(): void;
};

/** Live slot changes are measured against the displayed stack, not the stack
 * that provided reusable owners for Back/Forward or speculative construction. */
export class RoutePresentation {
  private readonly outgoing = new Map<RenderedRoute, Outgoing>();
  private readonly cache: RenderedRouteCache;
  private disposed = false;

  constructor(cache: RenderedRouteCache) {
    this.cache = cache;
  }

  mount(root: OutletDelegate, incoming: readonly RenderedRoute[], signal: AbortSignal): (committed: boolean) => void {
    const displayed = this.cache.currentRoutes();
    let depth = 0;
    while (depth < displayed.length && displayed[depth] === incoming[depth]) depth++;
    const leaving = displayed[depth];
    const entering = incoming[depth];
    const changedOutlet = depth === 0 ? root : incoming[depth - 1].subOutlet;
    let exit: Outgoing | undefined;
    let resumed: Outgoing | undefined;
    const rollback = () => {
      if (exit) this.retire(leaving, exit, displayed, !this.disposed);
      if (this.disposed) return;
      if (resumed) {
        // The earlier exit is already retired. Detach and park the views that
        // would have returned, so they can be presented on a later navigation.
        const node = entering.renderOutput!.html;
        node.parentNode?.removeChild(node);
        for (const page of resumed.routes.slice(resumed.depth).reverse()) {
          if (incoming.includes(page)) page.lifecycle.presence.park();
        }
      }
      if (this.disposed) return;
      // A successor may wait or fail. Restore the last activated page now,
      // without presenting it again or relying on that successor to repair DOM.
      if (leaving) changedOutlet!.setElement(leaving.renderOutput!.html);
      else if (entering) changedOutlet!.clear();
    };
    const enteringSlots: { page: RenderedRoute, animate: boolean }[] = [];
    try {
      signal.throwIfAborted();

      if (leaving) {
        // The departing ancestor alone owns the new exit. Do not keep independent
        // child exits inside it, or let their completion retain the ancestor.
        for (const [page, childExit] of this.outgoing) {
          if (childExit.routes.includes(leaving)) this.retire(page, childExit);
          signal.throwIfAborted();
        }
        if (changedOutlet?.retainExit && leaving.lifecycle.presence.hasExitWork) {
          const release = this.cache.pin(displayed);
          try {
            const finish = changedOutlet.retainExit(leaving.renderOutput!.html);
            exit = { routes: displayed, depth, release, finish };
            this.outgoing.set(leaving, exit);
          } catch (error) {
            release();
            throw error;
          }
        }
      }
      signal.throwIfAborted();

      // Invalidate the earlier exit before returning its node to normal layout.
      // The incoming construction pin protects the views that are returning.
      resumed = entering && this.outgoing.get(entering);
      if (resumed) this.retire(entering, resumed, incoming, true);

      // Install only the changed suffix. Reused layouts are already live;
      // even a custom outlet must not reinsert them on child navigation.
      let outlet = changedOutlet;
      for (let index = depth; index < incoming.length; index++) {
        signal.throwIfAborted();
        const page = incoming[index];
        outlet!.setElement(page.renderOutput!.html);
        enteringSlots.push({ page, animate: outlet!.retainExit !== undefined });
        outlet = page.subOutlet;
      }
      signal.throwIfAborted();
      outlet?.clear();
    } catch (error) {
      rollback();
      throw error;
    }

    // Apply after ownership transfers. Animation work must not delay the
    // navigation result, and a completed exit can release its pin immediately.
    return committed => {
      if (!committed) return rollback();
      if (exit && this.outgoing.get(leaving) === exit) {
        // Descendants stay legible inside the outgoing subtree; only the
        // receiving slot's page participates in its ancestor's exit.
        for (const page of displayed.slice(depth + 1)) page.lifecycle.presence.present(false);
        const record = exit;
        leaving.lifecycle.presence.exit(() => this.retire(leaving, record));
      } else if (!exit) {
        for (const page of displayed.slice(depth).reverse()) page.lifecycle.presence.park();
      }
      for (const { page, animate } of enteringSlots) page.lifecycle.presence.present(animate);
    };
  }

  dispose() {
    this.disposed = true;
    for (const [page, exit] of this.outgoing) this.retire(page, exit, exit.routes);
  }

  private retire(page: RenderedRoute, exit: Outgoing, returning: readonly RenderedRoute[] = [], keepElement = false) {
    if (this.outgoing.get(page) !== exit) return; // Stale completion after reentry.
    this.outgoing.delete(page);
    try {
      exit.finish(keepElement);
      const parked = exit.routes.slice(exit.depth).filter(rendered => !returning.includes(rendered));
      if (keepElement && parked.length) {
        // A returning layout can restore a different cached child. Detach the
        // old suffix before its adapters reprepare, even though the layout stays.
        const node = parked[0].renderOutput!.html;
        node.parentNode?.removeChild(node);
      }
      for (const rendered of parked.reverse()) rendered.lifecycle.presence.park();
    } finally {
      exit.release();
    }
  }
}
