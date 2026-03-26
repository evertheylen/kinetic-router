import { RootSitemap, slugLookup, slugPathToString } from "./root.js";
import { Route } from "./routes.js";
import { AnyParamDefs, ParamDef, ParamValues } from "./params.js";

type ImplLoader<Impl, StaticData> = (
  { lazy: false, impl: Impl & StaticData }
  // for lazy routes, we may need some data up front
  | { lazy: true, loadImpl: (() => Promise<Impl>), staticData: StaticData }
)

export class ImplementationMap<
  // In the most common example, this is a Page
  Impl,

  // Static data that describe all page instances handled by that Page
  // Example: { displayAs: 'popup' }
  StaticData,
> {
  root: RootSitemap;
  map = new Map<Route<any>, ImplLoader<Impl, StaticData>>;

  constructor(root: RootSitemap) {
    this.root = root;
  }

  protected _implement<ParamDefs extends AnyParamDefs>(
    route: Route<ParamDefs>, impl: ImplLoader<Impl, StaticData>
  ) {
    const isInSlugMap = this.root[slugLookup].has(route);
    const isNestRoute = !isInSlugMap && this._isKnownNestRoute(route);

    if (!isInSlugMap && !isNestRoute) {
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

  /** Collect all unique nest ancestor routes referenced by routes in the sitemap. */
  private _collectNestRoutes(): Set<Route<any>> {
    const nestRoutes = new Set<Route<any>>();
    for (const r of this.root[slugLookup].keys()) {
      for (const ancestor of r.nestedInRoutes) {
        nestRoutes.add(ancestor);
      }
    }
    return nestRoutes;
  }

  /** Check whether a given route is a nest ancestor route referenced by routes in the sitemap. */
  private _isKnownNestRoute(route: Route<any>): boolean {
    return this._collectNestRoutes().has(route);
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
    const missingSlugRoutes = [...this.root[slugLookup].keys().filter(route => !this.map.has(route))];
    const missingNestRoutes = [...this._collectNestRoutes()].filter(r => !this.map.has(r));

    const missing = [...missingSlugRoutes, ...missingNestRoutes];

    if (missing.length > 0) {
      const paths = missing.map(r => {
        const slugHint = this.root[slugLookup].get(r);
        return slugHint ? slugPathToString(slugHint) : '(nest route)';
      });
      throw new Error(`No implementation found for ${paths.join(', ')}`);
    }
  }

  public getPageHandler<ParamDefs extends AnyParamDefs>(route: Route<ParamDefs>) {
    if (!this.root[slugLookup].has(route) && !this._isKnownNestRoute(route)) {
      throw new Error(`Route ${route} is not part of given root`);
    }

    return this.map.get(route)!;
  }
}
