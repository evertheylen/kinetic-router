import { RootSitemap, slugLookup, slugPathToString } from "./root.js";
import { Route } from "./routes.js";
import { AnyParamDefs, ParamDef, ParamValues } from "./params.js";

type ImplLoader<Impl extends object, StaticData extends object> = (
  { lazy: false, impl: Impl & StaticData }
  // for lazy routes, we may need some data up front
  | { lazy: true, loadImpl: (() => Promise<Impl>), staticData: StaticData }
)

export abstract class ImplementationMap<
  // In the most common example, this is a Page
  out Impl extends object,

  // Static data that describe all page instances handled by that Page
  // Example: { displayAs: 'popup' }
  out StaticData extends object,
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

    for (const route of allRoutes) {
      this.checkStaticPartOfImpl(route, this.getStaticPartOfImplementation(route));
    }
  }

  public abstract checkStaticPartOfImpl(route: Route, staticImpl: StaticData): void;

  public getStaticPartOfImplementation(route: Route): StaticData {
    const impl = this.map.get(route)!;
    if (impl.lazy) {
      return impl.staticData;
    } else {
      return impl.impl;
    }
  }

  /** return loaded implementation */
  public async loadImplementation(route: Route) {
    const impl = this.map.get(route)!;
    if (impl.lazy) {
      const loadedImpl = await impl.loadImpl();
      // check staticData
      for (const [key, staticValue] of Object.entries(impl.staticData)) {
        const loadedValue = (loadedImpl as any)[key];
        if (staticValue !== loadedValue) {
          const slugs = this.root[slugLookup].get(route)!;
          console.warn(`While loading ${slugPathToString(slugs)} we got conflicting values for key ${key}`, { staticValue, loadedValue });
        }
      }
      return { ...impl.staticData, ...loadedImpl };
    } else {
      return impl.impl;
    }
  }
}
