import { RootSitemap, slugLookup, slugPathToString } from "./root.js";
import { Route } from "./routes.js";
import { AnyParamDefs, ParamDef, ParamValues } from "./params.js";

type ImplLoader<Impl extends object, StaticData extends object> = (
  { lazy: false, impl: Impl & StaticData }
  // for lazy routes, we may need some data up front
  | { lazy: true, loadImpl: (() => Promise<Impl>), staticData: StaticData }
)

export class ImplementationMap<
  // In the most common example, this is a Page
  Impl extends object,

  // Static data that describe all page instances handled by that Page
  // Example: { displayAs: 'popup' }
  StaticData extends object,
> {
  protected root: RootSitemap;
  protected map = new Map<Route, ImplLoader<Impl, StaticData>>;

  constructor(root: RootSitemap) {
    this.root = root;
  }

  protected _implement(
    route: Route, impl: ImplLoader<Impl, StaticData>
  ) {
    const lookup = this.root[slugLookup];
    const isInSlugMap = lookup.has(route);

    if (!isInSlugMap) {
      throw new Error(`Route ${route} is not part of given root`);
    }

    const existingPage = this.map.get(route);
    if (existingPage !== undefined) {
      const slugHint = this.root[slugLookup].get(route);
      const hint = slugHint ? slugPathToString(slugHint) : '(nest route)';
      throw new Error(`Route <${hint}> already implemented: ${existingPage}`);
    }

    this.map.set(route, impl);
  }

  public implement<ParamDefs extends AnyParamDefs>(
    route: Route<ParamDefs>, impl: Impl & StaticData,
  ) {
    return this._implement(route, { lazy: false, impl });
  }

  public implementLazy<ParamDefs extends AnyParamDefs>(
    route: Route<ParamDefs>,
    loadImpl: () => Promise<Impl>,
    staticData: StaticData,
  ) {
    return this._implement(route, { lazy: true, loadImpl, staticData });
  }

  public check() {
    const allRoutes = new Set<Route>();
    for (const route of this.root[slugLookup].keys()) {
      allRoutes.add(route);
      route.nestedInRoutes.forEach(r => allRoutes.add(r));
    }
    const missing = allRoutes.difference(new Set(this.map.keys()));

    if (missing.size > 0) {
      const paths = [...missing].map(r => {
        const slugHint = this.root[slugLookup].get(r);
        return slugHint ? slugPathToString(slugHint) : '(nest route)';
      });
      throw new Error(`No implementation found for ${paths.join(', ')}`);
    }
  }

  /** return list of loaded implementations, from outermost to innermost (nested) route
   * (last one is the implementation for the actual route)
   */
  public async loadRouteAndNested<ParamDefs extends AnyParamDefs>(route: Route<ParamDefs>) {
    const allRoutes = [...route.nestedInRoutes, route] as Route[];
    const implPromises = allRoutes.map(r => {
      const impl = this.map.get(r)!;
      if (impl.lazy) {
        return impl.loadImpl().then(loadedImpl => {
          for (const [key, staticValue] of Object.entries(impl.staticData)) {
            const loadedValue = (loadedImpl as any)[key];
            if (staticValue !== loadedValue) {
              const slugs = this.root[slugLookup].get(r)!;
              console.warn(`While loading ${slugPathToString(slugs)} we got conflicting values for key ${key}`, { staticValue, loadedValue });
            }
          }
          return {...impl.staticData, ...loadedImpl};
        })
      } else {
        return Promise.resolve(impl.impl);
      }
    });

    const implementations = await Promise.all(implPromises);
    return implementations;
  }
}
