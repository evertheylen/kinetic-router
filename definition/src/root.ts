import { ParamDef, PathParamDef, Serde } from "./params.js";
import { Route } from "./routes.js";
import { index, Sitemap, SubRoutes } from "./sitemap.js";

export const slugLookup:   unique symbol = Symbol('kinetic-router:slugLookup');
export const defaultSerde: unique symbol = Symbol('kinetic-router:defaultSerde');

export type Slug = string | PathParamDef<any>;

export type RootSitemap = {
  [slugLookup]: Map<Route, Slug[]>,
  [defaultSerde]?: Serde<any>
};

/**
 * Walk the sitemap tree, collecting every Route and mapping it to its full
 * slug path (the sequence of literal string segments and path-param defs that
 * uniquely identify it in the URL tree).
 *
 * Validates:
 *  - Path params referenced in a route's paramDefs must be introduced by an
 *    ancestor parameter node.
 *  - Every ancestor path param must be present in every route beneath it (not
 *    applicable to routes registered via noParamGiven, which sit above the param).
 *  - A noParamGiven route must not use any param that is not yet in scope.
 */
export function root<Sm extends SubRoutes>(sitemap: Sm, serde?: Serde<any>): RootSitemap & Sm {
  const map = new Map<Route, Slug[]>();

  function walk(node: Sitemap, slugPath: Slug[], activePathParams: Set<PathParamDef<any>>) {
    if (node instanceof Route) {
      // A bare Route can appear as a leaf value inside SubPaths.
      registerRoute(node, slugPath, activePathParams);
    } else {
      const { [index]: indexRoute, ...subRoutes } = node;
      const keys = Reflect.ownKeys(subRoutes);

      if (indexRoute !== undefined) {
        registerRoute(indexRoute, slugPath, activePathParams);
      }

      if (keys.length === 0) {
        if (indexRoute === undefined) {
          throw new Error('empty SubRoutes object');
        }
        // else: a bit weird to only have [index] but legal (already registered)
      } else {
        if (typeof keys[0] === 'string') {
          // registering fixed subpaths
          if (keys.some(k => typeof k !== 'string')) {
            throw new Error(`Expected all string keys but got [${keys.map(k => k.toString()).join(', ')}]`);
          }

          for (const [key, child] of Object.entries(subRoutes)) {
            walk(child, [...slugPath, key], activePathParams);
          }
        } else {
          // we expect a single symbol that is also registered in PathParamDef.symbolRegistry
          if (keys.length !== 1) {
            throw new Error(`Expect a single path param symbol, found ${keys.length}`);
          }

          const key = keys[0];
          const paramDef = PathParamDef.symbolRegistry.get(key);
          if (paramDef === undefined) {
            throw new Error(`No PathParamDef found for ${key.toString()}`);
          }
          const nextActivePathParams = new Set(activePathParams);
          nextActivePathParams.add(paramDef);

          walk((subRoutes as { [key in symbol]: Sitemap })[key], [...slugPath, paramDef], nextActivePathParams);
        }
      }
    }
  }

  function registerRoute(r: Route, slugPath: Slug[], activePathParams: Set<PathParamDef<any>>) {
    // Validate: all path params in this route's paramDefs must be in scope.
    for (const [key, paramDef] of Object.entries(r.paramDefs as Record<string, ParamDef<any>>)) {
      if (paramDef instanceof PathParamDef && !activePathParams.has(paramDef)) {
        throw new Error(`Route ${slugPathToString(slugPath)} uses path param ${key} that is not defined by an ancestor path param key.`);
      }
    }

    // Validate: every ancestor path param must be used by this route.
    const routePathParams = new Set(
      Object.values(r.paramDefs).filter(d => d instanceof PathParamDef)
    );
    for (const ancestorParam of activePathParams) {
      if (!routePathParams.has(ancestorParam)) {
        throw new Error(
          `Route at [${slugPathToString(slugPath)}] does not use all ancestor path params.`
        );
      }
    }

    map.set(r, slugPath);
  }

  walk(sitemap, [], new Set());

  // Note: we don't have to check nested routes, as they are not "real" routes!

  return Object.assign(sitemap, { [slugLookup]: map, [defaultSerde]: serde }) as RootSitemap & Sm;
}

/** Return the slug path for a route registered in a RootSitemap. */
export function getSlugPath(rootSitemap: RootSitemap, r: Route): Slug[] | undefined {
  return (rootSitemap as any)[slugLookup].get(r);
}

export function slugPathToString(path: Slug[]): string {
  return path.map(s => s instanceof ParamDef ? '<param>' : s).join('/');
}
