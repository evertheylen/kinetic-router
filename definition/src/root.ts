import { ParamDef, Serde } from "./params.js";
import { index, ParameterizedPath, ParameterizedPathWithIndex, Route, RootSitemapInput, Sitemap, SubPaths } from "./routes.js";

export const slugLookup:   unique symbol = Symbol('kinetic-router:slugLookup');
export const defaultSerde: unique symbol = Symbol('kinetic-router:defaultSerde');

export type Slug = string | ParamDef<any, 'path'>;

export type RootSitemap<Sm extends RootSitemapInput> = Sm & {
  [slugLookup]:    Map<Route<any>, Slug[]>,
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
 *  - Every route must have a unique slug path (no two routes resolve to the
 *    same URL pattern).
 */
export function root<Sm extends RootSitemapInput>(sitemap: Sm, serde?: Serde<any>): RootSitemap<Sm> {
  const map = new Map<Route<any>, Slug[]>();

  function walk(node: Sitemap, slugPath: Slug[], activePathParams: Set<ParamDef<any, 'path'>>) {
    if (node instanceof ParameterizedPath) {
      const nextActivePathParams = new Set(activePathParams);
      nextActivePathParams.add(node['paramDef'] as ParamDef<any, 'path'>);
      const nextSlugPath = [...slugPath, node['paramDef'] as ParamDef<any, 'path'>];

      // If it has an index route, register it at the current parameterized level.
      if (node instanceof ParameterizedPathWithIndex) {
        registerRoute(node.index, nextSlugPath, nextActivePathParams);
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

    // Validate uniqueness: no two routes may share the same slug path.
    for (const [existingRoute, existingPath] of map) {
      if (existingRoute !== r && slugPathsEqual(existingPath, slugPath)) {
        throw new Error(
          `Two routes share the same slug path: [${slugPathToString(slugPath)}]`
        );
      }
    }

    map.set(r, slugPath);
  }

  walk(sitemap, [], new Set());

  return { ...sitemap, [slugLookup]: map, [defaultSerde]: serde } as RootSitemap<Sm>;
}

/** Return the slug path for a route registered in a RootSitemap. */
export function getSlugPath(rootSitemap: RootSitemap<any>, r: Route<any>): Slug[] | undefined {
  return (rootSitemap as any)[slugLookup].get(r);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function slugPathsEqual(a: Slug[], b: Slug[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function slugPathToString(path: Slug[]): string {
  return path.map(s => s instanceof ParamDef ? '<param>' : s).join('/');
}
