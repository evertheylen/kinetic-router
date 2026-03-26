import type { Locator, Serde } from '@kinetic-router/definition';
import { defaultSerde, getSlugPath } from '@kinetic-router/definition/root.js';
import { HiddenParamDef, ParamDef, PathParamDef, SearchParamDef, SearchParamDefWithDefault } from '@kinetic-router/definition/params.js';
import type { RootSitemap } from '@kinetic-router/definition/root.js';


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

/**
 * Convert a `Locator` to a URL string.
 *
 * - Path params are serialized as URL path segments.
 * - Search params are serialized as query string entries (`?key=value`).
 * - Hidden params are omitted from the URL.
 * - Search params whose value equals their declared default are omitted.
 *
 * Throws if the route is not registered in the given `rootSitemap`.
 */
export function locatorToUrl(rootSitemap: RootSitemap, locator: Locator<any>): string {
  const slugPath = getSlugPath(rootSitemap, locator.route);
  if (slugPath === undefined) {
    throw new Error('Route is not registered in the provided rootSitemap.');
  }

  const rootDefault: Serde<any> | undefined = rootSitemap[defaultSerde];
  const paramDefs: Record<string, ParamDef<any>> = locator.route.paramDefs;
  const values: Record<string, unknown> = locator.values as Record<string, unknown>;

  // Build a reverse map: ParamDef instance → param name (for path param lookup).
  const paramDefToName = new Map<ParamDef<any>, string>();
  for (const [name, def] of Object.entries(paramDefs)) {
    paramDefToName.set(def, name);
  }

  // --- Path segments ---
  const segments: string[] = [];
  for (const slug of slugPath) {
    if (typeof slug === 'string') {
      segments.push(slug);
    } else {
      // slug is a ParamDef<any, 'path'>
      const name = paramDefToName.get(slug);
      if (name === undefined) {
        throw new Error(`Path param in slug path has no matching key in route's paramDefs.`);
      }
      segments.push(serializeValue(values[name], slug.serde, rootDefault));
    }
  }

  const pathname = '/' + segments.join('/');

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
