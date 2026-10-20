import { RenderedRoute } from "./rendered-route.js";

/** LRU of complete history-entry stacks, oldest first. Keeping whole stacks
 * ensures a cached child always keeps its rendered ancestors alive. */
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

  /** A source entry may disappear while its ancestors are being reused. */
  retainForRender(routes: readonly RenderedRoute[]): () => void {
    const stack = [...routes];
    this.rendering.add(stack);
    return () => {
      if (this.rendering.delete(stack)) this.disposeUnused(new Set(stack));
    };
  }

  /** Called after a successful render; completing a navigation refreshes LRU. */
  markUsedFor(id: string, renderedRoutes: readonly RenderedRoute[]) {
    const previous = this.pages();
    this.current = [...renderedRoutes];
    this.cache.delete(id);
    this.cache.set(id, this.current);

    for (const entryId of this.cache.keys()) {
      // The visible stack is the newest entry and must never be evicted.
      if (this.cache.size === 1 || (
        this.cache.size <= this.maxPages && this.pages().size <= this.maxPages
      )) break;
      this.cache.delete(entryId);
    }

    this.disposeUnused(previous);
  }

  unreference(id: string) {
    const previous = this.cache.get(id);
    if (previous === undefined) return;
    this.cache.delete(id);
    this.disposeUnused(new Set(previous));
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
