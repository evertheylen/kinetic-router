import { index as indexSymbol } from '@kinetic-router/definition';
import type { Locator, Serde } from '@kinetic-router/definition';
import { defaultSerde } from '@kinetic-router/definition/root.js';
import { Route } from '@kinetic-router/definition/routes.js';
import { PathParamDef, SearchParamDef, SearchParamDefWithDefault, type ParamDef } from '@kinetic-router/definition/params.js';
import type { RootSitemap } from '@kinetic-router/definition/root.js';
import { index, Sitemap } from '@kinetic-router/definition/sitemap.js';

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** Deserialize a string using a param's serde, falling back to the root's
 *  defaultSerde. If neither is present, return the raw string. */
export function deserializeValue(raw: string, paramSerde: Serde<any> | undefined, rootDefaultSerde: Serde<any> | undefined): unknown {
  const serde = paramSerde ?? rootDefaultSerde;
  if (serde) {
    // Attempt to JSON.parse first so we can pass a proper Json value to
    // deserialize(); fall back to the raw string if parsing fails.
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
    return serde.deserialize(json as any);
  }
  return raw;
}

/** Find the key name in `paramDefs` whose value is the exact same `ParamDef` instance. */
function findParamName(paramDefs: Record<string, ParamDef<any>>, target: ParamDef<any>): string | undefined {
  for (const [name, def] of Object.entries(paramDefs)) {
    if (def === target) return name;
  }
  return undefined;
}

/** Build a Locator for a matched Route by parsing search params into the
 *  route's search-type paramDefs. Path params are filled in by walkTree as
 *  it unwinds the recursion; hidden params are absent. */
function buildLocatorFromRoute(
  route: Route,
  searchParams: URLSearchParams,
  rootDefault: Serde<any> | undefined,
): Locator<any> {
  const paramDefs: Record<string, ParamDef<any>> = route.paramDefs;
  const values: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(paramDefs)) {
    if (def instanceof SearchParamDef) {
      const raw = searchParams.get(name);
      if (raw !== null) {
        values[name] = deserializeValue(raw, def.serde, rootDefault);
      } else if (def instanceof SearchParamDefWithDefault) {
        // Param absent from URL — restore the declared default value.
        values[name] = def.makeDefault();
      }
    }
  }

  return { route, values };
}

// ---------------------------------------------------------------------------
// Tree walker
// ---------------------------------------------------------------------------

/**
 * Recursively walk the sitemap tree to match path segments.
 *
 * @param node         Current sitemap node
 * @param segments     All URL path segments
 * @param depth        Current segment index
 * @param searchParams Parsed query string
 * @param rootDefault  Fallback serde from the root
 */
function walkTree(
  node: Sitemap,
  segments: string[],
  depth: number,
  searchParams: URLSearchParams,
  rootDefault: Serde<any> | undefined,
): Locator<any> {
  if (node instanceof Route) {
    // Must have consumed all path segments.
    if (depth !== segments.length) {
      throw new Error(`Didn't consume all path segments: ${segments.slice(depth)}`)
    }
    return buildLocatorFromRoute(node, searchParams, rootDefault);
  }

  const { [index]: indexRoute, ...subRoutes } = node;

  if (depth === segments.length) {
    if (indexRoute !== undefined) {
      return buildLocatorFromRoute(indexRoute, searchParams, rootDefault);
    } else {
      throw new Error(`Reached final depth after ${segments.join('/')} but no route was found, instead got ${indexRoute}`);
    }
  }

  const keys = Reflect.ownKeys(subRoutes);

  if (typeof keys[0] === 'symbol') {
    // parameter!
    const paramDef = PathParamDef.symbolRegistry.get(keys[0])!;
    // Consume one segment as the path-param value.
    if (depth >= segments.length) {
      throw new Error(`Tried to use too many segments`);
    };

    const rawSegment = segments[depth];
    const childResult = walkTree((subRoutes as { [key in symbol]: Sitemap })[keys[0]], segments, depth + 1, searchParams, rootDefault);

    const paramName = findParamName(childResult.route.paramDefs, paramDef);
    if (paramName === undefined) return childResult

    return {
      route: childResult.route,
      values: {
        ...childResult.values,
        [paramName]: deserializeValue(rawSegment, paramDef.serde, rootDefault),
      },
    };
  } else {
    // string subroutes
    const child = (subRoutes as { [key in string]: Sitemap })[segments[depth]];
    if (child === undefined) {
      throw new Error(`Couldnt find ${segments[depth]} in [${Object.keys(subRoutes).join(', ')}]`);
    }
    return walkTree(child as Sitemap, segments, depth + 1, searchParams, rootDefault);
  }
}

// ---------------------------------------------------------------------------
// urlToLocator
// ---------------------------------------------------------------------------

/**
 * Parse a URL string back into a `Locator` by walking the `rootSitemap` tree.
 *
 * Returns `undefined` if no registered route matches the URL.
 *
 * Hidden params are never present in the URL and are omitted from the returned
 * `Locator`'s values. Search params absent from the URL are restored to their
 * declared default (if any).
 */
export function urlToLocator(rootSitemap: RootSitemap, url: string): Locator<any> | undefined {
  const rootDefault: Serde<any> | undefined = (rootSitemap as any)[defaultSerde];

  // Normalize the URL — accept both absolute and relative forms.
  let pathname: string;
  let search: string;

  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    search = parsed.search;
  } catch {
    const qIdx = url.indexOf('?');
    if (qIdx === -1) {
      pathname = url;
      search = '';
    } else {
      pathname = url.slice(0, qIdx);
      search = url.slice(qIdx);
    }
  }

  const segments = pathname.replace(/^\//, '').split('/').filter(s => s.length > 0);
  const searchParams = new URLSearchParams(search);

  return walkTree(rootSitemap as Sitemap, segments, 0, searchParams, rootDefault);
}
