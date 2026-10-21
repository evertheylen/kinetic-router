import {
  EngineHandlers,
  EngineNavigationResult,
  EngineEntry,
  NavigationEngine,
  NavigationInfo,
  NavigationIntent,
} from "./navigation-engine.js";

export type MemoryEntry = {
  readonly id: string,
  readonly key: string,
  url: string,
  state: unknown,
};

/** An in-memory history stack. Useful for headless testing and tooling; also
 * the reference implementation for NavigationEngine semantics. */
export class MemoryEngine implements NavigationEngine {
  protected handlers: EngineHandlers | undefined;
  protected attachment: symbol | undefined;
  protected stack: MemoryEntry[];
  protected index = 0;
  protected nextId = 0;
  protected navigationController: AbortController | undefined;

  constructor(initialUrl: string = '/') {
    const id = this.mintId();
    this.stack = [{ id, key: `key:${id}`, url: initialUrl, state: undefined }];
  }

  /** The full history stack, for inspection in tests/tooling. */
  entries(): ReadonlyArray<Readonly<MemoryEntry> & EngineEntry> {
    return this.stack.map((entry, index) => ({
      ...entry, index, getState: () => entry.state,
    }));
  }

  currentIndex() {
    return this.index;
  }

  attach(handlers: EngineHandlers) {
    if (this.handlers !== undefined) {
      throw new Error('MemoryEngine is already attached');
    }
    this.handlers = handlers;
    const attachment = this.attachment = Symbol();
    return () => {
      if (this.attachment !== attachment) return;
      const controller = this.navigationController;
      this.handlers = undefined;
      this.attachment = undefined;
      this.navigationController = undefined;
      controller?.abort();
    };
  }

  currentEntry(): EngineEntry {
    return this.toSource(this.stack[this.index]);
  }

  updateCurrentEntry(state: unknown) {
    this.stack[this.index].state = state;
  }

  navigate(intent: NavigationIntent): EngineNavigationResult {
    const handlers = this.requireHandlers();
    const from = this.stack[this.index];
    const id = this.mintId();
    const entry: MemoryEntry = {
      id, key: intent.history === 'replace' ? from.key : `key:${id}`,
      url: intent.url, state: intent.state,
    };

    if (!intent.info?.ignore) {
      // pre-commit: the outgoing entry is still current
      handlers.handleBeforeCommit?.();
    }

    const pruned: MemoryEntry[] = [];
    if (intent.history === 'replace') {
      pruned.push(this.stack[this.index]);
      this.stack[this.index] = entry;
    } else {
      // pushing prunes any forward entries
      pruned.push(...this.stack.splice(this.index + 1));
      this.stack.push(entry);
      this.index++;
    }

    const info = intent.info ?? {};
    const committed = Promise.resolve(entry);
    const signal = this.beginNavigation();

    let finished: Promise<unknown>;
    if (info.ignore) {
      finished = committed;
    } else {
      finished = handlers.handleNavigate({
        navigationType: intent.history,
        signal,
        fromId: from.id,
        committedId: entry.id,
        destination: this.toSource(entry),
        info,
      });
    }

    this.disposeAfter(finished, pruned);
    return { committed, finished };
  }

  /** Traverse the existing stack by delta (back: -1, forward: +1),
   * like the back/forward browser buttons or a native pop. */
  traverse(delta: number): EngineNavigationResult {
    const targetIndex = this.index + delta;
    const target = this.stack[targetIndex];
    if (target === undefined) {
      throw new Error(`Cannot traverse by ${delta}: no entry at index ${targetIndex}`);
    }
    return this.traverseTo(target.key);
  }

  traverseTo(key: string, info: NavigationInfo = {}): EngineNavigationResult {
    const handlers = this.requireHandlers();
    const from = this.stack[this.index];
    const targetIndex = this.stack.findIndex(entry => entry.key === key);
    const target = this.stack[targetIndex];
    if (target === undefined) throw new Error(`Cannot traverse to missing key ${key}`);
    if (targetIndex === this.index) {
      const committed = Promise.resolve(target);
      return { committed, finished: committed };
    }

    // pre-commit: the outgoing entry is still current
    if (!info.ignore) handlers.handleBeforeCommit?.();

    this.index = targetIndex;
    const committed = Promise.resolve(target);
    const signal = this.beginNavigation();
    const finished = info.ignore ? committed : handlers.handleNavigate({
      navigationType: 'traverse',
      signal,
      fromId: from.id,
      committedId: target.id,
      destination: this.toSource(target),
      info,
    });

    return { committed, finished };
  }

  back() {
    return this.traverse(-1);
  }

  forward() {
    return this.traverse(+1);
  }

  protected beginNavigation(): AbortSignal {
    const previous = this.navigationController;
    const controller = new AbortController();
    this.navigationController = controller;
    previous?.abort();
    return controller.signal;
  }

  protected mintId(): string {
    return `__memory__${this.nextId++}`;
  }

  protected toSource(entry: MemoryEntry): EngineEntry {
    // urls are stored as given (usually relative); parse them against a
    // dummy base so consumers get a uniform { pathname, search } shape
    const parsed = new URL(entry.url, 'memory://app');
    return {
      id: entry.id,
      key: entry.key,
      index: this.stack.indexOf(entry),
      url: { pathname: parsed.pathname, search: parsed.search },
      getState: () => entry.state,
    };
  }

  protected requireHandlers(): EngineHandlers {
    if (this.handlers === undefined) {
      throw new Error('MemoryEngine is not attached to a router yet');
    }
    return this.handlers;
  }

  /** Entries are disposed only after the triggering navigation finished
   * rendering, so rendered routes can be reused/migrated before disposal
   * (mirrors the Navigation API, which fires `dispose` asynchronously). */
  protected disposeAfter(finished: Promise<unknown>, entries: MemoryEntry[]) {
    if (entries.length === 0) return;

    const attachment = this.attachment;
    const dispose = () => {
      if (this.attachment !== attachment) return;
      for (const entry of entries) this.handlers?.handleDispose(entry.id);
    };

    void finished.then(dispose, dispose);
  }
}
