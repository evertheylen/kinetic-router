import { Route } from "@kinetic-router/definition";
import { RenderedRoute } from "./rendered-route";


export type RenderedRouteCacheEntry = {
  /** Which NavigationEntry ID's refer to it? */
  usedIn: Set<string>,

  /** The actual rendered route */
  rendered: RenderedRoute,
};

export class RenderedRouteCache {
  cache = new Map<string, Map<Route<any>, RenderedRouteCacheEntry>>();

  markUsedFor(newId: string, renderedRoutes: RenderedRoute[]) {
    if (this.cache.has(newId)) {
      throw new Error(`Cannot redefine which routes are used for id ${newId}`);
    }

    const subMap = new Map<Route<any>, RenderedRouteCacheEntry>();
    
    for (const rendered of renderedRoutes) {
      const entry = this.getEntry(rendered.navigationEntryId!, rendered.route) ?? {
        usedIn: new Set<string>(),
        rendered
      };

      entry.usedIn.add(newId);
      rendered.navigationEntryId = newId;

      subMap.set(rendered.route, entry);
    }

    this.cache.set(newId, subMap);
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
