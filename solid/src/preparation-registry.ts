import { isEqual } from '@dovetail-js/utils/equal.js';
import type { AppState } from './app-state.js';
import type { PreparedNavigation } from './actual-router.js';

/** Retains completed, unused preparations separately from the history cache.
 * Either zero disables retention. Incomplete construction is cancelled instead
 * of retained; unused output is LRU-evicted after its last consumer releases it. */
export type PrefetchCacheOptions = {
  /** Maximum unused preparations; non-negative safe integer. Default: 3. */
  maxEntries?: number,
  /** Retention in finite, nonnegative milliseconds. Default: 30_000. */
  retainFor?: number,
};

/** One consumer's interest. Links manage their own cancellation grace period. */
export type PreparationLease = {
  ready: Promise<PreparedNavigation>,
  /** Pin existing work for another consumer; never restart removed work. */
  retain(): PreparationLease | undefined,
  release(): void,
  discard(): void,
};

type Preparation = {
  state: AppState,
  entryId: string | undefined,
  controller: AbortController,
  consumers: Set<() => void>,
  ready: Promise<PreparedNavigation>,
  output?: PreparedNavigation,
  adopted?: boolean,
};

/** Consumer interests are independent of history ownership. Only unused,
 * unadopted output enters the speculative LRU, refreshed on last release. */
export class PreparationRegistry {
  private disposed = false;
  private entries = new Set<Preparation>();
  private unused = new Map<Preparation, ReturnType<typeof setTimeout>>();
  readonly maxEntries: number;
  readonly retainFor: number;

  constructor(options: PrefetchCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 3;
    this.retainFor = options.retainFor ?? 30_000;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 0) {
      throw new RangeError('prefetchCache.maxEntries must be a non-negative safe integer');
    }
    if (!Number.isFinite(this.retainFor) || this.retainFor < 0) {
      throw new RangeError('prefetchCache.retainFor must be finite and non-negative');
    }
  }

  acquire(
    state: AppState, entryId: string | undefined,
    build: (signal: AbortSignal) => Promise<PreparedNavigation>,
  ): PreparationLease | undefined {
    if (this.disposed) return;
    let entry = this.find(state, entryId);
    if (!entry) {
      entry = {
        state, entryId, controller: new AbortController(), consumers: new Set(),
        ready: undefined!,
      };
      const created = entry;
      const construction = Promise.withResolvers<PreparedNavigation>();
      this.entries.add(created);
      created.ready = construction.promise.then(output => {
        if (!this.entries.has(created)) {
          output.dispose();
          created.controller.signal.throwIfAborted();
        }
        created.output = {
          ...output,
          adopt: () => {
            // Existing consumers keep their interest, but new navigations must
            // not claim output that now belongs to a particular history entry.
            created.adopted = true;
            output.adopt();
          },
        };
        return created.output;
      }).catch(error => {
        this.remove(created);
        throw error;
      });
      // Register ownership before construction can re-enter the Router. Start
      // synchronously so reused parents are pinned before history can dispose them.
      void created.ready.catch(() => {});
      const lease = this.join(created);
      try { construction.resolve(build(created.controller.signal)); }
      catch (error) { construction.reject(error); }
      return lease;
    }
    return this.join(entry);
  }

  claim(state: AppState, entryId: string | undefined): PreparationLease | undefined {
    if (this.disposed) return;
    const entry = this.find(state, entryId);
    return entry && this.join(entry);
  }

  private find(state: AppState, entryId: string | undefined) {
    return [...this.entries].find(entry => !entry.adopted && entry.entryId === entryId
      && entry.state.route === state.route
      && [...state.paramsByDefinition].every(([pd, value]) => isEqual(entry.state.paramsByDefinition.get(pd), value)));
  }

  private join(entry: Preparation): PreparationLease {
    clearTimeout(this.unused.get(entry));
    this.unused.delete(entry);
    const drop = () => {
      if (!entry.consumers.delete(drop) || !this.entries.has(entry)) return;
      if (entry.consumers.size === 0) this.idle(entry);
    };
    entry.consumers.add(drop);
    entry.output?.setRequested(true);
    return {
      ready: entry.ready,
      retain: () => !this.disposed && this.entries.has(entry) ? this.join(entry) : undefined,
      release: drop,
      discard: () => this.remove(entry),
    };
  }

  private idle(entry: Preparation) {
    if (entry.adopted || !entry.output || this.maxEntries === 0 || this.retainFor === 0) {
      this.remove(entry);
      return;
    }
    // Record ownership before abort callbacks can reacquire/navigate.
    this.unused.set(entry, setTimeout(() => this.remove(entry), this.retainFor));
    entry.output.setRequested(false);
    while (this.unused.size > this.maxEntries) this.remove(this.unused.keys().next().value!);
  }

  private remove(entry: Preparation) {
    if (!this.entries.delete(entry)) return;
    clearTimeout(this.unused.get(entry));
    this.unused.delete(entry);
    for (const drop of entry.consumers) drop();
    entry.controller.abort();
    entry.output?.dispose();
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries) this.remove(entry);
  }
}
