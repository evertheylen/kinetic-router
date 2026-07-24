import { Route } from "@kinetic-router/definition";
import { RenderedRoute } from "./rendered-route.js";


export type RenderedRouteCacheEntry = {
  /** Which NavigationEntry ID's refer to it? */
  usedIn: Set<string>,

  /** The actual rendered route */
  rendered: RenderedRoute,
};

export class RenderedRouteCache {
  cache = new Map<string, Map<Route<any>, RenderedRouteCacheEntry>>();

  markUsedFor(id: string, renderedRoutes: RenderedRoute[]) {
    const subMap = this.getSubmap(id);
    
    for (const rendered of renderedRoutes) {
      // Still on old navigationEntryId which may be another id in case of reuse!
      const entry = this.getEntry(rendered.navigationEntryId!, rendered.route) ?? {
        usedIn: new Set<string>(),
        rendered
      };

      entry.usedIn.add(id);
      rendered.navigationEntryId = id;

      subMap.set(rendered.route, entry);
    }
  }

  getEntry(id: string, route: Route<any>) {
    return this.cache.get(id)?.get(route);
  }

  unreference(id: string) {
    const submap = this.getSubmap(id);

    if (submap === undefined) {
      console.warn(`No entry found for ${id}`);
    } else {
      for (const [route, entry] of submap.entries()) {
        entry.usedIn.delete(id);
        if (entry.usedIn.size === 0) {
          entry.rendered.owner.dispose();
          
          submap.delete(route);
          if (submap.size === 0) {
            this.cache.delete(id);
          }
        }
      }
    }
  }

  protected getSubmap(id: string) {
    let submap = this.cache.get(id);
    if (submap === undefined) {
      submap = new Map();
      this.cache.set(id, submap)
    }
    return submap;
  }
}
