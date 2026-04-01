import { index, Json, JsonObject } from "@kinetic-router/definition";
import { RenderedRoute } from "./rendered-route";
import { StateTransition } from "./state-transition";
import { Route } from "@kinetic-router/definition/routes.js";
import { defaultSerde, RootSitemap, slugLookup } from "@kinetic-router/definition/root.js";
import { Sitemap } from "@kinetic-router/definition/sitemap.js";


function getRandomId(): string {
  return (new Date().toISOString()) + '/' + Math.random().toString(16).slice(2);
}

export class AppState {
  readonly route: Route<any>;
  readonly paramSnapshot: object;
  readonly id: string;

  constructor(route: Route<any>, paramSnapshot: object, id?: string) {
    this.route = route;
    this.paramSnapshot = paramSnapshot;
    this.id = id ?? getRandomId();
  }

  serialize(root: RootSitemap) {
    // TODO implement serialize
    const slugs = root[slugLookup].get(this.route);
    if (slugs === undefined) {
      throw new Error(`Couldnt serialize route`);
    }
    // turn PathParamDef into null, it should be unique
    const serializedSlugs = slugs.map(s => typeof s === 'object' ? null : s);
    return { id: this.id, slugs: serializedSlugs, paramSnapshot: this.paramSnapshot as JsonObject } satisfies Json;
  }

  static deserialize(root: RootSitemap, data: ReturnType<AppState['serialize']>): AppState {
    let node = root as Sitemap;
    for (const slug of data.slugs) {
      if (node instanceof Route) {
        throw new Error(`Didnt exhaust slugs yet, trying to get slug ${slug} of a Route`);
      }

      const { [index]: indexRoute, ...subRoutes } = node;
      const keys = Reflect.ownKeys(subRoutes);

      if (slug === null) {
        if (typeof keys[0] !== 'symbol') {
          throw new Error("Expected path param / symbol");
        }

        node = (subRoutes as { [key in symbol]: Sitemap })[keys[0]];
      } else {
        if (typeof keys[0] !== 'string') {
          throw new Error("Expected string slug");
        }

        node = (subRoutes as { [key in string]: Sitemap })[slug];
      }
    }

    const route = node instanceof Route ? node : node[index];
    if (route === undefined) {
      throw new Error(`Couldnt find route`);
    }

    return new AppState(route, data.paramSnapshot, data.id);
  }
}
