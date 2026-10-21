import type { AppState } from './app-state.js';
import type { PreparedNavigation } from './actual-router.js';
import type { PreparationLease, PreparationRegistry } from './preparation-registry.js';
import type { RenderedRoute } from './rendered-route.js';
import { reusableRoutes } from './diff.js';

export type NavigationTransitionOptions = {
  signal?: AbortSignal,
  entryId?: string,
  forceNewInstance?: boolean,
};

/** One rendering attempt, not a history commit. Cancelling releases only this
 * navigation's preparation interest; other consumers can keep shared work alive. */
export class NavigationTransition {
  readonly to: AppState;
  readonly signal: AbortSignal;
  readonly reused: readonly RenderedRoute[];
  private readonly options: NavigationTransitionOptions;
  private readonly controller = new AbortController();
  private lease: PreparationLease | undefined;
  // Shared output belongs to the registry; only direct construction is ours to dispose.
  private ownedPreparation: PreparedNavigation | undefined;
  private release = () => {
    const lease = this.lease;
    this.lease = undefined;
    lease?.release();
  };

  constructor(from: readonly RenderedRoute[], to: AppState, options: NavigationTransitionOptions = {}) {
    this.to = to;
    this.options = { ...options };
    this.reused = reusableRoutes(from, to, options.forceNewInstance);
    this.signal = options.signal ? AbortSignal.any([this.controller.signal, options.signal]) : this.controller.signal;
    this.signal.addEventListener('abort', this.release, { once: true });
  }

  /** Call once, then dispose in finally after preparation/activation settles. */
  async prepare(registry: PreparationRegistry, build: (
    reused: readonly RenderedRoute[], signal: AbortSignal,
  ) => Promise<PreparedNavigation>): Promise<PreparedNavigation> {
    const { signal, reused } = this;
    signal.throwIfAborted();
    this.lease = !this.options.forceNewInstance ? registry.acquire(this.to, this.options.entryId,
      requestSignal => build(reused, requestSignal),
    ) : undefined;
    signal.throwIfAborted();
    const lease = this.lease;
    if (lease) {
      const candidate = await lease.ready;
      signal.throwIfAborted();
      // Owners/frames cannot be reparented: the prepared suffix must have been
      // constructed under the exact ancestors this navigation will reuse.
      if (candidate.reusedCount === reused.length
        && reused.every((route, i) => candidate.routes[i] === route)) {
        return candidate;
      }
      this.lease = undefined;
      lease.discard();
    }
    // Discarding incompatible output can run cleanup that cancels this attempt.
    signal.throwIfAborted();
    this.ownedPreparation = await build(reused, signal);
    signal.throwIfAborted();
    return this.ownedPreparation;
  }

  abort() {
    this.controller.abort();
  }

  /** Release settled resources without marking a failure as cancellation.
   * Use abort() to interrupt in-flight work. */
  dispose() {
    this.signal.removeEventListener('abort', this.release);
    const prepared = this.ownedPreparation;
    this.ownedPreparation = undefined;
    this.release();
    prepared?.dispose();
  }
}
