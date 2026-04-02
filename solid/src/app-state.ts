import { index, Json, JsonObject, Locator, Route } from "@kinetic-router/definition";
import { defaultSerde, RootSitemap, slugLookup } from "@kinetic-router/definition/root.js";
import { Sitemap } from "@kinetic-router/definition/sitemap.js";

import { AnyParamDefs, ParamMap, paramsByDefinition, paramsByKey } from "@kinetic-router/definition/params.js";


export function getRandomId(): string {
  return (new Date().toISOString()) + '/' + Math.random().toString(16).slice(2);
}

export class AppState {
  readonly route: Route<any>;
  readonly paramSnapshot: ParamMap;
  temporaryId: string | undefined;

  constructor(route: Route<any>, paramSnapshot: ParamMap, temporaryId?: string) {
    this.route = route;
    this.paramSnapshot = paramSnapshot;
    this.temporaryId = temporaryId;
  }

  serialize(root: RootSitemap) {
    const abstractSlugs = root[slugLookup].get(this.route);
    if (abstractSlugs === undefined) {
      throw new Error(`Couldnt serialize route`);
    }
    // turn PathParamDef into null, it should be unique
    const slugs = abstractSlugs.map(s => typeof s === 'object' ? null : s);

    const snapShotByKey = paramsByKey(this.paramSnapshot, this.route.paramDefs) as JsonObject;

    return { temporaryId: this.temporaryId, slugs, snapShotByKey } satisfies Json;
  }

  static fromLocator<ParamDefs extends AnyParamDefs>(locator: Locator<ParamDefs>) {
    const params = paramsByDefinition(locator.values, locator.route.paramDefs);
    return new AppState(locator.route, params);
  }

  static deserialize(root: RootSitemap, data: SerializedAppState): AppState {
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

    const snapShotByDef = paramsByDefinition(data.snapShotByKey, route.paramDefs);

    return new AppState(route, snapShotByDef, data.temporaryId);
  }
}

export type SerializedAppState = ReturnType<AppState['serialize']>;
