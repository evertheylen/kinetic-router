import { index, Json, JsonObject, Locator, Route } from "@kinetic-router/definition";
import { defaultSerde, RootSitemap, slugLookup } from "@kinetic-router/definition/root.js";
import { Sitemap } from "@kinetic-router/definition/sitemap.js";

import { AnyParamDefs, ParamMap, convertParamsByDefinition, convertParamsByKey, ParamValues } from "@kinetic-router/definition/params.js";


function getTemporaryId(): string {
  return '__temp__' + Math.random().toString(16).slice(2)
}

export class AppState {
  readonly route: Route<any>;
  readonly paramsByDefinition: ParamMap;
  readonly paramsByKey: ParamValues<any>;
  id: string;

  constructor(route: Route<any>, paramsByDefinition: ParamMap, paramsByKey?: ParamValues<any>, id?: string) {
    this.route = route;
    this.paramsByDefinition = paramsByDefinition;

    if (paramsByKey !== undefined) {
      this.paramsByKey = paramsByKey;
    } else {
      this.paramsByKey = convertParamsByKey(paramsByDefinition, this.route.paramDefs)
    }

    this.id = id ?? getTemporaryId();
  }

  get locator(): Locator<any> {
    return { route: this.route, values: this.paramsByKey };
  }

  isTemporary() {
    return this.id.startsWith('__temp__');
  }

  serialize(root: RootSitemap) {
    const abstractSlugs = root[slugLookup].get(this.route);
    if (abstractSlugs === undefined) {
      throw new Error(`Couldnt serialize route`);
    }
    // turn PathParamDef into null, it should be unique
    const slugs = abstractSlugs.map(s => typeof s === 'object' ? null : s);

    return { id: this.id, slugs, snapShotByKey: this.paramsByKey as JsonObject } satisfies Json;
  }

  static fromLocator<ParamDefs extends AnyParamDefs>(locator: Locator<ParamDefs>, id?: string) {
    const paramsByDefinition = convertParamsByDefinition(locator.values, locator.route.paramDefs);
    return new AppState(locator.route, paramsByDefinition, locator.values, id);
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

    const snapShotByDef = convertParamsByDefinition(data.snapShotByKey, route.paramDefs);

    return new AppState(route, snapShotByDef, data.snapShotByKey, data.id);
  }
}

export type SerializedAppState = ReturnType<AppState['serialize']>;
