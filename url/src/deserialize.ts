import { index as indexSymbol } from '@kinetic-router/definition';
import type { Locator, Serde } from '@kinetic-router/definition';
import { defaultSerde } from '@kinetic-router/definition/root.js';
import { Route, ParameterizedPath, OptionalParameterizedPath } from '@kinetic-router/definition/routes.js';
import type { Sitemap } from '@kinetic-router/definition/routes.js';
import type { ParamDef } from '@kinetic-router/definition/params.js';
import type { RootSitemap } from '@kinetic-router/definition/root.js';
import { hasDefault } from './serialize.js';

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
    if (def.type === 'search') {
      const raw = searchParams.get(name);
      if (raw !== null) {
        values[name] = deserializeValue(raw, def.serde, rootDefault);
      } else if (hasDefault(def)) {
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
): Locator<any> | undefined {
  if (node instanceof ParameterizedPath) {
    // If this node has a noParamGiven route, it sits at the current slug path
    // (before the param segment). Match it when all segments are consumed here.
    if (node instanceof OptionalParameterizedPath && depth === segments.length) {
      return buildLocatorFromRoute(node.defaultRoute, searchParams, rootDefault);
    }

    // Consume one segment as the path-param value.
    if (depth >= segments.length) return undefined;

    const rawSegment = segments[depth];
    const childResult = walkTree(node.PARAM as Sitemap, segments, depth + 1, searchParams, rootDefault);

    if (childResult === undefined) return undefined;

    // Find which param in the matched route's paramDefs corresponds to this
    // paramDef. If the route doesn't declare it, the segment is structural —
    // skip injecting a value.
    const paramName = findParamName(childResult.route.paramDefs, node.paramDef);
    if (paramName === undefined) return childResult;

    return {
      route: childResult.route,
      values: {
        ...childResult.values,
        [paramName]: deserializeValue(rawSegment, node.paramDef.serde, rootDefault),
      },
    };
  }

  if (node instanceof Route) {
    // Must have consumed all path segments.
    if (depth !== segments.length) return undefined;
    return buildLocatorFromRoute(node, searchParams, rootDefault);
  }

  // SubPaths: plain object with string keys and optional index symbol key.
  if (depth === segments.length) {
    const indexRoute = (node as any)[indexSymbol];
    if (indexRoute instanceof Route) {
      return buildLocatorFromRoute(indexRoute, searchParams, rootDefault);
    }
    return undefined;
  }

  const child = (node as Record<string, unknown>)[segments[depth]];
  if (child === undefined) return undefined;
  return walkTree(child as Sitemap, segments, depth + 1, searchParams, rootDefault);
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
