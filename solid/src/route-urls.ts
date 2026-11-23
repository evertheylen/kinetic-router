import { SearchParamDef } from '@kinetic-router/definition/params.js';
import { defaultSerde, type RootSitemap } from '@kinetic-router/definition/root.js';
import type { Locator } from '@kinetic-router/definition/routes.js';
import { locatorToUrl, serializeValue, urlToLocator } from '@kinetic-router/url';

const urlBase = 'https://kinetic.invalid';

/** Mount paths live at the URL boundary, not in the sitemap or history state. */
export function createRouteUrls(sitemap: RootSitemap, basePath = '') {
  if (basePath && (!basePath.startsWith('/') || basePath.startsWith('//') || /[?#\\]/.test(basePath)
    || new URL(basePath, urlBase).pathname !== basePath)) {
    throw new TypeError('basePath must be an absolute URL pathname, such as /tools/app');
  }
  basePath = basePath.replace(/\/+$/, '');
  const contains = (pathname: string) => !basePath || pathname === basePath || pathname.startsWith(basePath + '/');
  const assertInBasePath = (pathname: string) => {
    if (!contains(pathname)) throw new Error(`URL pathname ${pathname} is outside basePath ${basePath}`);
  };
  return {
    basePath,
    contains,
    assertInBasePath,
    toUrl(locator: Locator<any>, previous?: { search: string, hash?: string }) {
      const href = basePath + locatorToUrl(sitemap, locator);
      if (!basePath) return href;
      // A serialized path can appear mounted until the browser resolves dot segments.
      const canonical = new URL(href, urlBase);
      assertInBasePath(canonical.pathname);
      if (!previous) return href;

      const incoming = new URLSearchParams(previous.search);
      let changed = false;
      // The resolved locator owns declared search values. Preserve the rest of
      // the query, and keep its original spelling when nothing needs changing.
      for (const [name, def] of Object.entries(locator.route.paramDefs)) {
        if (!(def instanceof SearchParamDef)) continue;
        const had = incoming.get(name);
        const want = canonical.searchParams.get(name);
        if (had === want) continue;
        if (want === null) {
          const value = locator.values[name];
          // The serializer omits defaults; a matching explicit value is safe to keep.
          if (value !== undefined && had === serializeValue(value, def.serde, sitemap[defaultSerde])) continue;
          incoming.delete(name);
        } else {
          incoming.set(name, want);
        }
        changed = true;
      }
      const suffix = changed ? (incoming.size ? '?' + incoming.toString() : '') : previous.search;
      return canonical.pathname + suffix + (previous.hash ?? '');
    },
    toLocator({ pathname, search }: { pathname: string, search: string }) {
      assertInBasePath(pathname);
      return urlToLocator(sitemap, { pathname: pathname.slice(basePath.length), search });
    },
  };
}
