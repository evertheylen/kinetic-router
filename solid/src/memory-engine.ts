import {
  EngineHandlers,
  EngineNavigationResult,
  EntrySource,
  NavigationEngine,
  NavigationInfo,
  NavigationIntent,
} from "./navigation-engine.js";

export type MemoryEntry = {
  readonly id: string,
  url: string,
  state: unknown,
};

/** An in-memory history stack. Useful for headless testing and tooling; also
 * the reference implementation for NavigationEngine semantics. */
export class MemoryEngine implements NavigationEngine {
  protected handlers: EngineHandlers | undefined;
  protected stack: MemoryEntry[];
  protected index = 0;
  protected nextId = 0;

  constructor(initialUrl: string = '/') {
    this.stack = [{ id: this.mintId(), url: initialUrl, state: undefined }];
  }

  /** The full history stack, for inspection in tests/tooling. */
  entries(): ReadonlyArray<Readonly<MemoryEntry>> {
    return this.stack;
  }

  currentIndex() {
    return this.index;
  }

  attach(handlers: EngineHandlers) {
    if (this.handlers !== undefined) {
      throw new Error('MemoryEngine is already attached');
    }
    this.handlers = handlers;
  }

  currentEntry(): EntrySource {
    return this.toSource(this.stack[this.index]);
  }

  updateCurrentEntry(state: unknown) {
    this.stack[this.index].state = state;
  }

  navigate(intent: NavigationIntent): EngineNavigationResult {
    const handlers = this.requireHandlers();
    const from = this.stack[this.index];
    const entry: MemoryEntry = { id: this.mintId(), url: intent.url, state: intent.state };

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

    let finished: Promise<unknown>;
    if (info.ignore) {
      finished = committed;
    } else {
      finished = handlers.handleNavigate({
        navigationType: intent.history,
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
    const handlers = this.requireHandlers();
    const from = this.stack[this.index];
    const targetIndex = this.index + delta;
    const target = this.stack[targetIndex];

    if (target === undefined) {
      throw new Error(`Cannot traverse by ${delta}: no entry at index ${targetIndex}`);
    }

    this.index = targetIndex;

    const finished = handlers.handleNavigate({
      navigationType: 'traverse',
      fromId: from.id,
      committedId: target.id,
      destination: this.toSource(target),
      info: {},
    });

    return { committed: Promise.resolve(target), finished };
  }

  back() {
    return this.traverse(-1);
  }

  forward() {
    return this.traverse(+1);
  }

  protected mintId(): string {
    return `__memory__${this.nextId++}`;
  }

  protected toSource(entry: MemoryEntry): EntrySource {
    // urls are stored as given (usually relative); parse them against a
    // dummy base so consumers get a uniform { pathname, search } shape
    const parsed = new URL(entry.url, 'memory://app');
    return {
      id: entry.id,
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

    const dispose = () => {
      for (const entry of entries) {
        this.handlers?.handleDispose(entry.id);
      }
    };

    void finished.then(dispose, dispose);
  }
}
