import { isEqual } from '@dovetail-js/utils/equal.js';
import type { AppState } from './app-state.js';
import type { PreparedNavigation } from './actual-router.js';

export type PrefetchCacheOptions = {
  maxEntries?: number,
  retainFor?: number,
};

/** Internal consumer ownership. Immediate release bypasses this consumer's grace
 * period (configuration changes, navigation cancellation, or teardown). */
export type PreparationLease = {
  ready: Promise<PreparedNavigation>,
  release(immediate?: boolean): void,
  discard(): void,
};

type Preparation = {
  state: AppState,
  entryId: string | undefined,
  controller: AbortController,
  consumers: Set<() => void>,
  ready: Promise<PreparedNavigation>,
  output?: PreparedNavigation,
};

/** Unused completed output only; history ownership lives in RenderedRouteCache.
 * Map insertion order is the unused-instance LRU, refreshed on last release. */
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
    build: (signal: AbortSignal) => Promise<PreparedNavigation>, cancelDelay = 0,
  ): PreparationLease | undefined {
    if (this.disposed) return;
    if (!Number.isFinite(cancelDelay) || cancelDelay < 0) {
      throw new RangeError('cancelDelay must be finite and non-negative');
    }
    let entry = this.find(state, entryId);
    if (!entry) {
      entry = {
        state, entryId, controller: new AbortController(), consumers: new Set(),
        ready: undefined!,
      };
      const created = entry;
      this.entries.add(created);
      created.ready = Promise.resolve().then(() => {
        created.controller.signal.throwIfAborted();
        return build(created.controller.signal);
      }).then(output => {
        if (!this.entries.has(created)) {
          output.dispose();
          created.controller.signal.throwIfAborted();
        }
        created.output = {
          ...output,
          adopt: () => {
            output.adopt();
            this.forget(created);
          },
        };
        return created.output;
      }).catch(error => {
        this.remove(created);
        throw error;
      });
      // Speculative consumers need not await failures; later requests retry.
      void created.ready.catch(() => {});
    }
    return this.join(entry, cancelDelay);
  }

  claim(state: AppState, entryId: string | undefined): PreparationLease | undefined {
    if (this.disposed) return;
    const entry = this.find(state, entryId);
    return entry && this.join(entry, 0);
  }

  private find(state: AppState, entryId: string | undefined) {
    return [...this.entries].find(entry => entry.entryId === entryId
      && entry.state.route === state.route
      && [...state.paramsByDefinition].every(([pd, value]) => isEqual(entry.state.paramsByDefinition.get(pd), value)));
  }

  private join(entry: Preparation, cancelDelay: number): PreparationLease {
    clearTimeout(this.unused.get(entry));
    this.unused.delete(entry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let released = false;
    const drop = () => {
      clearTimeout(timer);
      if (!entry.consumers.delete(drop) || !this.entries.has(entry)) return;
      if (entry.consumers.size === 0) this.idle(entry);
    };
    entry.consumers.add(drop);
    for (const rendered of entry.output?.routes.slice(entry.output.reusedCount) ?? []) {
      rendered.lifecycle.setState('preparing');
    }
    return {
      ready: entry.ready,
      release: (immediate = false) => {
        if (immediate) { released = true; drop(); }
        else if (!released) {
          released = true;
          if (cancelDelay === 0) drop();
          else timer = setTimeout(drop, cancelDelay);
        }
      },
      discard: () => this.remove(entry),
    };
  }

  private idle(entry: Preparation) {
    if (!entry.output || this.maxEntries === 0 || this.retainFor === 0) {
      this.remove(entry);
      return;
    }
    // Record ownership before abort callbacks can reacquire/navigate.
    this.unused.set(entry, setTimeout(() => this.remove(entry), this.retainFor));
    for (const rendered of entry.output.routes.slice(entry.output.reusedCount)) {
      if (!this.unused.has(entry)) break;
      rendered.lifecycle.setState('retained');
    }
    while (this.unused.size > this.maxEntries) this.remove(this.unused.keys().next().value!);
  }

  private forget(entry: Preparation) {
    this.entries.delete(entry);
    clearTimeout(this.unused.get(entry));
    this.unused.delete(entry);
    for (const drop of entry.consumers) drop();
  }

  private remove(entry: Preparation) {
    if (!this.entries.has(entry)) return;
    this.forget(entry);
    entry.controller.abort();
    entry.output?.dispose();
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries) this.remove(entry);
  }
}
