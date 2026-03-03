import { ParamDef, ParamValues } from "./params.js";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export type Locator<ParamDefs extends Record<string, ParamDef<any>>> = {
  route: Route<ParamDefs>,
  values: ParamValues<ParamDefs>
}

export class Route<ParamDefs extends Record<string, ParamDef<any>>> {
  public paramDefs: ParamDefs;

  constructor(paramDefs: ParamDefs) {
    this.paramDefs = paramDefs;
  }

  aliasTo(aliasFunc: (params: ParamValues<ParamDefs>) => Locator<any>) {
    return new Alias(this.paramDefs, aliasFunc);
  }

  // Returns Locator<any> because Alias may resolve to a different route.
  locate(values: ParamValues<ParamDefs>): Locator<any> {
    return { route: this, values };
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

export class ParameterizedPath<T, const SubSitemap extends Sitemap> {
  public paramDef: ParamDef<T, 'path'>;
  PARAM: SubSitemap;

  constructor(paramDef: ParamDef<T, 'path'>, subSitemap: SubSitemap) {
    this.paramDef = paramDef;
    this.PARAM = subSitemap;
  }

  withoutParam(route: Route<any>) {
    return new ParameterizedPathWithoutParam(this.paramDef, this.PARAM, route);
  }
}

export class ParameterizedPathWithoutParam<T, const SubSitemap extends Sitemap> extends ParameterizedPath<T, SubSitemap> {
  parentRoute: Route<any>;

  constructor(paramDef: ParamDef<T, 'path'>, subSitemap: SubSitemap, parentRoute: Route<any>) {
    super(paramDef, subSitemap);
    this.parentRoute = parentRoute;
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

export function parameter<const SubSitemap extends Sitemap>(paramDef: ParamDef<any, 'path'>, subSitemap: SubSitemap) {
  return new ParameterizedPath(paramDef, subSitemap);
}


