import { ParamDef, Serde } from "./params.js";
import { index, ParameterizedPath, ParameterizedPathWithoutParam, Route, RootSitemapInput, Sitemap, SubPaths } from "./routes.js";

export const slugLookup:   unique symbol = Symbol('kinetic-router:slugLookup');
export const defaultSerde: unique symbol = Symbol('kinetic-router:defaultSerde');

export type Slug = string | ParamDef<any, 'path'>;

export type RootSitemap = {
  [slugLookup]: Map<Route<any>, Slug[]>,
  [defaultSerde]?: Serde<any>
};

/**
 * Walk the sitemap tree, collecting every Route and mapping it to its full
 * slug path (the sequence of literal string segments and path-param defs that
 * uniquely identify it in the URL tree).
 *
 * Validates:
 *  - Path params referenced in a route's paramDefs must be introduced by an
 *    ancestor ParameterizedPath node.
 *  - Every ancestor path param must be present in every route beneath it (not
 *    applicable to routes registered via withoutParam, which sit above the param).
 *  - A withoutParam route must not use any param that is not yet in scope.
 */
export function root<Sm extends RootSitemapInput>(sitemap: Sm, serde?: Serde<any>): RootSitemap & Sm {
  const map = new Map<Route<any>, Slug[]>();

  function walk(node: Sitemap, slugPath: Slug[], activePathParams: Set<ParamDef<any, 'path'>>) {
    if (node instanceof ParameterizedPath) {
      const nextActivePathParams = new Set(activePathParams);
      nextActivePathParams.add(node.paramDef);
      const nextSlugPath = [...slugPath, node.paramDef];

      // If it has a parent route, register it at the slug path before the param.
      if (node instanceof ParameterizedPathWithoutParam) {
        registerRoute(node.parentRoute, slugPath, activePathParams);
      }

      walk(node.PARAM, nextSlugPath, nextActivePathParams);
    } else if (node instanceof Route) {
      // A bare Route can appear as a leaf value inside SubPaths.
      registerRoute(node, slugPath, activePathParams);
    } else {
      // SubPaths: plain object (possibly with index symbol key and string keys).
      const subPaths = node as SubPaths;

      if (subPaths[index] !== undefined) {
        registerRoute(subPaths[index]!, slugPath, activePathParams);
      }

      for (const key of Object.keys(subPaths)) {
        const child = subPaths[key];
        walk(child as Sitemap, [...slugPath, key], activePathParams);
      }
    }
  }

  function registerRoute(r: Route<any>, slugPath: Slug[], activePathParams: Set<ParamDef<any, 'path'>>) {
    // Validate: all path params in this route's paramDefs must be in scope.
    for (const [, def] of Object.entries(r.paramDefs) as any) {
      if (def.type === 'path' && !activePathParams.has(def)) {
        throw new Error(
          `Route uses path param that is not defined by an ancestor ParameterizedPath node.`
        );
      }
    }

    // Validate: every ancestor path param must be used by this route.
    const routePathParams = new Set(
      (Object.values(r.paramDefs) as ParamDef<any, any>[]).filter(d => d.type === 'path')
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

  return Object.assign(sitemap, { [slugLookup]: map, [defaultSerde]: serde }) as RootSitemap & Sm;
}

/** Return the slug path for a route registered in a RootSitemap. */
export function getSlugPath(rootSitemap: RootSitemap, r: Route<any>): Slug[] | undefined {
  return (rootSitemap as any)[slugLookup].get(r);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

export function slugPathToString(path: Slug[]): string {
  return path.map(s => s instanceof ParamDef ? '<param>' : s).join('/');
}
