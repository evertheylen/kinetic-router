import type { Locator, Serde } from '@kinetic-router/definition';
import { resolveAliases } from '@kinetic-router/definition/routes.js';
import { defaultSerde, getSlugPath } from '@kinetic-router/definition/root.js';
import { convertParamsByDefinition, ParamDef, PathParamDef, SearchParamDef, SearchParamDefWithDefault } from '@kinetic-router/definition/params.js';
import type { RootSitemap, Slug } from '@kinetic-router/definition/root.js';


/** Serialize a single value using a param's serde, falling back to the root's
 *  defaultSerde, and finally to `String()`. */
export function serializeValue(value: unknown, paramSerde: Serde<any> | undefined, rootDefaultSerde: Serde<any> | undefined): string {
  const serde = paramSerde ?? rootDefaultSerde;
  if (serde) {
    const json = serde.serialize(value);
    return typeof json === 'string' ? json : JSON.stringify(json);
  }
  return String(value);
}

export type SerializedPathParams = ReadonlyMap<PathParamDef<any>, string>;

/** Snapshot the canonical URL values of parameters in a slug path or prefix.
 * Keys use definition identity, not parameter names. Search/hidden values are
 * excluded. The returned map is suitable for immutable structural cache keys. */
export function serializePathParams(
  rootSitemap: RootSitemap, locator: Locator<any>, path: readonly Slug[],
): SerializedPathParams {
  const values = convertParamsByDefinition(locator.values, locator.route.paramDefs);
  const result = new Map<PathParamDef<any>, string>();
  for (const slug of path) {
    if (typeof slug === 'string') continue;
    if (!values.has(slug)) {
      throw new Error("Path param in slug path has no matching key in route's paramDefs.");
    }
    result.set(slug, serializeValue(values.get(slug), slug.serde, rootSitemap[defaultSerde]));
  }
  return result;
}

/**
 * Convert a `Locator` to a URL string.
 *
 * - Aliases resolve to their destination before serialization.
 * - Path params are serialized as URL path segments.
 * - Search params are serialized as query string entries (`?key=value`).
 * - Hidden params are omitted from the URL.
 * - Search params whose value equals their declared default are omitted.
 *
 * Throws if the resolved route is not registered in the given `rootSitemap`.
 */
export function locatorToUrl(rootSitemap: RootSitemap, locator: Locator<any>): string {
  locator = resolveAliases(locator);
  const slugPath = getSlugPath(rootSitemap, locator.route);
  if (slugPath === undefined) {
    throw new Error('Route is not registered in the provided rootSitemap.');
  }

  const rootDefault: Serde<any> | undefined = rootSitemap[defaultSerde];
  const paramDefs: Record<string, ParamDef<any>> = locator.route.paramDefs;
  const values: Record<string, unknown> = locator.values as Record<string, unknown>;

  const pathParams = serializePathParams(rootSitemap, locator, slugPath);
  const pathname = '/' + slugPath.map(slug => typeof slug === 'string' ? slug : pathParams.get(slug)!).join('/');

  // --- Search params ---
  const searchParams = new URLSearchParams();
  for (const [name, def] of Object.entries(paramDefs)) {
    if (!(def instanceof SearchParamDef)) continue;

    const rawValue = values[name];
    if (rawValue === undefined) continue;
    const serializedValue = serializeValue(rawValue, def.serde, rootDefault);

    // Omit the param when its value equals the declared default.
    if (def instanceof SearchParamDefWithDefault) {
      const defaultValue = def.makeDefault();  
      const serializedDefault = serializeValue(defaultValue, def.serde, rootDefault);
      if (serializedValue === serializedDefault) continue;
    }
    searchParams.set(name, serializedValue);
  }

  const search = searchParams.size > 0 ? '?' + searchParams.toString() : '';
  return pathname + search;
}
