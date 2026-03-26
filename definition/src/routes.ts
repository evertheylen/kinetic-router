import { AnyParamDefs, ParamDef, ParamValues } from "./params.js";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export type Locator<ParamDefs extends Record<string, ParamDef<any>>> = {
  route: Route<ParamDefs>,
  values: ParamValues<ParamDefs>
}

export class Route<ParamDefs extends Record<string, ParamDef<any>>> {
  public paramDefs: ParamDefs;
  /** Ancestor nest routes, ordered from outermost to innermost (closest). Empty for non-nested routes. */
  public nestedInRoutes: Route<any>[];

  constructor(paramDefs: ParamDefs, nestedInRoutes: Route<any>[] = []) {
    this.paramDefs = paramDefs;
    this.nestedInRoutes = nestedInRoutes;
  }

  aliasTo(aliasFunc: (params: ParamValues<ParamDefs>) => Locator<any>) {
    return new Alias(this.paramDefs, aliasFunc);
  }

  // Returns Locator<any> because Alias may resolve to a different route.
  locate(values: ParamValues<ParamDefs>): Locator<any> {
    return { route: this, values };
  }

  nest<const SubSitemap extends Sitemap>(
    factory: (
      nestedRoute: <const OwnParamDefs extends AnyParamDefs>(
        ownParamDefs: OwnParamDefs
      ) => Route<ParamDefs & OwnParamDefs>
    ) => SubSitemap
  ): SubSitemap {
    // The ancestor list for children = this route's own ancestors + this route itself.
    const ancestorsForChildren: Route<any>[] = [...this.nestedInRoutes, this];

    const nestedRoute = <const OwnParamDefs extends AnyParamDefs>(
      ownParamDefs: OwnParamDefs
    ): Route<ParamDefs & OwnParamDefs> => {
      return new Route({ ...this.paramDefs, ...ownParamDefs }, ancestorsForChildren);
    };

    return factory(nestedRoute);
  }
}

export class Alias<ParamDefs extends Record<string, ParamDef<any>>> extends Route<ParamDefs> {
  public aliasFunc: (values: ParamValues<ParamDefs>) => Locator<any>;

  constructor(paramDefs: ParamDefs, aliasFunc: (values: ParamValues<ParamDefs>) => Locator<any>) {
    super(paramDefs);
    this.aliasFunc = aliasFunc;
  }

  override locate(values: ParamValues<ParamDefs>): Locator<any> {
    // core aliasing logic
    let locator: Locator<any> = this.aliasFunc(values);
    while (locator.route instanceof Alias) {
      locator = locator.route.aliasFunc(locator.values);
    }
    return locator;
  }
}

// ---------------------------------------------------------------------------
// Sitemap tree
// ---------------------------------------------------------------------------

export const index: unique symbol = Symbol('kinetic-router:index');

export const missing: unique symbol = Symbol('kinetic-router:missing');

export class ParameterizedPath<T, const SubSitemap extends Sitemap> {
  public paramDef: ParamDef<T, 'path'>;
  PARAM: SubSitemap;

  constructor(paramDef: ParamDef<T, 'path'>, subSitemap: SubSitemap) {
    this.paramDef = paramDef;
    this.PARAM = subSitemap;
  }
}

export class OptionalParameterizedPath<
  T, const SubSitemap extends Sitemap, const Default extends Record<string, ParamDef<any>>
> extends ParameterizedPath<T, SubSitemap> {
  defaultRoute: Route<any>;

  constructor(paramDef: ParamDef<T, 'path'>, subSitemap: SubSitemap, defaultRoute: Route<any>) {
    super(paramDef, subSitemap);
    this.defaultRoute = defaultRoute;
  }
}

export type RootSitemapInput = ParameterizedPath<any, any> | SubPaths;
export type Sitemap = RootSitemapInput | Route<any>;
export type SubPaths = { [key in typeof index]?: Route<any> } & { [key in string]: Sitemap | Route<any> };

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function route<const ParamDefs extends Record<string, ParamDef<any>>>(paramDefs: ParamDefs) {
  return new Route(paramDefs);
}

export function parameter<const SubSitemap extends Sitemap>(
  paramDef: ParamDef<any, 'path'>, subSitemap: SubSitemap
): ParameterizedPath<ParamDef<any, 'path'>, SubSitemap>

export function parameter<const SubSitemap extends Sitemap, Default extends Record<string, ParamDef<any>>>(
  paramDef: ParamDef<any, 'path'>, subSitemap: SubSitemap & { [missing]: Route<Default> }
): OptionalParameterizedPath<ParamDef<any, 'path'>, SubSitemap, Default>

export function parameter<const SubSitemap extends Sitemap>(paramDef: ParamDef<any, 'path'>, subSitemap: SubSitemap &  { [missing]?: Route<any> }) {
  if (subSitemap[missing] !== undefined) {
    const { [missing]: defaultRoute, ...subSitemapWithoutMissing } = subSitemap;
    return new OptionalParameterizedPath(paramDef, subSitemapWithoutMissing as any, defaultRoute!);
  } else {
    return new ParameterizedPath(paramDef, subSitemap);
  }
}

