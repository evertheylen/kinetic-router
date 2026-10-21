import { RenderedRoute } from "./rendered-route.js";

/** LRU of complete history-entry stacks, oldest first. Keeping whole stacks
 * ensures a cached child always keeps its rendered ancestors alive. The budget
 * bounds both distinct rendered instances and retained entry indexes; shared
 * ancestors count once and visible output is exempt. Successful renders refresh
 * recency and enforce the budget without timers; incoming/outgoing stacks can
 * coexist while rendering. Dispose only after all ownership pins are released. */
export class RenderedRouteCache {
  readonly cache = new Map<string, readonly RenderedRoute[]>();
  readonly maxPages: number;

  // A replaced entry can be disposed before its successor finishes rendering.
  // Keep the displayed stack alive until markUsedFor installs its replacement.
  protected current: readonly RenderedRoute[] = [];
  protected rendering = new Set<readonly RenderedRoute[]>();

  constructor(maxPages = 10) {
    if (!Number.isSafeInteger(maxPages) || maxPages < 0) {
      throw new RangeError('maxCachedPages must be a non-negative safe integer');
    }
    this.maxPages = maxPages;
  }

  get(id: string): readonly RenderedRoute[] | undefined {
    return this.cache.get(id);
  }

  /** Displayed output can outlive its entry index during pending navigation. */
  currentRoutes(): readonly RenderedRoute[] {
    return this.current;
  }

  /** A source entry may disappear while its ancestors are being reused. */
  retainForRender(routes: readonly RenderedRoute[]): () => void {
    const stack = [...routes];
    this.rendering.add(stack);
    return () => {
      if (this.rendering.delete(stack)) this.disposeUnused(new Set(stack));
    };
  }

  /** Called after a successful render; completing a navigation refreshes LRU. */
  markUsedFor(id: string, renderedRoutes: readonly RenderedRoute[], adoptConstruction?: () => void) {
    const previous = this.pages();
    this.current = [...renderedRoutes];
    this.cache.delete(id);
    this.cache.set(id, this.current);
    // Incoming routes become fetch-active before preparation releases its pins.
    // This does not abort resources and keeps their signal stable on adoption.
    for (const rendered of this.current) {
      rendered.lifecycle.setState('active', rendered === this.current.at(-1));
    }
    // Transfer ownership before lifecycle abort/cleanup callbacks can navigate.
    adoptConstruction?.();

    for (const entryId of this.cache.keys()) {
      // Construction pins protect ownership, but don't consume the history budget.
      // The visible stack is the newest entry and must never be evicted.
      if (this.cache.size === 1 || (
        this.cache.size <= this.maxPages && new Set([...this.cache.values()].flat()).size <= this.maxPages
      )) break;
      this.cache.delete(entryId);
    }

    const active = new Set(this.current);
    for (const rendered of previous) {
      if (!active.has(rendered)) rendered.lifecycle.setState('retained');
    }
    this.disposeUnused(previous);
  }

  unreference(id: string) {
    const previous = this.cache.get(id);
    if (previous === undefined) return;
    this.cache.delete(id);
    this.disposeUnused(new Set(previous));
  }

  dispose() {
    const previous = this.pages();
    this.cache.clear();
    this.current = [];
    this.rendering.clear();
    this.disposeUnused(previous);
  }

  protected pages(): Set<RenderedRoute> {
    return new Set([...this.cache.values(), this.current, ...this.rendering].flat());
  }

  protected disposeUnused(previous: Set<RenderedRoute>) {
    const retained = this.pages();
    // Children first: disposing a Solid parent also disposes its child owners.
    for (const rendered of [...previous].reverse()) {
      if (retained.has(rendered)) continue;
      rendered.owner.dispose();
      // A retained, offscreen parent can still contain an evicted child's DOM.
      const html = rendered.renderOutput?.html;
      if (html !== undefined) html.parentNode?.removeChild(html);
    }
  }
}
